// ============================================================
// XcodeAutoPilot — autopilot_run Tool
// ============================================================

import { z } from "zod";
import { runAutopilot } from "../core/orchestrator.js";
import { logger } from "../utils/logger.js";

export const autopilotRunSchema = z.object({
  project_path: z.string().describe(
    "Absolute path to .xcodeproj or .xcworkspace file"
  ),
  scheme: z.string().describe("Build scheme name"),
  max_iterations: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
    .describe("Maximum fix iterations (default: 5, hard limit: 10)"),
  configuration: z
    .string()
    .optional()
    .default("Debug")
    .describe("Build configuration (Debug or Release)"),
  destination: z
    .string()
    .optional()
    .describe(
      "Build destination (e.g., 'platform=iOS Simulator,name=iPhone 16'). Auto-detected if omitted."
    ),
  fix_warnings: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also fix warnings (default: false)"),
});

export type AutopilotRunInput = z.infer<typeof autopilotRunSchema>;

export async function handleAutopilotRun(input: AutopilotRunInput): Promise<string> {
  logger.section("autopilot_run invoked");
  logger.info(`project_path: ${input.project_path}`);
  logger.info(`scheme: ${input.scheme}`);
  logger.info(`max_iterations: ${input.max_iterations}`);

  try {
    const report = await runAutopilot({
      project_path: input.project_path,
      scheme: input.scheme,
      max_iterations: input.max_iterations,
      configuration: input.configuration,
      destination: input.destination,
      fix_warnings: input.fix_warnings,
    });

    return JSON.stringify(report, null, 2);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`autopilot_run failed: ${message}`);
    return JSON.stringify({
      status: "failed",
      summary: `Fatal error: ${message}`,
      iterations: [],
      all_fixes: [],
      remaining_errors: [],
      rollbacks: [],
      unfixable: [],
      duration_seconds: 0,
      backup_path: "",
    });
  }
}
