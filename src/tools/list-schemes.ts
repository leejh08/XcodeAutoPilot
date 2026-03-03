// ============================================================
// XcodeAutoPilot — autopilot_list_schemes Tool
// ============================================================

import { z } from "zod";
import { listSchemes } from "../core/xcodebuild.js";
import { logger } from "../utils/logger.js";

export const listSchemesSchema = z.object({
  project_path: z.string().describe("Absolute path to .xcodeproj or .xcworkspace"),
});

export type ListSchemesInput = z.infer<typeof listSchemesSchema>;

export async function handleListSchemes(input: ListSchemesInput): Promise<string> {
  logger.info(`autopilot_list_schemes: ${input.project_path}`);

  try {
    const schemes = await listSchemes(input.project_path);
    return JSON.stringify(
      {
        project_path: input.project_path,
        schemes,
        count: schemes.length,
      },
      null,
      2
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `Failed to list schemes: ${message}` }, null, 2);
  }
}
