// ============================================================
// XcodeAutoPilot — Source Code Context Extractor
// ============================================================

import { readFile } from "fs/promises";
import { logger } from "./logger.js";
import type { BuildDiagnostic } from "../types.js";

const DEFAULT_CONTEXT_LINES = parseInt(
  process.env.AUTOPILOT_CONTEXT_LINES ?? "50",
  10
);

const FILE_SIZE_LIMIT = parseInt(
  process.env.AUTOPILOT_FILE_SIZE_LIMIT ?? "1048576",
  10
);

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface FileContext {
  file_path: string;
  lines: string[];           // Full file lines (0-indexed)
  error_lines: number[];     // 1-indexed line numbers with errors
  context_text: string;      // Formatted text with line numbers
  start_line: number;        // First line of context (1-indexed)
  end_line: number;          // Last line of context (1-indexed)
}

// ----------------------------------------------------------
// Core Functions
// ----------------------------------------------------------

/**
 * Read a source file and extract context around multiple error lines.
 * Merges overlapping ranges from multiple errors in the same file.
 */
export async function extractFileContext(
  filePath: string,
  errorLines: number[],
  contextLines: number = DEFAULT_CONTEXT_LINES
): Promise<FileContext | null> {
  // Safety: check file size
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(filePath);
    if (stats.size > FILE_SIZE_LIMIT) {
      logger.warn(`Skipping context extraction: ${filePath} exceeds size limit (${stats.size} bytes)`);
      return null;
    }
  } catch {
    return null;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    logger.warn(`Cannot read file for context: ${filePath} — ${String(err)}`);
    return null;
  }

  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines === 0) return null;

  // Compute merged range covering all error lines ± context
  let startLine = Infinity;
  let endLine = -Infinity;

  for (const errLine of errorLines) {
    startLine = Math.min(startLine, errLine - contextLines);
    endLine = Math.max(endLine, errLine + contextLines);
  }

  startLine = Math.max(1, startLine);
  endLine = Math.min(totalLines, endLine);

  // Format context with line numbers: "  42 |     let x: Int = someString"
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
  };
}

/**
 * Extract context for all unique files mentioned in diagnostics.
 * Returns a map from file_path → FileContext.
 */
export async function extractContextForDiagnostics(
  diagnostics: BuildDiagnostic[]
): Promise<Map<string, FileContext>> {
  // Group error line numbers by file path
  const fileErrorLines = new Map<string, number[]>();

  for (const diag of diagnostics) {
    if (!diag.file_path || diag.line_number === 0) continue;
    const existing = fileErrorLines.get(diag.file_path) ?? [];
    if (!existing.includes(diag.line_number)) {
      existing.push(diag.line_number);
    }
    fileErrorLines.set(diag.file_path, existing);
  }

  // Extract context for each file in parallel
  const entries = Array.from(fileErrorLines.entries());
  const results = await Promise.all(
    entries.map(async ([filePath, errorLines]) => {
      const ctx = await extractFileContext(filePath, errorLines);
      return [filePath, ctx] as const;
    })
  );

  const contextMap = new Map<string, FileContext>();
  for (const [filePath, ctx] of results) {
    if (ctx !== null) {
      contextMap.set(filePath, ctx);
    }
  }

  return contextMap;
}

/**
 * Get a single line from a file (1-indexed).
 * Returns null if file cannot be read or line doesn't exist.
 */
export async function getFileLine(
  filePath: string,
  lineNumber: number
): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const line = lines[lineNumber - 1];
    return line ?? null;
  } catch {
    return null;
  }
}

/**
 * Get all lines of a file (for patching).
 */
export async function getFileLines(filePath: string): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n");
  } catch {
    return null;
  }
}
