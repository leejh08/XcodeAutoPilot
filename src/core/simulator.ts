// ============================================================
// XcodeAutoPilot — iOS Simulator Utilities
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
import { readdirSync } from "fs";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface SimDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
}

interface SimctlOutput {
  devices: Record<string, SimDevice[]>;
}

// ----------------------------------------------------------
// Find simulator
// ----------------------------------------------------------

export async function findSimulator(
  deviceName: string,
  osVersion?: string
): Promise<SimDevice> {
  const { stdout } = await execAsync(
    "xcrun simctl list devices available --json",
    { timeout: 15_000 }
  );
  const data = JSON.parse(stdout) as SimctlOutput;

  const runtimeFilter = osVersion
    ? osVersion.replace(/\./g, "-")
    : null;

  // Prefer exact name match first, then partial
  let fallback: SimDevice | null = null;

  for (const [runtime, devices] of Object.entries(data.devices)) {
    if (runtimeFilter && !runtime.includes(runtimeFilter)) continue;
    for (const device of devices) {
      if (!device.isAvailable) continue;
      if (device.name === deviceName) return device;
      if (device.name.includes(deviceName) && !fallback) {
        fallback = device;
      }
    }
  }

  if (fallback) return fallback;

  // Last resort: any available iPhone if deviceName contains "iPhone"
  if (deviceName.toLowerCase().includes("iphone")) {
    for (const [, devices] of Object.entries(data.devices)) {
      for (const device of devices) {
        if (device.isAvailable && device.name.includes("iPhone")) {
          logger.warn(`Simulator "${deviceName}" not found, using "${device.name}" instead`);
          return device;
        }
      }
    }
  }

  throw new Error(
    `Simulator not found: "${deviceName}"${osVersion ? ` (iOS ${osVersion})` : ""}. ` +
    `Run 'xcrun simctl list devices available' to see available simulators.`
  );
}

// ----------------------------------------------------------
// Boot simulator
// ----------------------------------------------------------

export async function bootSimulator(udid: string): Promise<void> {
  try {
    await execAsync(`xcrun simctl boot "${udid}"`, { timeout: 60_000 });
    logger.info(`Booted simulator: ${udid}`);
    // Brief wait for Springboard to settle
    await new Promise((r) => setTimeout(r, 2_000));
  } catch (err) {
    const msg = String(err);
    if (msg.includes("current state: Booted") || msg.includes("already booted")) {
      logger.info(`Simulator already booted: ${udid}`);
    } else {
      throw err;
    }
  }
}

// ----------------------------------------------------------
// Install app
// ----------------------------------------------------------

export async function installApp(udid: string, appPath: string): Promise<void> {
  await execAsync(`xcrun simctl install "${udid}" "${appPath}"`, { timeout: 60_000 });
  logger.info(`Installed: ${appPath}`);
}

// ----------------------------------------------------------
// Launch app
// ----------------------------------------------------------

export async function launchApp(udid: string, bundleId: string): Promise<void> {
  // --terminate-running-simulation ensures a fresh launch
  try {
    await execAsync(`xcrun simctl terminate "${udid}" "${bundleId}" 2>/dev/null || true`, {
      timeout: 10_000,
    });
  } catch {
    // Ignore terminate errors — app may not have been running
  }
  await execAsync(`xcrun simctl launch "${udid}" "${bundleId}"`, { timeout: 30_000 });
  logger.info(`Launched: ${bundleId}`);
}

// ----------------------------------------------------------
// Take screenshot
// ----------------------------------------------------------

export async function takeScreenshot(udid: string, outputPath: string): Promise<void> {
  await execAsync(`xcrun simctl io "${udid}" screenshot "${outputPath}"`, { timeout: 30_000 });
  logger.info(`Screenshot saved: ${outputPath}`);
}

// ----------------------------------------------------------
// Find built .app bundle in DerivedData
// ----------------------------------------------------------

export function findBuiltApp(
  derivedDataPath: string,
  configuration: string
): string {
  const productsDir = `${derivedDataPath}/Build/Products/${configuration}-iphonesimulator`;

  let entries: string[];
  try {
    entries = readdirSync(productsDir);
  } catch {
    throw new Error(
      `Build products directory not found: ${productsDir}. ` +
      `Ensure the build succeeded and configuration matches (e.g. "Debug").`
    );
  }

  const apps = entries
    .filter((e) => e.endsWith(".app"))
    .map((e) => `${productsDir}/${e}`);

  if (apps.length === 0) {
    throw new Error(`No .app bundle found in: ${productsDir}`);
  }

  return apps[0];
}
