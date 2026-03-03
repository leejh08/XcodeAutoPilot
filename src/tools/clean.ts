// ============================================================
// XcodeAutoPilot — autopilot_clean Tool
// ============================================================

import { z } from "zod";
import { runClean } from "../core/xcodebuild.js";
import { logger } from "../utils/logger.js";

export const cleanSchema = z.object({
  project_path: z.string().describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
});

export type CleanInput = z.infer<typeof cleanSchema>;

export async function handleClean(input: CleanInput): Promise<string> {
  logger.info(`autopilot_clean: ${input.project_path} [${input.scheme}]`);

  try {
    await runClean(input.project_path, input.scheme);
    return JSON.stringify(
      {
        success: true,
        message: `Clean succeeded for scheme "${input.scheme}".`,
      },
      null,
      2
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ success: false, error: message }, null, 2);
  }
}
