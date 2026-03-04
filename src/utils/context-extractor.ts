// ============================================================
// XcodeAutoPilot — Source Code Context Extractor
// Hybrid approach:
//   1. extractEnclosingScope  — find the function/type that wraps the error
//   2. classifyError          — identify what symbol to look up
//   3. grepSymbol             — fast cross-file search for definitions/call sites
//   4. sourcekit-lsp          — precise references when grep is ambiguous (≥5 hits)
// ============================================================

import { readFile, stat } from "fs/promises";
import { dirname } from "path";
import { logger } from "./logger.js";
import type { BuildDiagnostic, RelatedLocation } from "../types.js";
import { classifyError } from "../core/error-classifier.js";
import { grepSymbol } from "../core/symbol-searcher.js";
import { getLspClient } from "../core/sourcekit-lsp.js";

const FILE_SIZE_LIMIT = parseInt(
  process.env.AUTOPILOT_FILE_SIZE_LIMIT ?? "1048576",
  10
);

// Lines to show on each side when falling back from enclosing scope
const FALLBACK_CONTEXT_LINES = 50;

// Max lines an enclosing scope can span (prevents giant classes dominating output)
const MAX_SCOPE_LINES = 150;

// Number of grep results above which we escalate to sourcekit-lsp
const LSP_ESCALATION_THRESHOLD = 5;

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface FileContext {
  file_path: string;
  lines: string[];               // Full file lines (0-indexed)
  error_lines: number[];         // 1-indexed line numbers with errors
  context_text: string;          // Formatted text with line numbers
  start_line: number;            // First line of context (1-indexed)
  end_line: number;              // Last line of context (1-indexed)
  related_locations: RelatedLocation[];
}

// ----------------------------------------------------------
// Enclosing scope extraction
// ----------------------------------------------------------

/**
 * Find the enclosing function/method/type that contains errorLine.
 * Uses brace-depth tracking. Falls back to ±FALLBACK_CONTEXT_LINES.
 */
export function findEnclosingScope(
  lines: string[],
  errorLine: number            // 1-indexed
): { startLine: number; endLine: number } {
  const totalLines = lines.length;
  const errorIdx = Math.min(errorLine - 1, totalLines - 1); // 0-indexed

  // Walk backward to find enclosing opening brace
  let depth = 0;
  let openBraceIdx = -1;

  for (let i = errorIdx; i >= 0; i--) {
    const line = lines[i];
    // Iterate characters in reverse
    for (let j = line.length - 1; j >= 0; j--) {
      if (line[j] === "}") depth++;
      else if (line[j] === "{") {
        if (depth === 0) {
          openBraceIdx = i;
          break;
        }
        depth--;
      }
    }
    if (openBraceIdx !== -1) break;
  }

  if (openBraceIdx === -1) {
    // No enclosing brace found — use fallback
    return fallbackRange(errorIdx, totalLines);
  }

  // Walk backward from openBraceIdx to find the declaration keyword
  // (func, class, struct, etc.) — check up to 5 lines above
  const SCOPE_KEYWORDS = /\b(func|init|deinit|subscript|class|struct|enum|protocol|extension|actor|var|let)\b/;
  let scopeStartIdx = openBraceIdx;

  for (let i = openBraceIdx; i >= Math.max(0, openBraceIdx - 5); i--) {
    if (SCOPE_KEYWORDS.test(lines[i])) {
      scopeStartIdx = i;
      break;
    }
  }

  // Walk forward from openBraceIdx to find matching closing brace
  depth = 0;
  let scopeEndIdx = Math.min(totalLines - 1, scopeStartIdx + MAX_SCOPE_LINES - 1);

  for (let i = openBraceIdx; i < totalLines && i <= scopeStartIdx + MAX_SCOPE_LINES; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0 && i > openBraceIdx) {
      scopeEndIdx = i;
      break;
    }
  }

  return { startLine: scopeStartIdx + 1, endLine: scopeEndIdx + 1 };
}

