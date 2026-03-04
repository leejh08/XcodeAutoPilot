// ============================================================
// XcodeAutoPilot — autopilot_tuist_build Tool
// Runs tuist install/fetch + generate + xcodebuild (version-aware)
// ============================================================

import { z } from "zod";
import { getTuistMajorVersion, tuistInstall, tuistGenerate } from "../core/tuist.js";
import { runBuild, getDefaultDestination } from "../core/xcodebuild.js";
import { filterErrors, filterWarnings } from "../core/error-parser.js";
import { extractContextForDiagnostics } from "../utils/context-extractor.js";
import { logger } from "../utils/logger.js";

export const autopilotTuistBuildSchema = z.object({
  project_directory: z
    .string()
    .describe("Absolute path to the directory containing Project.swift or Tuist/"),
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
  skip_install: z
    .boolean()
    .optional()
    .default(false)
    .describe("Skip tuist install/fetch step (use if dependencies are already resolved)"),
  skip_generate: z
    .boolean()
    .optional()
    .default(false)
    .describe("Skip tuist generate step (use if .xcworkspace already exists)"),
  workspace_path: z
    .string()
    .optional()
    .describe("Absolute path to existing .xcworkspace. Required when skip_generate=true."),
});

export type AutopilotTuistBuildInput = z.infer<typeof autopilotTuistBuildSchema>;

export async function handleAutopilotTuistBuild(
  input: AutopilotTuistBuildInput
): Promise<string> {
  const projectDir = input.project_directory;
  logger.info(`autopilot_tuist_build: ${projectDir} [${input.scheme}]`);

  const tuistSteps: Record<string, unknown> = {};

  // Step 1: Detect Tuist version
  let tuistVersion: number;
  try {
    tuistVersion = await getTuistMajorVersion();
    logger.info(`Detected Tuist v${tuistVersion}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ success: false, error: message }, null, 2);
  }

  // Step 2: Install dependencies
  if (!input.skip_install) {
    const installResult = await tuistInstall(projectDir, tuistVersion);
    tuistSteps["install"] = {
      success: installResult.success,
      duration_seconds: installResult.duration_seconds,
    };
    if (!installResult.success) {
      return JSON.stringify(
        {
          success: false,
          summary: `tuist ${tuistVersion >= 4 ? "install" : "fetch"} failed.`,
          tuist_version: tuistVersion,
          tuist_steps: tuistSteps,
          raw_output: installResult.raw_output,
        },
        null,
        2
      );
    }
  }

  // Step 3: Generate Xcode project
  let resolvedWorkspacePath: string;

  if (input.skip_generate) {
    if (!input.workspace_path) {
      return JSON.stringify(
        {
          success: false,
          error: "workspace_path is required when skip_generate=true",
        },
        null,
        2
      );
    }
    resolvedWorkspacePath = input.workspace_path;
  } else {
    const generateResult = await tuistGenerate(projectDir);
    tuistSteps["generate"] = {
      success: generateResult.success,
      workspace_path: generateResult.workspace_path,
      duration_seconds: generateResult.duration_seconds,
    };
    if (!generateResult.success || !generateResult.workspace_path) {
      return JSON.stringify(
        {
          success: false,
          summary: generateResult.success
            ? "tuist generate succeeded but no .xcworkspace found in project directory."
            : "tuist generate failed.",
          tuist_version: tuistVersion,
          tuist_steps: tuistSteps,
          raw_output: generateResult.raw_output,
        },
        null,
        2
      );
    }
    resolvedWorkspacePath = generateResult.workspace_path;
  }

  // Step 4: Build with xcodebuild
  const destination = input.destination ?? (await getDefaultDestination());

  const buildResult = await runBuild({
    project_path: resolvedWorkspacePath,
    scheme: input.scheme,
    configuration: input.configuration,
    destination,
  });

  const errors = filterErrors(buildResult.diagnostics);
  const warnings = filterWarnings(buildResult.diagnostics);

  const summary = buildResult.success
    ? `Build succeeded in ${buildResult.duration_seconds.toFixed(1)}s — no errors.`
    : `Build failed in ${buildResult.duration_seconds.toFixed(1)}s — ${errors.length} error(s), ${warnings.length} warning(s).`;

  const diagnosticsForContext = input.include_warnings ? buildResult.diagnostics : errors;
  const contextMap =
    errors.length > 0 ? await extractContextForDiagnostics(diagnosticsForContext) : new Map();

  const fileContexts = Array.from(contextMap.entries()).map(([filePath, ctx]) => ({
    file_path: filePath,
    error_lines: ctx.error_lines,
    source: ctx.context_text,
    start_line: ctx.start_line,
    end_line: ctx.end_line,
  }));

  return JSON.stringify(
    {
      success: buildResult.success,
      summary,
      tuist_version: tuistVersion,
      tuist_steps: tuistSteps,
      workspace_path: resolvedWorkspacePath,
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
