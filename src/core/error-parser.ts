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
// SPM-specific patterns
// ----------------------------------------------------------

// "error: Dependencies could not be resolved because no versions of 'Pkg' match ..."
const SPM_VERSION_CONFLICT_REGEX =
  /error:\s+Dependencies could not be resolved because no versions? of '(.+?)' match/i;

// "error: 'Pkg' {ver} is required, but only versions {list} are available"
const SPM_VERSION_REQUIRED_REGEX =
  /error:\s+'(.+?)'\s+.+?\s+is required,\s+but only versions?\s+(.+?)\s+(?:is|are) available/i;

// "error: failed to clone {url}: ..."
const SPM_CLONE_FAILED_REGEX =
  /error:\s+failed to clone\s+'?(.+?)'?:\s+(.+)$/i;

// "error: package at '...' requires Swift X.X or later"
const SPM_SWIFT_VERSION_REGEX =
  /error:\s+package at '(.+?)'.+requires Swift (.+?) or later/i;

// "xcodebuild: error: Could not resolve package dependencies"
const SPM_COULD_NOT_RESOLVE_REGEX =
  /error:\s+Could not resolve package dependencies/i;

export interface SpmDiagnostic {
  type: "version_conflict" | "version_required" | "clone_failed" | "swift_version" | "unresolvable" | "generic";
  package?: string;
  message: string;
  raw_output: string;
}

export function parseSpmOutput(output: string): SpmDiagnostic[] {
  const lines = output.split("\n");
  const diagnostics: SpmDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const versionConflict = trimmed.match(SPM_VERSION_CONFLICT_REGEX);
    if (versionConflict) {
      const key = `version_conflict:${versionConflict[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ type: "version_conflict", package: versionConflict[1], message: trimmed.replace(/^.*?error:\s+/, ""), raw_output: line });
      }
      continue;
    }

    const versionRequired = trimmed.match(SPM_VERSION_REQUIRED_REGEX);
    if (versionRequired) {
      const key = `version_required:${versionRequired[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ type: "version_required", package: versionRequired[1], message: trimmed.replace(/^.*?error:\s+/, ""), raw_output: line });
      }
      continue;
    }

    const cloneFailed = trimmed.match(SPM_CLONE_FAILED_REGEX);
    if (cloneFailed) {
      const key = `clone_failed:${cloneFailed[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ type: "clone_failed", package: cloneFailed[1], message: `Failed to clone '${cloneFailed[1]}': ${cloneFailed[2]}`, raw_output: line });
      }
      continue;
    }

    const swiftVersion = trimmed.match(SPM_SWIFT_VERSION_REGEX);
    if (swiftVersion) {
      const key = `swift_version:${swiftVersion[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ type: "swift_version", package: swiftVersion[1], message: `Package requires Swift ${swiftVersion[2]} or later`, raw_output: line });
      }
      continue;
    }

    if (SPM_COULD_NOT_RESOLVE_REGEX.test(trimmed)) {
      const key = "unresolvable";
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ type: "unresolvable", message: "Could not resolve package dependencies", raw_output: line });
      }
    }
  }

  return diagnostics;
}

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
