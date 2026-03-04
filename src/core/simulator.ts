// ============================================================
// XcodeAutoPilot — iOS Simulator Utilities
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
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
  // Open Simulator.app first — required for screen surface rendering (screenshot)
  execAsync("open -a Simulator").catch(() => {});

  try {
    await execAsync(`xcrun simctl boot "${udid}"`, { timeout: 60_000 });
    logger.info(`Booted simulator: ${udid}`);
    // Wait for Springboard to settle and screen surfaces to become available
    await new Promise((r) => setTimeout(r, 4_000));
  } catch (err) {
    const msg = String(err);
    if (msg.includes("current state: Booted") || msg.includes("already booted")) {
      logger.info(`Simulator already booted: ${udid}`);
      // Brief wait in case Simulator.app was just opened
      await new Promise((r) => setTimeout(r, 2_000));
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

const FIND_WINDOW_SWIFT = `
import Cocoa
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in windows {
    let owner = w["kCGWindowOwnerName"] as? String ?? ""
    let name = w["kCGWindowName"] as? String ?? ""
    let wid = w["kCGWindowNumber"] as? Int ?? 0
    if owner == "Simulator" && !name.isEmpty {
        print(wid)
        exit(0)
    }
}
exit(1)
`;

export async function takeScreenshot(deviceName: string, outputPath: string): Promise<void> {
  // First try simctl io screenshot (works on non-beta iOS)
  try {
    // Find the booted simulator UDID by name for simctl
    const { stdout: simctlOut } = await execAsync(
      "xcrun simctl list devices booted --json",
      { timeout: 10_000 }
    );
    const data = JSON.parse(simctlOut) as { devices: Record<string, SimDevice[]> };
    let udid = "";
    for (const devices of Object.values(data.devices)) {
      const match = devices.find((d) => d.name === deviceName);
      if (match) { udid = match.udid; break; }
    }
    if (udid) {
      await execAsync(`xcrun simctl io "${udid}" screenshot "${outputPath}"`, { timeout: 15_000 });
      logger.info(`Screenshot saved via simctl: ${outputPath}`);
      return;
    }
  } catch {
    logger.warn("simctl io screenshot failed, falling back to window capture");
  }

  // Fallback: find Simulator window via CGWindowList and screencapture
  const swiftCode = FIND_WINDOW_SWIFT.trim();
  const { stdout: widOut } = await execAsync(
    `echo '${swiftCode.replace(/'/g, "'\\''")}' | swift -`,
    { timeout: 20_000, shell: "/bin/zsh" }
  ).catch(() => ({ stdout: "" }));

  const wid = parseInt(widOut.trim(), 10);
  if (!wid || isNaN(wid)) {
    throw new Error(
      "Could not find Simulator window. Ensure Simulator.app is open and the device window is visible."
    );
  }

  await execAsync(`screencapture -l ${wid} -x "${outputPath}"`, { timeout: 15_000 });
  logger.info(`Screenshot saved via screencapture (wid=${wid}): ${outputPath}`);
}

