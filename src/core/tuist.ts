// ============================================================
// XcodeAutoPilot — Tuist CLI Wrapper
// Version-aware: Tuist 3.x (fetch/generate) vs 4.x (install/generate)
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
import { readdir } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);

const TUIST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface TuistStepResult {
  success: boolean;
  raw_output: string;
  duration_seconds: number;
}

export interface TuistGenerateResult extends TuistStepResult {
  workspace_path: string | null;
}

// ----------------------------------------------------------
// Version detection
// ----------------------------------------------------------

export async function getTuistMajorVersion(): Promise<number> {
  try {
    const { stdout } = await execAsync("tuist version", { timeout: 10_000 });
    const match = stdout.trim().match(/^(\d+)\./);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch {
    // tuist not found or failed
  }
  throw new Error("Could not detect Tuist version. Is Tuist installed? Run: curl -Ls https://install.tuist.io | bash");
}

// ----------------------------------------------------------
// Dependency installation
// ----------------------------------------------------------

export async function tuistInstall(
  projectDir: string,
  majorVersion: number
): Promise<TuistStepResult> {
  // v4+: tuist install, v3.x: tuist fetch
  const cmd = majorVersion >= 4 ? "tuist install" : "tuist fetch";
  logger.info(`Tuist v${majorVersion}: running '${cmd}' in ${projectDir}`);

  const startTime = Date.now();
  let rawOutput = "";
  let success = true;

  try {
    const result = await execAsync(cmd, {
      cwd: projectDir,
      timeout: TUIST_TIMEOUT_MS,
    });
    rawOutput = result.stdout + result.stderr;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; killed?: boolean };
    if (execErr.killed) {
      throw new Error(`'${cmd}' timed out after ${TUIST_TIMEOUT_MS / 1000}s`);
    }
    rawOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    success = false;
  }

  return {
    success,
    raw_output: rawOutput,
    duration_seconds: (Date.now() - startTime) / 1000,
  };
}

// ----------------------------------------------------------
// Project generation
// ----------------------------------------------------------

export async function tuistGenerate(projectDir: string): Promise<TuistGenerateResult> {
  const cmd = "tuist generate --no-open";
  logger.info(`Tuist generate: running '${cmd}' in ${projectDir}`);

  const startTime = Date.now();
  let rawOutput = "";
  let success = true;

  try {
    const result = await execAsync(cmd, {
      cwd: projectDir,
      timeout: TUIST_TIMEOUT_MS,
    });
    rawOutput = result.stdout + result.stderr;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; killed?: boolean };
    if (execErr.killed) {
      throw new Error(`'${cmd}' timed out after ${TUIST_TIMEOUT_MS / 1000}s`);
    }
    rawOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    success = false;
  }

  const duration = (Date.now() - startTime) / 1000;

  // Find the generated .xcworkspace
  const workspacePath = success ? await findGeneratedWorkspace(projectDir) : null;

  return {
    success,
    raw_output: rawOutput,
    duration_seconds: duration,
    workspace_path: workspacePath,
  };
}

// ----------------------------------------------------------
// Workspace discovery (post-generate)
// ----------------------------------------------------------

async function findGeneratedWorkspace(projectDir: string): Promise<string | null> {
  try {
    const entries = await readdir(projectDir);
    const workspace = entries.find((e) => e.endsWith(".xcworkspace"));
    if (workspace) {
      return join(projectDir, workspace);
    }
  } catch {
    // ignore
  }
  return null;
}
