// ============================================================
// XcodeAutoPilot — autopilot_screenshot Tool
// Builds app, runs in simulator, captures screenshot for AI vision
// ============================================================

import { z } from "zod";
import { mkdirSync, readFileSync, readdirSync } from "fs";
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
  mimeType: "image/jpeg";
}

// ----------------------------------------------------------
// Get BUILT_PRODUCTS_DIR from xcodebuild -showBuildSettings
// ----------------------------------------------------------

async function getBuiltProductsDir(
  projectPath: string,
  scheme: string,
  configuration: string,
  destination: string
): Promise<string> {
  const flag = projectPath.endsWith(".xcworkspace") ? "-workspace" : "-project";
  const cmd = [
    "xcodebuild",
    flag, `"${projectPath}"`,
    "-scheme", `"${scheme}"`,
    "-configuration", configuration,
    "-destination", `'${destination}'`,
    "-showBuildSettings",
    "2>/dev/null",
  ].join(" ");

  const { stdout } = await execAsync(cmd, { timeout: 30_000 });

  const match = stdout.match(/^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m);
  if (!match) {
    throw new Error("Could not determine BUILT_PRODUCTS_DIR from xcodebuild -showBuildSettings");
  }
  return match[1].trim();
}

// ----------------------------------------------------------
// Find .app bundle in a products directory
// ----------------------------------------------------------

function findAppInDir(productsDir: string): string {
  let entries: string[];
  try {
    entries = readdirSync(productsDir);
  } catch {
    throw new Error(`Build products directory not found: ${productsDir}`);
  }

  const apps = entries
    .filter((e) => e.endsWith(".app"))
    .map((e) => join(productsDir, e));

  if (apps.length === 0) {
    throw new Error(`No .app bundle found in: ${productsDir}`);
  }
  return apps[0];
}

// ----------------------------------------------------------
// Optimize image: resize to max 800px wide + convert to JPEG
// Reduces base64 size significantly for LLM token efficiency
// ----------------------------------------------------------

async function optimizeScreenshot(pngPath: string, jpegPath: string): Promise<void> {
  // sips: resize to max 800px (maintains aspect ratio) + convert to JPEG
  await execAsync(
    `sips -Z 800 --setProperty format jpeg --setProperty formatOptions 85 "${pngPath}" --out "${jpegPath}"`,
    { timeout: 10_000 }
  );
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
  const configuration = input.configuration ?? "Debug";

  // Prepare screenshots output directory
  const screenshotsDir = join(projectRoot, ".xap", "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });
  const screenshotPath = join(screenshotsDir, `${timestamp}.png`);

  // ── Step 1: Find simulator ──────────────────────────────
  logger.info(`Finding simulator: ${input.device_name}`);
  const device = await findSimulator(input.device_name, input.os_version);
  logger.info(`Found: ${device.name} (${device.udid})`);

  const destination = `platform=iOS Simulator,name=${device.name}`;

  // ── Step 2: Boot simulator ──────────────────────────────
  await bootSimulator(device.udid);

  // ── Step 3: Build for simulator ─────────────────────────
  logger.info("Building for simulator...");
  const buildResult = await runBuild({
    project_path: input.project_path,
    scheme: input.scheme,
    configuration,
    destination,
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

  // ── Step 4: Locate built .app via build settings ─────────
  logger.info("Locating built .app...");
  const builtProductsDir = await getBuiltProductsDir(
    input.project_path,
    input.scheme,
    configuration,
    destination
  );
  const appPath = findAppInDir(builtProductsDir);
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
  await takeScreenshot(device.name, screenshotPath);

  // ── Step 9: Optimize image (resize + JPEG) ──────────────
  const jpegPath = screenshotPath.replace(/\.png$/, ".jpg");
  try {
    await optimizeScreenshot(screenshotPath, jpegPath);
    logger.info(`Screenshot optimized: ${jpegPath}`);
  } catch {
    logger.info("Image optimization failed, falling back to PNG");
  }

  // ── Step 10: Open in Preview (non-blocking) ───────────────
  const previewPath = jpegPath;
  if (input.open_preview !== false) {
    execAsync(`open "${previewPath}"`).catch(() => {});
  }

  // ── Step 11: Read image as base64 ───────────────────────
  const imageBase64 = readFileSync(jpegPath).toString("base64");

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

  return { text, imageBase64, mimeType: "image/jpeg" };
}
