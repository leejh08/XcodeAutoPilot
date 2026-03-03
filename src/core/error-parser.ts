// ============================================================
// XcodeAutoPilot — xcodebuild Output Parser
// ============================================================

import type { BuildDiagnostic } from "../types.js";

// ----------------------------------------------------------
// Regex patterns
// ----------------------------------------------------------

// Standard Swift/ObjC compiler diagnostic:
// /path/to/File.swift:42:10: error: cannot convert value...
// /path/to/File.swift:15:5: warning: variable 'x' was never used
const DIAGNOSTIC_REGEX =
  /^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$/;

// Linker error: "ld: symbol(s) not found for architecture arm64"
const LINKER_ERROR_REGEX = /^ld:\s+(.+)$/;

// Module error: "error: no such module 'SomeModule'"
const MODULE_ERROR_REGEX = /^error:\s+no such module '(.+)'$/;

// Generic compile error (no file/line info): "error: ..."
const GENERIC_ERROR_REGEX = /^(error|warning):\s+(.+)$/;

// Xcode build step failure marker
const BUILD_FAILED_REGEX = /^\*\* BUILD FAILED \*\*$/;

// ----------------------------------------------------------
// Parser
// ----------------------------------------------------------

export function parseXcodebuildOutput(output: string): BuildDiagnostic[] {
  const lines = output.split("\n");
  const diagnostics: BuildDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip BUILD FAILED marker lines
    if (BUILD_FAILED_REGEX.test(trimmed)) continue;

    // 1. Standard diagnostic (most common)
    const stdMatch = trimmed.match(DIAGNOSTIC_REGEX);
    if (stdMatch) {
      const [, filePath, lineStr, colStr, type, message] = stdMatch;
      const diag: BuildDiagnostic = {
        type: type as "error" | "warning",
        file_path: filePath,
        line_number: parseInt(lineStr, 10),
        column_number: parseInt(colStr, 10),
        message: message.trim(),
        raw_output: line,
      };
      const key = `${diag.type}:${diag.file_path}:${diag.line_number}:${diag.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push(diag);
      }
      continue;
    }

    // 2. Linker error
    const linkerMatch = trimmed.match(LINKER_ERROR_REGEX);
    if (linkerMatch) {
      const key = `error:ld:0:${linkerMatch[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({
          type: "error",
          file_path: "ld",
          line_number: 0,
          message: `Linker error: ${linkerMatch[1]}`,
          raw_output: line,
        });
      }
      continue;
    }

    // 3. Module error
    const moduleMatch = trimmed.match(MODULE_ERROR_REGEX);
    if (moduleMatch) {
      const key = `error:module:0:no such module '${moduleMatch[1]}'`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({
          type: "error",
          file_path: "module",
          line_number: 0,
          message: `No such module '${moduleMatch[1]}'`,
          raw_output: line,
        });
      }
      continue;
    }

    // 4. Generic error/warning (no file info)
    const genericMatch = trimmed.match(GENERIC_ERROR_REGEX);
    if (genericMatch) {
      const [, type, message] = genericMatch;
      // Only capture errors, skip generic warnings (too noisy)
      if (type === "error") {
        const key = `error:generic:0:${message}`;
        if (!seen.has(key)) {
          seen.add(key);
          diagnostics.push({
            type: "error",
            file_path: "",
            line_number: 0,
            message: message.trim(),
            raw_output: line,
          });
        }
      }
    }
  }

  return diagnostics;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

export function filterErrors(diagnostics: BuildDiagnostic[]): BuildDiagnostic[] {
  return diagnostics.filter((d) => d.type === "error");
}

export function filterWarnings(diagnostics: BuildDiagnostic[]): BuildDiagnostic[] {
  return diagnostics.filter((d) => d.type === "warning");
}

/**
 * Create a stable string signature for a set of diagnostics.
 * Used to detect infinite loops (same errors repeating).
 */
export function diagnosticsSignature(diagnostics: BuildDiagnostic[]): string {
  return diagnostics
    .filter((d) => d.type === "error")
    .map((d) => `${d.file_path}:${d.line_number}:${d.message}`)
    .sort()
    .join("|");
}

/**
 * Group diagnostics by file path.
 */
export function groupByFile(
  diagnostics: BuildDiagnostic[]
): Map<string, BuildDiagnostic[]> {
  const map = new Map<string, BuildDiagnostic[]>();
  for (const diag of diagnostics) {
    if (!diag.file_path || diag.file_path === "ld" || diag.file_path === "module") {
      continue;
    }
    const existing = map.get(diag.file_path) ?? [];
    existing.push(diag);
    map.set(diag.file_path, existing);
  }
  return map;
}
