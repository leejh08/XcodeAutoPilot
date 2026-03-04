// ============================================================
// XcodeAutoPilot — Minimal sourcekit-lsp Client
// JSON-RPC over stdio. Used to resolve definition/references
// when grep results are ambiguous (≥5 hits).
// Falls back gracefully if sourcekit-lsp is unavailable.
// ============================================================

import { spawn, ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import { logger } from "../utils/logger.js";

export interface LspLocation {
  file_path: string;
  start_line: number;  // 1-indexed
  end_line: number;    // 1-indexed
}

// ----------------------------------------------------------
// LSP Client
// ----------------------------------------------------------

export class SourceKitLspClient {
  private proc: ChildProcess | null = null;
  private readBuffer = "";
  private pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private openedDocs = new Set<string>();

  async initialize(workspaceRoot: string): Promise<void> {
    this.proc = spawn("xcrun", ["sourcekit-lsp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.readBuffer += chunk.toString("utf-8");
      this.drainBuffer();
    });

    // Log stderr for debugging but don't throw
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      logger.debug(`sourcekit-lsp: ${chunk.toString("utf-8").trim()}`);
    });

    this.proc.on("error", (err) => {
      logger.warn(`sourcekit-lsp process error: ${err.message}`);
    });

    await this.sendRequest(
      "initialize",
      {
        processId: process.pid,
        rootUri: `file://${workspaceRoot}`,
        capabilities: {
          textDocument: {
            definition: {},
            references: {},
          },
        },
        workspaceFolders: null,
      },
      15_000
    );

    this.sendNotification("initialized", {});
  }

  async findDefinition(
    filePath: string,
    line: number,
    col: number
  ): Promise<LspLocation | null> {
    await this.openDocument(filePath);

    const result = await this.sendRequest(
      "textDocument/definition",
      {
        textDocument: { uri: toUri(filePath) },
        position: { line: line - 1, character: col - 1 },
      },
      10_000
    );

    if (!result) return null;
    const locations = Array.isArray(result) ? result : [result];
    if (locations.length === 0) return null;

    const loc = locations[0] as LspRawLocation;
    return {
      file_path: fromUri(loc.uri),
      start_line: loc.range.start.line + 1,
      end_line: loc.range.end.line + 1,
    };
  }

  async findReferences(
    filePath: string,
    line: number,
    col: number
  ): Promise<LspLocation[]> {
    await this.openDocument(filePath);

    const result = await this.sendRequest(
      "textDocument/references",
      {
        textDocument: { uri: toUri(filePath) },
        position: { line: line - 1, character: col - 1 },
        context: { includeDeclaration: false },
      },
      15_000
    );

    if (!Array.isArray(result)) return [];

    return result.slice(0, 10).map((loc: LspRawLocation) => ({
      file_path: fromUri(loc.uri),
      start_line: loc.range.start.line + 1,
      end_line: loc.range.end.line + 1,
    }));
  }

  async dispose(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.sendRequest("shutdown", null, 3_000);
    } catch { /* ignore */ }
    this.sendNotification("exit", null);
    this.proc.kill();
    this.proc = null;
    this.openedDocs.clear();
  }

  // ----------------------------------------------------------
  // Internal: document management
  // ----------------------------------------------------------

  private async openDocument(filePath: string): Promise<void> {
    if (this.openedDocs.has(filePath)) return;
    try {
      const text = await readFile(filePath, "utf-8");
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: toUri(filePath),
          languageId: "swift",
          version: 1,
          text,
        },
      });
      this.openedDocs.add(filePath);
    } catch { /* ignore */ }
  }

  // ----------------------------------------------------------
  // Internal: JSON-RPC framing
  // ----------------------------------------------------------

  private drainBuffer(): void {
    while (true) {
      const headerEnd = this.readBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.readBuffer.slice(0, headerEnd);
      const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) break;

      const contentLength = parseInt(lenMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.readBuffer.length < bodyStart + contentLength) break;

      const body = this.readBuffer.slice(bodyStart, bodyStart + contentLength);
      this.readBuffer = this.readBuffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        if (typeof msg.id === "number") {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(
                new Error(
                  String((msg.error as Record<string, unknown>).message ?? msg.error)
                )
              );
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch { /* ignore malformed JSON */ }
    }
  }

  private writeMessage(msg: Record<string, unknown>): void {
    if (!this.proc?.stdin) return;
    const body = JSON.stringify({ jsonrpc: "2.0", ...msg });
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
    this.proc.stdin.write(frame);
  }

  private sendNotification(method: string, params: unknown): void {
    this.writeMessage({ method, params });
  }

  private sendRequest(
    method: string,
    params: unknown,
    timeoutMs = 10_000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error("LSP process not running"));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      this.writeMessage({ id, method, params });
    });
  }
}

// ----------------------------------------------------------
// Singleton per workspace root
// ----------------------------------------------------------

let _client: SourceKitLspClient | null = null;
let _workspaceRoot: string | null = null;

/**
 * Get (or create) a shared LSP client for the given workspace.
 * Returns null if sourcekit-lsp is unavailable or initialization fails.
 */
export async function getLspClient(
  workspaceRoot: string
): Promise<SourceKitLspClient | null> {
  if (_client && _workspaceRoot === workspaceRoot) return _client;

  // Different workspace — dispose old client
  if (_client) {
    await _client.dispose().catch(() => {});
    _client = null;
  }

  const client = new SourceKitLspClient();
  try {
    await client.initialize(workspaceRoot);
    _client = client;
    _workspaceRoot = workspaceRoot;
    logger.info(`sourcekit-lsp ready for ${workspaceRoot}`);
    return client;
  } catch (err) {
    logger.warn(`sourcekit-lsp unavailable — falling back to grep: ${String(err)}`);
    await client.dispose().catch(() => {});
    return null;
  }
}

export async function disposeLspClient(): Promise<void> {
  if (_client) {
    await _client.dispose().catch(() => {});
    _client = null;
    _workspaceRoot = null;
  }
}

// ----------------------------------------------------------
// URI helpers
// ----------------------------------------------------------

function toUri(filePath: string): string {
  return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
}

function fromUri(uri: string): string {
  return uri.startsWith("file://") ? uri.slice(7) : uri;
}

interface LspRawLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}