function fallbackRange(
  errorIdx: number,
  totalLines: number
): { startLine: number; endLine: number } {
  return {
    startLine: Math.max(1, errorIdx + 1 - FALLBACK_CONTEXT_LINES),
    endLine: Math.min(totalLines, errorIdx + 1 + FALLBACK_CONTEXT_LINES),
  };
}

// ----------------------------------------------------------
// Core: extract file context
// ----------------------------------------------------------

export async function extractFileContext(
  filePath: string,
  errorLines: number[],
  projectRoot?: string
): Promise<FileContext | null> {
  // Safety: check file size
  try {
    const stats = await stat(filePath);
    if (stats.size > FILE_SIZE_LIMIT) {
      logger.warn(`Skipping context: ${filePath} exceeds size limit`);
      return null;
    }
  } catch {
    return null;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    logger.warn(`Cannot read file: ${filePath} — ${String(err)}`);
    return null;
  }

  const lines = content.split("\n");
  const totalLines = lines.length;
  if (totalLines === 0) return null;

  // Find enclosing scope for the first (primary) error line
  const primaryLine = errorLines[0];
  const { startLine, endLine } = findEnclosingScope(lines, primaryLine);

  // Format context text with line numbers and error markers
  const contextText = lines
    .slice(startLine - 1, endLine)
    .map((line, i) => {
      const lineNum = startLine + i;
      const isError = errorLines.includes(lineNum);
      const marker = isError ? ">" : " ";
      return `${marker} ${String(lineNum).padStart(4)} | ${line}`;
    })
    .join("\n");

  return {
    file_path: filePath,
    lines,
    error_lines: errorLines,
    context_text: contextText,
    start_line: startLine,
    end_line: endLine,
    related_locations: [],  // populated below
  };
}

// ----------------------------------------------------------
// Related locations: grep + optional LSP
// ----------------------------------------------------------

async function findRelatedLocations(
  diagnostic: BuildDiagnostic,
  projectRoot: string
): Promise<RelatedLocation[]> {
  const errorClass = classifyError(diagnostic.message);

  let symbolName: string | null = null;
  if (errorClass.kind !== "unknown" && errorClass.kind !== "type_mismatch") {
    symbolName = errorClass.symbol;
  } else if (errorClass.kind === "type_mismatch" && errorClass.symbol) {
    symbolName = errorClass.symbol;
  }

  if (!symbolName) return [];

  // 1. Grep — fast cross-file search
  const grepResults = await grepSymbol(symbolName, projectRoot);

  // Filter out the error file itself to reduce noise
  const external = grepResults.filter((r) => r.file_path !== diagnostic.file_path);
  const sameFile = grepResults.filter((r) => r.file_path === diagnostic.file_path);

  // 2. Escalate to sourcekit-lsp if grep is ambiguous and column info is available
  if (
    grepResults.length >= LSP_ESCALATION_THRESHOLD &&
    diagnostic.column_number &&
    diagnostic.line_number
  ) {
    const lsp = await getLspClient(projectRoot).catch(() => null);
    if (lsp) {
      try {
        const [def, refs] = await Promise.allSettled([
          lsp.findDefinition(diagnostic.file_path, diagnostic.line_number, diagnostic.column_number),
          lsp.findReferences(diagnostic.file_path, diagnostic.line_number, diagnostic.column_number),
        ]);

        const lspLocations: RelatedLocation[] = [];

        if (def.status === "fulfilled" && def.value) {
          const snippet = await buildSnippetFromFile(def.value.file_path, def.value.start_line, 5);
          lspLocations.push({
            description: "definition (lsp)",
            file_path: def.value.file_path,
            snippet,
            start_line: def.value.start_line,
            end_line: def.value.end_line,
          });
        }

        if (refs.status === "fulfilled" && refs.value.length > 0) {
          for (const ref of refs.value.slice(0, 5)) {
            const snippet = await buildSnippetFromFile(ref.file_path, ref.start_line, 3);
            lspLocations.push({
              description: "call site (lsp)",
              file_path: ref.file_path,
              snippet,
              start_line: ref.start_line,
              end_line: ref.end_line,
            });
          }
        }

        if (lspLocations.length > 0) {
          logger.info(`LSP found ${lspLocations.length} location(s) for '${symbolName}'`);
          return lspLocations;
        }
      } catch (err) {
        logger.warn(`LSP query failed, using grep results: ${String(err)}`);
      }
    }
  }

  // 3. Use grep results (prefer external files, then same-file)
  return [...external, ...sameFile].slice(0, 6).map((loc) => ({
    description: loc.description === "definition"
      ? "function definition"
      : "call site",
    file_path: loc.file_path,
    snippet: loc.snippet,
    start_line: loc.line_number,
    end_line: loc.line_number,
  }));
}

