// ============================================================
// XcodeAutoPilot — Grep-based Swift Symbol Searcher
// Finds definitions and call sites for a symbol across .swift files
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);
const GREP_TIMEOUT_MS = 10_000;
const SNIPPET_RADIUS = 3; // lines before/after the hit

export interface SymbolLocation {
  file_path: string;
  line_number: number;   // 1-indexed
  description: "definition" | "call site";
  snippet: string;       // formatted ±SNIPPET_RADIUS lines with line numbers
}

/**
 * Search for a symbol across all .swift files under projectRoot.
 * Returns up to maxResults unique locations (definitions first).
 */
export async function grepSymbol(
  symbolName: string,
  projectRoot: string,
  maxResults = 10
): Promise<SymbolLocation[]> {
  if (!symbolName || symbolName.length < 2) return [];

  const escaped = escapeRegex(symbolName);

  // Run definition and call-site greps in parallel
  const [defs, calls] = await Promise.allSettled([
    runGrep(
      `(func|class|struct|enum|protocol|typealias|extension|actor)\\s+${escaped}\\b`,
      projectRoot,
      "definition"
    ),
    runGrep(
      `\\b${escaped}[(<]`,
      projectRoot,
      "call site"
    ),
  ]);

  const results: SymbolLocation[] = [];
  if (defs.status === "fulfilled") results.push(...defs.value);
  if (calls.status === "fulfilled") results.push(...calls.value);

  // Deduplicate by file:line
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const key = `${r.file_path}:${r.line_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`grepSymbol '${symbolName}': ${unique.length} location(s) found`);
  return unique.slice(0, maxResults);
}

// ----------------------------------------------------------
// Internal
// ----------------------------------------------------------

async function runGrep(
  pattern: string,
  root: string,
  description: "definition" | "call site"
): Promise<SymbolLocation[]> {
  try {
    const cmd = `grep -rn -E "${pattern}" --include="*.swift" "${root}" 2>/dev/null`;
    const { stdout } = await execAsync(cmd, {
      timeout: GREP_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const results: SymbolLocation[] = [];

    for (const line of lines.slice(0, 20)) {
      const match = line.match(/^(.+?):(\d+):/);
      if (!match) continue;

      const filePath = match[1];
      const lineNum = parseInt(match[2], 10);
      const snippet = await buildSnippet(filePath, lineNum);

      results.push({ file_path: filePath, line_number: lineNum, description, snippet });
    }

    return results;
  } catch {
    return [];
  }
}

async function buildSnippet(filePath: string, centerLine: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, centerLine - 1 - SNIPPET_RADIUS);
    const end = Math.min(lines.length - 1, centerLine - 1 + SNIPPET_RADIUS);

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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
