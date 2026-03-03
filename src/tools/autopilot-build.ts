// ============================================================
// XcodeAutoPilot — autopilot_build Tool
// Runs xcodebuild and returns diagnostics (no fixes applied)
// ============================================================

import { z } from "zod";
import { runBuild, getDefaultDestination } from "../core/xcodebuild.js";
import { filterErrors, filterWarnings } from "../core/error-parser.js";
import { logger } from "../utils/logger.js";

export const autopilotBuildSchema = z.object({
  project_path: z.string().describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
  configuration: z
    .string()
    .optional()
    .default("Debug")
    .describe("Build configuration (Debug or Release)"),
  destination: z
    .string()
    .optional()
    .describe("Build destination. Auto-detected if omitted."),
});

export type AutopilotBuildInput = z.infer<typeof autopilotBuildSchema>;

export async function handleAutopilotBuild(input: AutopilotBuildInput): Promise<string> {
  logger.info(`autopilot_build: ${input.project_path} [${input.scheme}]`);

  const destination = input.destination ?? (await getDefaultDestination());

  const buildResult = await runBuild({
    project_path: input.project_path,
    scheme: input.scheme,
    configuration: input.configuration,
    destination,
  });

  const errors = filterErrors(buildResult.diagnostics);
  const warnings = filterWarnings(buildResult.diagnostics);

  const summary =
    buildResult.success
      ? `Build succeeded in ${buildResult.duration_seconds.toFixed(1)}s — no errors.`
      : `Build failed in ${buildResult.duration_seconds.toFixed(1)}s — ${errors.length} error(s), ${warnings.length} warning(s).`;

  return JSON.stringify(
    {
      success: buildResult.success,
      summary,
      error_count: errors.length,
      warning_count: warnings.length,
      errors: errors.map((d) => ({
        file: d.file_path,
        line: d.line_number,
        column: d.column_number,
        message: d.message,
      })),
      warnings: warnings.map((d) => ({
        file: d.file_path,
        line: d.line_number,
        message: d.message,
      })),
      duration_seconds: buildResult.duration_seconds,
      raw_output_preview: buildResult.raw_output.split("\n").slice(-50).join("\n"),
    },
    null,
    2
  );
}
