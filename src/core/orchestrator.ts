// ============================================================
// XcodeAutoPilot — Build-Fix Loop Orchestrator
// ============================================================

import { logger } from "../utils/logger.js";
import { runBuild, getDefaultDestination } from "./xcodebuild.js";
import { filterErrors, diagnosticsSignature } from "./error-parser.js";
import { generateFixes } from "./claude-fixer.js";
import { applyFixes, rollbackAll, createBackupPath } from "./file-patcher.js";
import {
  clampMaxIterations,
  createLoopDetectionState,
  detectLoop,
  detectErrorIncrease,
  validateFixes,
  acquireProjectLock,
  releaseProjectLock,
} from "./safety.js";
import { extractContextForDiagnostics } from "../utils/context-extractor.js";
import type {
  AutopilotRunParams,
  AutopilotReport,
  IterationResult,
  AppliedFixSummary,
  RollbackRecord,
  UnfixableError,
  BuildDiagnostic,
} from "../types.js";

// ----------------------------------------------------------
// Main orchestrator
// ----------------------------------------------------------

export async function runAutopilot(params: AutopilotRunParams): Promise<AutopilotReport> {
  const startTime = Date.now();

  // Concurrency guard
  const lockResult = acquireProjectLock(params.project_path);
  if (!lockResult.allowed) {
    return failedReport(lockResult.reason!, 0, []);
  }

  const maxIterations = clampMaxIterations(params.max_iterations ?? 5);
  const backupPath = createBackupPath();
  const loopState = createLoopDetectionState();

  const iterationResults: IterationResult[] = [];
  const allFixes: AppliedFixSummary[] = [];
  const allRollbacks: RollbackRecord[] = [];
  const allUnfixable: UnfixableError[] = [];

  // Resolve destination if not provided
  const destination = params.destination ?? (await getDefaultDestination());

  const buildOpts = {
    project_path: params.project_path,
    scheme: params.scheme,
    configuration: params.configuration ?? "Debug",
    destination,
  };

  let lastBuildDiagnostics: BuildDiagnostic[] = [];
  let stopReason: string | undefined;

  logger.section("XcodeAutoPilot — Starting");
  logger.info(
    `Project: ${params.project_path} | Scheme: ${params.scheme} | Max iterations: ${maxIterations}`
  );

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      logger.iteration(iteration, maxIterations, "Starting build...");

      // Step 1: Build
      const buildResult = await runBuild(buildOpts);
      lastBuildDiagnostics = buildResult.diagnostics;

      const errors = filterErrors(buildResult.diagnostics);
      const warnings = buildResult.diagnostics.filter((d) => d.type === "warning");
      const targets = params.fix_warnings
        ? buildResult.diagnostics
        : errors;

      logger.iteration(
        iteration,
        maxIterations,
        `${errors.length} error(s), ${warnings.length} warning(s) found.`
      );

      // Step 2: Check if done
      if (errors.length === 0) {
        logger.summary("Build succeeded! No errors remaining.");
        iterationResults.push({
          iteration,
          errors_before: errors.length,
          errors_after: 0,
          fixes_applied: 0,
          fixes_skipped: 0,
          unfixable_count: 0,
          duration_seconds: (Date.now() - startTime) / 1000,
        });
        break;
      }

      // Step 3: Loop detection (skip on first iteration)
      if (iteration > 1) {
        if (detectLoop(loopState, buildResult.diagnostics)) {
          stopReason = "Same errors repeated in consecutive iterations — auto-fix cannot resolve these.";
          break;
        }
        if (detectErrorIncrease(loopState, errors.length)) {
          // Roll back last changes
          logger.warn("Error count increased. Rolling back last iteration's changes...");
          const rollbacks = await rollbackAll(backupPath, params.project_path);
          rollbacks.forEach((r) => {
            r.iteration = iteration;
            allRollbacks.push(r);
          });
          stopReason = "Error count increased after fix. Rolled back and stopped.";
          break;
        }
      } else {
        // Initialize loop detection state with first error count
        loopState.error_counts.push(errors.length);
        loopState.previous_error_signatures.push(diagnosticsSignature(buildResult.diagnostics));
      }

      // Step 4: Extract source context
      logger.iteration(iteration, maxIterations, "Extracting source context...");
      const contextMap = await extractContextForDiagnostics(targets);

      // Step 5: Call Claude API
      logger.iteration(iteration, maxIterations, `${errors.length} error(s) — calling Claude API...`);
      const claudeResponse = await generateFixes(targets, contextMap);

      // Record unfixable errors
      allUnfixable.push(...claudeResponse.unfixable);

      if (claudeResponse.fixes.length === 0) {
        logger.warn("Claude returned no fixes.");
        stopReason = "Claude API returned no fixes for the remaining errors.";
        break;
      }

      // Step 6: Validate fixes (safety checks)
      const { safeFixes, rejectedFixes } = validateFixes(
        claudeResponse.fixes,
        params.project_path
      );

      if (rejectedFixes.length > 0) {
        logger.warn(`${rejectedFixes.length} fix(es) rejected by safety checks.`);
      }

      // Step 7: Apply fixes
      logger.iteration(iteration, maxIterations, `Applying ${safeFixes.length} fix(es)...`);
      const patchResult = await applyFixes(safeFixes, backupPath, params.project_path);

      const errorsAfterPatch = errors.length; // Will be measured next iteration

      iterationResults.push({
        iteration,
        errors_before: errors.length,
        errors_after: errorsAfterPatch, // Approximate until next build
        fixes_applied: patchResult.applied.length,
        fixes_skipped: patchResult.skipped.length + rejectedFixes.length,
        unfixable_count: claudeResponse.unfixable.length,
        duration_seconds: (Date.now() - startTime) / 1000,
      });

      // Record applied fixes
      for (const fix of patchResult.applied) {
        allFixes.push({
          file: fix.file_path,
          line: fix.line_number,
          description: fix.explanation,
          iteration,
        });
      }

      logger.iteration(
        iteration,
        maxIterations,
        `Applied ${patchResult.applied.length} fix(es), skipped ${patchResult.skipped.length}.`
      );

      if (patchResult.applied.length === 0) {
        stopReason = "No fixes could be applied (all skipped or rejected).";
        break;
      }
    }

    // Final build to measure remaining errors
    const finalErrors = filterErrors(lastBuildDiagnostics);

    // Update last iteration's errors_after with actual count
    if (iterationResults.length > 0) {
      const last = iterationResults[iterationResults.length - 1];
      last.errors_after = finalErrors.length;
    }

    const duration = (Date.now() - startTime) / 1000;
    const status =
      finalErrors.length === 0
        ? "success"
        : allFixes.length > 0
          ? "partial"
          : "failed";

    const firstErrors = iterationResults[0]?.errors_before ?? finalErrors.length;
    const summary =
      status === "success"
        ? `${firstErrors} errors → 0 errors in ${iterationResults.length} iteration(s) (${duration.toFixed(1)}s)`
        : `${firstErrors} errors → ${finalErrors.length} errors after ${iterationResults.length} iteration(s) (${duration.toFixed(1)}s)`;

    logger.summary(summary);

    return {
      status,
      summary,
      iterations: iterationResults,
      all_fixes: allFixes,
      remaining_errors: finalErrors,
      rollbacks: allRollbacks,
      unfixable: allUnfixable,
      duration_seconds: duration,
      backup_path: backupPath,
      stop_reason: stopReason,
    };
  } finally {
    releaseProjectLock(params.project_path);
  }
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function failedReport(
  reason: string,
  durationSeconds: number,
  remaining: BuildDiagnostic[]
): AutopilotReport {
  return {
    status: "failed",
    summary: reason,
    iterations: [],
    all_fixes: [],
    remaining_errors: remaining,
    rollbacks: [],
    unfixable: [],
    duration_seconds: durationSeconds,
    backup_path: "",
    stop_reason: reason,
  };
}