async function buildSnippetFromFile(
  filePath: string,
  centerLine: number,
  radius: number
): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, centerLine - 1 - radius);
    const end = Math.min(lines.length - 1, centerLine - 1 + radius);

    return lines
      .slice(start, end + 1)
      .map((l, i) => {
        const n = start + i + 1;
        const marker = n === centerLine ? ">" : " ";
        return `${marker} ${String(n).padStart(4)} | ${l}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

// ----------------------------------------------------------
// Public API: extract context for all diagnostics
// ----------------------------------------------------------

/**
 * Extract context for all unique files mentioned in diagnostics.
 * Returns a map from file_path → FileContext.
 *
 * @param projectRoot  Optional. When provided, enables grep + LSP lookup
 *                     for related locations (definitions, call sites).
 */
export async function extractContextForDiagnostics(
  diagnostics: BuildDiagnostic[],
  projectRoot?: string
): Promise<Map<string, FileContext>> {
  // Group error line numbers and diagnostics by file path
  const fileErrorLines = new Map<string, number[]>();
  const fileDiagnostics = new Map<string, BuildDiagnostic[]>();

  for (const diag of diagnostics) {
    if (!diag.file_path || diag.line_number === 0) continue;

    const lines = fileErrorLines.get(diag.file_path) ?? [];
    if (!lines.includes(diag.line_number)) lines.push(diag.line_number);
    fileErrorLines.set(diag.file_path, lines);

    const diags = fileDiagnostics.get(diag.file_path) ?? [];
    diags.push(diag);
    fileDiagnostics.set(diag.file_path, diags);
  }

  // Extract context for each file in parallel
  const entries = Array.from(fileErrorLines.entries());
  const results = await Promise.all(
    entries.map(async ([filePath, errorLines]) => {
      const ctx = await extractFileContext(filePath, errorLines, projectRoot);
      if (!ctx) return [filePath, null] as const;

      // Fetch related locations if projectRoot is available
      if (projectRoot) {
        const diagsForFile = fileDiagnostics.get(filePath) ?? [];
        const root = projectRoot ?? dirname(filePath);

        // Gather related locations from all diagnostics in this file
        const allRelated = await Promise.all(
          diagsForFile.map((d) => findRelatedLocations(d, root))
        );

        // Deduplicate related locations
        const seen = new Set<string>();
        ctx.related_locations = allRelated
          .flat()
          .filter((r) => {
            const key = `${r.file_path}:${r.start_line}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      }

      return [filePath, ctx] as const;
    })
  );

  const contextMap = new Map<string, FileContext>();
  for (const [filePath, ctx] of results) {
    if (ctx !== null) contextMap.set(filePath, ctx);
  }

  return contextMap;
}

// ----------------------------------------------------------
// Utility helpers (retained from original)
// ----------------------------------------------------------

export async function getFileLine(
  filePath: string,
  lineNumber: number
): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n")[lineNumber - 1] ?? null;
  } catch {
    return null;
  }
}

export async function getFileLines(filePath: string): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n");
  } catch {
    return null;
  }
}
