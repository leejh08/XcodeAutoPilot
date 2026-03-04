// ============================================================
// XcodeAutoPilot — autopilot_build Tool
// Runs xcodebuild and returns diagnostics + source context
// ============================================================

import { z } from "zod";
import { dirname } from "path";
import { runBuild, getDefaultDestination } from "../core/xcodebuild.js";
import { filterErrors, filterWarnings } from "../core/error-parser.js";
import { extractContextForDiagnostics } from "../utils/context-extractor.js";
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
  include_warnings: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include warnings in context extraction (default: false)"),
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

  const summary = buildResult.success
    ? `Build succeeded in ${buildResult.duration_seconds.toFixed(1)}s — no errors.`
    : `Build failed in ${buildResult.duration_seconds.toFixed(1)}s — ${errors.length} error(s), ${warnings.length} warning(s).`;

  // Extract source context for errors (and optionally warnings)
  const diagnosticsForContext = input.include_warnings
    ? buildResult.diagnostics
    : errors;

  const projectRoot = dirname(input.project_path);
  const contextMap = errors.length > 0
    ? await extractContextForDiagnostics(diagnosticsForContext, projectRoot)
    : new Map();

  logger.info(`Extracted context for ${contextMap.size} file(s)`);

  // Build file_contexts array for Claude Code to use
  const fileContexts = Array.from(contextMap.entries()).map(([filePath, ctx]) => ({
    file_path: filePath,
    error_lines: ctx.error_lines,
    source: ctx.context_text,
    start_line: ctx.start_line,
    end_line: ctx.end_line,
    related_locations: ctx.related_locations,
  }));

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
      file_contexts: fileContexts,
      duration_seconds: buildResult.duration_seconds,
    },
    null,
    2
  );
}
