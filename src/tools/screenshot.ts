// ============================================================
// XcodeAutoPilot — autopilot_screenshot Tool
// Builds app, runs in simulator, captures screenshot for AI vision
// ============================================================

import { z } from "zod";
import { mkdirSync, readFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { runBuild } from "../core/xcodebuild.js";
import {
  findSimulator,
  bootSimulator,
  installApp,
  launchApp,
  takeScreenshot,
  findBuiltApp,
} from "../core/simulator.js";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);

// ----------------------------------------------------------
// Schema
// ----------------------------------------------------------

export const autopilotScreenshotSchema = z.object({
  project_path: z
    .string()
    .describe("Absolute path to .xcodeproj or .xcworkspace"),
  scheme: z.string().describe("Build scheme name"),
  bundle_id: z
    .string()
    .describe("App bundle identifier (e.g. com.example.MyApp)"),
  device_name: z
    .string()
    .optional()
    .default("iPhone 16")
    .describe("Simulator device name (default: iPhone 16)"),
  os_version: z
    .string()
    .optional()
    .describe("iOS version filter (e.g. '18.0'). Auto-detected if omitted."),
  configuration: z
    .string()
    .optional()
    .default("Debug")
    .describe("Build configuration (default: Debug)"),
  launch_wait_seconds: z
    .number()
    .optional()
    .default(2)
    .describe("Seconds to wait after app launch before taking screenshot (default: 2)"),
  open_preview: z
    .boolean()
    .optional()
    .default(true)
    .describe("Open screenshot in macOS Preview after capture (default: true)"),
});

export type AutopilotScreenshotInput = z.infer<typeof autopilotScreenshotSchema>;

// ----------------------------------------------------------
// Result type (includes image for MCP response)
// ----------------------------------------------------------

export interface ScreenshotResult {
  text: string;
  imageBase64: string;
  mimeType: "image/png";
}

// ----------------------------------------------------------
// Handler
// ----------------------------------------------------------

export async function handleAutopilotScreenshot(
  input: AutopilotScreenshotInput
): Promise<ScreenshotResult> {
  logger.info(
    `autopilot_screenshot: ${input.project_path} [${input.scheme}] on ${input.device_name}`
  );

  const projectRoot = dirname(input.project_path);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const derivedDataPath = `/tmp/xap-build-${timestamp}`;

  // Prepare screenshots output directory
  const screenshotsDir = join(projectRoot, ".xap", "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });
  const screenshotPath = join(screenshotsDir, `${timestamp}.png`);

  // ── Step 1: Find simulator ──────────────────────────────
  logger.info(`Finding simulator: ${input.device_name}`);
  const device = await findSimulator(input.device_name, input.os_version);
  logger.info(`Found: ${device.name} (${device.udid})`);

  // ── Step 2: Boot simulator ──────────────────────────────
  await bootSimulator(device.udid);

  // ── Step 3: Build for simulator ─────────────────────────
  logger.info("Building for simulator...");
  const destination = `platform=iOS Simulator,id=${device.udid}`;
  const buildResult = await runBuild({
    project_path: input.project_path,
    scheme: input.scheme,
    configuration: input.configuration,
    destination,
    derived_data_path: derivedDataPath,
  });

  if (!buildResult.success) {
    const errors = buildResult.diagnostics
      .filter((d) => d.type === "error")
      .slice(0, 5)
      .map((d) => `  • ${d.file_path}:${d.line_number} — ${d.message}`)
      .join("\n");
    throw new Error(
      `Build failed with ${buildResult.diagnostics.filter((d) => d.type === "error").length} error(s):\n${errors}\n\nRun autopilot_build first to fix errors.`
    );
  }

  // ── Step 4: Find built .app ─────────────────────────────
  const appPath = findBuiltApp(derivedDataPath, input.configuration ?? "Debug");
  logger.info(`App: ${appPath}`);

  // ── Step 5: Install app ─────────────────────────────────
  await installApp(device.udid, appPath);

  // ── Step 6: Launch app ──────────────────────────────────
  await launchApp(device.udid, input.bundle_id);

  // ── Step 7: Wait for app to load ────────────────────────
  const waitMs = (input.launch_wait_seconds ?? 2) * 1000;
  logger.info(`Waiting ${waitMs}ms for app to load...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // ── Step 8: Take screenshot ─────────────────────────────
  await takeScreenshot(device.udid, screenshotPath);

  // ── Step 9: Open in Preview (non-blocking) ───────────────
  if (input.open_preview !== false) {
    execAsync(`open "${screenshotPath}"`).catch(() => {
      // Non-critical — don't fail if open fails
    });
  }

  // ── Step 10: Read image as base64 ───────────────────────
  const imageBase64 = readFileSync(screenshotPath).toString("base64");

  const text = JSON.stringify(
    {
      success: true,
      device: device.name,
      udid: device.udid,
      bundle_id: input.bundle_id,
      screenshot_path: screenshotPath,
      build_duration_seconds: buildResult.duration_seconds,
      message: "Screenshot captured. The image is included in this response for visual analysis.",
    },
    null,
    2
  );

  return { text, imageBase64, mimeType: "image/png" };
}
