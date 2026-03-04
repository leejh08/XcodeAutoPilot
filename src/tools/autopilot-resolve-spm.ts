// ============================================================
// XcodeAutoPilot — autopilot_resolve_spm Tool
// Resolves SPM dependencies and returns structured errors
// ============================================================

import { z } from "zod";
import { resolvePackageDependencies } from "../core/xcodebuild.js";
import { parseSpmOutput } from "../core/error-parser.js";
import { logger } from "../utils/logger.js";

export const autopilotResolveSpmSchema = z.object({
  project_path: z.string().describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
});

export type AutopilotResolveSpmInput = z.infer<typeof autopilotResolveSpmSchema>;

export async function handleAutopilotResolveSpm(
  input: AutopilotResolveSpmInput
): Promise<string> {
  logger.info(`autopilot_resolve_spm: ${input.project_path} [${input.scheme}]`);

  const result = await resolvePackageDependencies(input.project_path, input.scheme);
  const errors = parseSpmOutput(result.raw_output);

  const summary = result.success
    ? `SPM dependencies resolved successfully in ${result.duration_seconds.toFixed(1)}s.`
    : `SPM resolution failed in ${result.duration_seconds.toFixed(1)}s — ${errors.length} error(s) found.`;

  return JSON.stringify(
    {
      success: result.success,
      summary,
      error_count: errors.length,
      errors: errors.map((e) => ({
        type: e.type,
        package: e.package ?? null,
        message: e.message,
      })),
      duration_seconds: result.duration_seconds,
      raw_output_preview: result.raw_output.split("\n").slice(-30).join("\n"),
    },
    null,
    2
  );
}
