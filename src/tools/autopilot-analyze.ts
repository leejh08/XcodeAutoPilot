// ============================================================
// XcodeAutoPilot — autopilot_analyze Tool
// Build + analyze errors with Claude AI, but do NOT apply fixes
// ============================================================

import { z } from "zod";
import { runBuild, getDefaultDestination } from "../core/xcodebuild.js";
import { filterErrors } from "../core/error-parser.js";
import { generateFixes } from "../core/claude-fixer.js";
import { extractContextForDiagnostics } from "../utils/context-extractor.js";
import { logger } from "../utils/logger.js";

export const autopilotAnalyzeSchema = z.object({
  project_path: z.string().describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
  configuration: z
    .string()
    .optional()
    .default("Debug")
    .describe("Build configuration"),
  destination: z
    .string()
    .optional()
    .describe("Build destination. Auto-detected if omitted."),
});

export type AutopilotAnalyzeInput = z.infer<typeof autopilotAnalyzeSchema>;

export async function handleAutopilotAnalyze(
  input: AutopilotAnalyzeInput
): Promise<string> {
  logger.info(`autopilot_analyze: ${input.project_path} [${input.scheme}] (dry-run)`);

  const destination = input.destination ?? (await getDefaultDestination());

  const buildResult = await runBuild({
    project_path: input.project_path,
    scheme: input.scheme,
    configuration: input.configuration,
    destination,
  });

  const errors = filterErrors(buildResult.diagnostics);

  if (errors.length === 0) {
    return JSON.stringify(
      {
        status: "clean",
        summary: `Build succeeded — no errors to analyze.`,
        errors: [],
        proposed_fixes: [],
        unfixable: [],
        duration_seconds: buildResult.duration_seconds,
      },
      null,
      2
    );
  }

  logger.info(`Extracting context for ${errors.length} error(s)...`);
  const contextMap = await extractContextForDiagnostics(errors);

  logger.info("Calling Claude API for analysis...");
  const claudeResponse = await generateFixes(errors, contextMap);

  return JSON.stringify(
    {
      status: "analyzed",
      summary:
        `${errors.length} error(s) found. ` +
        `Claude proposes ${claudeResponse.fixes.length} fix(es). ` +
        `${claudeResponse.unfixable.length} are unfixable automatically. ` +
        `(DRY-RUN: no changes applied)`,
      error_count: errors.length,
      errors: errors.map((d) => ({
        file: d.file_path,
        line: d.line_number,
        message: d.message,
      })),
      proposed_fixes: claudeResponse.fixes.map((f) => ({
        file: f.file_path,
        line: f.line_number,
        original: f.original_line,
        fixed: f.fixed_line,
        explanation: f.explanation,
      })),
      unfixable: claudeResponse.unfixable,
      duration_seconds: buildResult.duration_seconds,
    },
    null,
    2
  );
}
