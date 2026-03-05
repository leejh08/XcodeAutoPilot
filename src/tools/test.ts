// ============================================================
// XcodeAutoPilot — autopilot_test Tool
// Runs xcodebuild test, returns structured failures with source context
// ============================================================

import { z } from "zod";
import { dirname } from "path";
import { runTests } from "../core/test-runner.js";
import { getDefaultDestination } from "../core/xcodebuild.js";
import { extractContextForDiagnostics } from "../utils/context-extractor.js";
import { logger } from "../utils/logger.js";
import type { BuildDiagnostic } from "../types.js";

// ----------------------------------------------------------
// Schema
// ----------------------------------------------------------

export const autopilotTestSchema = z.object({
  project_path: z
    .string()
    .describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
  configuration: z
    .string()
    .optional()
    .default("Debug")
    .describe("Build configuration (default: Debug)"),
  destination: z
    .string()
    .optional()
    .describe("Test destination. Auto-detected if omitted."),
  test_plan: z
    .string()
    .optional()
    .describe("Test plan name (optional)"),
  only_testing: z
    .array(z.string())
    .optional()
    .describe("Run only specific tests, e.g. [\"CalculatorTests/testAddition\"]"),
});

export type AutopilotTestInput = z.infer<typeof autopilotTestSchema>;

// ----------------------------------------------------------
// Handler
// ----------------------------------------------------------

export async function handleAutopilotTest(input: AutopilotTestInput): Promise<string> {
  logger.info(`autopilot_test: ${input.project_path} [${input.scheme}]`);

  const destination = input.destination ?? (await getDefaultDestination());
  const projectRoot = dirname(input.project_path);

  const testResult = await runTests({
    project_path: input.project_path,
    scheme: input.scheme,
    configuration: input.configuration,
    destination,
    test_plan: input.test_plan,
    only_testing: input.only_testing,
  });

  const summary = testResult.success
    ? `All ${testResult.total_tests} test(s) passed in ${testResult.duration_seconds.toFixed(1)}s.`
    : `${testResult.failed} test(s) failed out of ${testResult.total_tests} in ${testResult.duration_seconds.toFixed(1)}s.`;

  // Convert failures to BuildDiagnostic-compatible format for context extraction
  const diagnostics: BuildDiagnostic[] = testResult.failures
    .filter((f) => f.file_path && f.line_number > 0)
    .map((f) => ({
      type: "error" as const,
      file_path: f.file_path,
      line_number: f.line_number,
      column_number: undefined,
      message: f.message,
      raw_output: `${f.file_path}:${f.line_number}: error: ${f.message}`,
    }));

  const contextMap =
    diagnostics.length > 0
      ? await extractContextForDiagnostics(diagnostics, projectRoot)
      : new Map();

  logger.info(`Extracted context for ${contextMap.size} file(s)`);

  // Build failure details with source context
  const failureDetails = testResult.failures.map((f) => {
    const ctx = f.file_path ? contextMap.get(f.file_path) : undefined;
    return {
      test_class: f.test_class,
      test_method: f.test_method,
      full_name: f.full_name,
      file: f.file_path,
      line: f.line_number,
      message: f.message,
      source: ctx?.context_text ?? null,
      start_line: ctx?.start_line ?? null,
      end_line: ctx?.end_line ?? null,
      related_locations: ctx?.related_locations ?? [],
    };
  });

  return JSON.stringify(
    {
      success: testResult.success,
      summary,
      total_tests: testResult.total_tests,
      passed: testResult.passed,
      failed: testResult.failed,
      skipped: testResult.skipped,
      failures: failureDetails,
      duration_seconds: testResult.duration_seconds,
    },
    null,
    2
  );
}
