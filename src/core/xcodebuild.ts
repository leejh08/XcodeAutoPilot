// ============================================================
// XcodeAutoPilot — xcodebuild CLI Wrapper
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger.js";
import type { BuildOptions, BuildResult, BuildDiagnostic } from "../types.js";
import { parseXcodebuildOutput } from "./error-parser.js";

const execAsync = promisify(exec);

const BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ----------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------

function projectFlag(projectPath: string): string {
  return projectPath.endsWith(".xcworkspace") ? "-workspace" : "-project";
}

function buildCommand(opts: BuildOptions): string {
  const flag = projectFlag(opts.project_path);
  const parts: string[] = [
    "xcodebuild",
    flag,
    `"${opts.project_path}"`,
    "-scheme",
    `"${opts.scheme}"`,
    "-configuration",
    opts.configuration ?? "Debug",
  ];

  if (opts.destination) {
    parts.push("-destination", `'${opts.destination}'`);
  }

  if (opts.derived_data_path) {
    parts.push("-derivedDataPath", `"${opts.derived_data_path}"`);
  }

  parts.push("build", "2>&1");
  return parts.join(" ");
}

// ----------------------------------------------------------
// Simulator destination auto-detection
// ----------------------------------------------------------

interface SimDevice {
  name: string;
  udid: string;
  state: string;
}

interface SimctlOutput {
  devices: Record<string, SimDevice[]>;
}

export async function getDefaultDestination(): Promise<string> {
  try {
    const { stdout } = await execAsync("xcrun simctl list devices available --json", {
      timeout: 15_000,
    });
    const data = JSON.parse(stdout) as SimctlOutput;

    // Prefer iPhone 16, then any iPhone
    for (const [, devices] of Object.entries(data.devices)) {
      for (const device of devices) {
        if (device.state === "Booted" && device.name.startsWith("iPhone")) {
          return `platform=iOS Simulator,name=${device.name}`;
        }
      }
    }
    // Fallback: pick first available iPhone
    for (const [, devices] of Object.entries(data.devices)) {
      for (const device of devices) {
        if (device.name.includes("iPhone")) {
          return `platform=iOS Simulator,name=${device.name}`;
        }
      }
    }
  } catch {
    // Ignore — caller will omit destination
  }
  return "platform=iOS Simulator,name=iPhone 16";
}

// ----------------------------------------------------------
// Build
// ----------------------------------------------------------

export async function runBuild(opts: BuildOptions): Promise<BuildResult> {
  const startTime = Date.now();
  const cmd = buildCommand(opts);

  logger.info(`Running: ${cmd}`);

  let rawOutput = "";
  let exitCode = 0;

  try {
    const result = await execAsync(cmd, {
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };

    if (execErr.killed) {
      throw new Error(`xcodebuild timed out after ${BUILD_TIMEOUT_MS / 1000}s`);
    }

    rawOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    exitCode = execErr.code ?? 1;
  }

  const duration = (Date.now() - startTime) / 1000;
  const diagnostics = parseXcodebuildOutput(rawOutput);
  const errors = diagnostics.filter((d) => d.type === "error");

  logger.info(
    `Build finished in ${duration.toFixed(1)}s — ` +
      `${errors.length} error(s), ${diagnostics.length - errors.length} warning(s)`
  );

  return {
    success: exitCode === 0 && errors.length === 0,
    diagnostics,
    raw_output: rawOutput,
    duration_seconds: duration,
    exit_code: exitCode,
  };
}

// ----------------------------------------------------------
// Clean
// ----------------------------------------------------------

export async function runClean(projectPath: string, scheme: string): Promise<void> {
  const flag = projectFlag(projectPath);
  const cmd = `xcodebuild ${flag} "${projectPath}" -scheme "${scheme}" clean 2>&1`;

  logger.info(`Cleaning: ${cmd}`);

  try {
    await execAsync(cmd, { timeout: BUILD_TIMEOUT_MS });
    logger.info("Clean succeeded.");
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; message?: string };
    throw new Error(`Clean failed: ${execErr.message ?? String(err)}\n${execErr.stdout ?? ""}`);
  }
}

// ----------------------------------------------------------
// List schemes
// ----------------------------------------------------------

export async function listSchemes(projectPath: string): Promise<string[]> {
  const flag = projectFlag(projectPath);
  const cmd = `xcodebuild ${flag} "${projectPath}" -list 2>&1`;

  logger.info(`Listing schemes: ${cmd}`);

  let output = "";
  try {
    const result = await execAsync(cmd, { timeout: 30_000 });
    output = result.stdout;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    output = execErr.stdout ?? "";
  }

  // Parse scheme names from xcodebuild -list output
  const schemes: string[] = [];
  let inSchemes = false;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "Schemes:") {
      inSchemes = true;
      continue;
    }
    if (inSchemes) {
      if (trimmed === "" || trimmed.endsWith(":")) {
        inSchemes = false;
        continue;
      }
      schemes.push(trimmed);
    }
  }

  return schemes;
}

// ----------------------------------------------------------
// Resolve SPM dependencies
// ----------------------------------------------------------

export interface SpmResolveResult {
  success: boolean;
  raw_output: string;
  duration_seconds: number;
  exit_code: number;
}

export async function resolvePackageDependencies(
  projectPath: string,
  scheme: string
): Promise<SpmResolveResult> {
  const flag = projectFlag(projectPath);
  const cmd = `xcodebuild ${flag} "${projectPath}" -scheme "${scheme}" -resolvePackageDependencies 2>&1`;

  logger.info("Resolving SPM dependencies...");
  const startTime = Date.now();

  let rawOutput = "";
  let exitCode = 0;

  try {
    const result = await execAsync(cmd, { timeout: BUILD_TIMEOUT_MS });
    rawOutput = result.stdout;
    logger.info("SPM dependencies resolved successfully.");
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (execErr.killed) {
      throw new Error(`xcodebuild -resolvePackageDependencies timed out after ${BUILD_TIMEOUT_MS / 1000}s`);
    }
    rawOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    exitCode = execErr.code ?? 1;
    logger.warn(`SPM resolution failed (exit code ${exitCode})`);
  }

  return {
    success: exitCode === 0,
    raw_output: rawOutput,
    duration_seconds: (Date.now() - startTime) / 1000,
    exit_code: exitCode,
  };
}
