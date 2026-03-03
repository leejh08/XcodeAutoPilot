// ============================================================
// XcodeAutoPilot — Safety Guards
// Prevents infinite loops, scope violations, and unsafe patches
// ============================================================

import { resolve, relative, isAbsolute } from "path";
import { logger } from "../utils/logger.js";
import type { BuildDiagnostic, Fix, SafetyCheckResult, LoopDetectionState } from "../types.js";
import { diagnosticsSignature } from "./error-parser.js";

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const MAX_ITERATIONS_HARD_LIMIT = 10;

/** Directory/path patterns that must never be modified */
const PROTECTED_PATH_PATTERNS: RegExp[] = [
  /\/Pods\//,
  /\/\.build\//,
  /\/DerivedData\//,
  /\/Carthage\//,
  /\/\.framework\//,
  /\/\.git\//,
  /\.framework\//,
  /\/Frameworks\//,
];

const FILE_SIZE_LIMIT = parseInt(
  process.env.AUTOPILOT_FILE_SIZE_LIMIT ?? "1048576",
  10
);

// ----------------------------------------------------------
// Iteration limit
// ----------------------------------------------------------

/**
 * Enforce the hard limit on max_iterations.
 * Returns the clamped value (never exceeds MAX_ITERATIONS_HARD_LIMIT).
 */
export function clampMaxIterations(requested: number): number {
  const clamped = Math.min(Math.max(1, requested), MAX_ITERATIONS_HARD_LIMIT);
  if (clamped !== requested) {
    logger.warn(
      `max_iterations clamped from ${requested} to ${clamped} (hard limit: ${MAX_ITERATIONS_HARD_LIMIT})`
    );
  }
  return clamped;
}

// ----------------------------------------------------------
// Loop detection
// ----------------------------------------------------------

/**
 * Initialize loop detection state.
 */
export function createLoopDetectionState(): LoopDetectionState {
  return {
    previous_error_signatures: [],
    error_counts: [],
  };
}

/**
 * Check if the current errors are identical to the last iteration's errors.
 * Returns true if a loop is detected (same errors repeating).
 */
export function detectLoop(
  state: LoopDetectionState,
  currentDiagnostics: BuildDiagnostic[]
): boolean {
  const sig = diagnosticsSignature(currentDiagnostics);
  const lastSig =
    state.previous_error_signatures[state.previous_error_signatures.length - 1];

  if (lastSig !== undefined && sig === lastSig) {
    logger.warn(
      "Loop detected: identical errors in consecutive iterations. " +
        "Auto-fix cannot resolve these errors."
    );
    return true;
  }

  state.previous_error_signatures.push(sig);
  return false;
}

/**
 * Track error counts and detect if errors increased.
 * Returns true if the error count increased compared to the previous iteration.
 */
export function detectErrorIncrease(
  state: LoopDetectionState,
  currentErrorCount: number
): boolean {
  const lastCount = state.error_counts[state.error_counts.length - 1];

  state.error_counts.push(currentErrorCount);

  if (lastCount !== undefined && currentErrorCount > lastCount) {
    logger.warn(
      `Error count increased from ${lastCount} to ${currentErrorCount}. ` +
        "Rolling back and stopping."
    );
    return true;
  }

  return false;
}

// ----------------------------------------------------------
// File scope validation
// ----------------------------------------------------------

/**
 * Check if a file path is within the allowed project scope.
 */
export function isWithinProjectScope(
  filePath: string,
  projectPath: string
): SafetyCheckResult {
  if (!isAbsolute(filePath)) {
    return { allowed: false, reason: `File path is not absolute: ${filePath}` };
  }

  const resolvedFile = resolve(filePath);
  const resolvedProject = resolve(projectPath);

  const rel = relative(resolvedProject, resolvedFile);

  // If relative path starts with ".." it's outside the project
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      allowed: false,
      reason: `File is outside project directory: ${filePath} (project: ${projectPath})`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a file path matches any protected directory pattern.
 */
export function isProtectedPath(filePath: string): SafetyCheckResult {
  for (const pattern of PROTECTED_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        allowed: false,
        reason: `File is in a protected directory (${pattern.source}): ${filePath}`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Validate all fixes against safety constraints.
 * Returns { safeFixex, rejectedFixes }.
 */
export function validateFixes(
  fixes: Fix[],
  projectPath: string
): {
  safeFixes: Fix[];
  rejectedFixes: { fix: Fix; reason: string }[];
} {
  const safeFixes: Fix[] = [];
  const rejectedFixes: { fix: Fix; reason: string }[] = [];

  for (const fix of fixes) {
    // 1. Scope check
    const scopeCheck = isWithinProjectScope(fix.file_path, projectPath);
    if (!scopeCheck.allowed) {
      logger.warn(`Safety: rejected fix — ${scopeCheck.reason}`);
      rejectedFixes.push({ fix, reason: scopeCheck.reason! });
      continue;
    }

    // 2. Protected path check
    const protectedCheck = isProtectedPath(fix.file_path);
    if (!protectedCheck.allowed) {
      logger.warn(`Safety: rejected fix — ${protectedCheck.reason}`);
      rejectedFixes.push({ fix, reason: protectedCheck.reason! });
      continue;
    }

    safeFixes.push(fix);
  }

  return { safeFixes, rejectedFixes };
}

// ----------------------------------------------------------
// Concurrency guard
// ----------------------------------------------------------

/** Track which project paths are currently being processed */
const activeProjects = new Set<string>();

export function acquireProjectLock(projectPath: string): SafetyCheckResult {
  const key = resolve(projectPath);
  if (activeProjects.has(key)) {
    return {
      allowed: false,
      reason: `autopilot_run is already running for project: ${projectPath}`,
    };
  }
  activeProjects.add(key);
  return { allowed: true };
}

export function releaseProjectLock(projectPath: string): void {
  const key = resolve(projectPath);
  activeProjects.delete(key);
}

// ----------------------------------------------------------
// File size check (for context extraction)
// ----------------------------------------------------------

export async function isFileSafeToRead(filePath: string): Promise<SafetyCheckResult> {
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(filePath);
    if (stats.size > FILE_SIZE_LIMIT) {
      return {
        allowed: false,
        reason: `File too large to process: ${stats.size} bytes (limit: ${FILE_SIZE_LIMIT})`,
      };
    }
    return { allowed: true };
  } catch (err) {
    return { allowed: false, reason: `Cannot access file: ${String(err)}` };
  }
}
