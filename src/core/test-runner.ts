// ============================================================
// XcodeAutoPilot — xcodebuild test Runner & Parser
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);

const TEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface TestFailure {
  test_class: string;         // e.g. "CalculatorTests"
  test_method: string;        // e.g. "testAddition"
  full_name: string;          // e.g. "CalculatorTests.testAddition"
  file_path: string;
  line_number: number;
  message: string;
}

export interface TestResult {
  success: boolean;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
  raw_output: string;
  duration_seconds: number;
  exit_code: number;
}

export interface TestOptions {
  project_path: string;
  scheme: string;
  configuration?: string;
  destination?: string;
  test_plan?: string;
  only_testing?: string[];   // e.g. ["CalculatorTests/testAddition"]
}

// ----------------------------------------------------------
// Run xcodebuild test
// ----------------------------------------------------------

export async function runTests(opts: TestOptions): Promise<TestResult> {
  const startTime = Date.now();

  const flag = opts.project_path.endsWith(".xcworkspace") ? "-workspace" : "-project";
  const destination = opts.destination ?? "platform=iOS Simulator,name=iPhone 16";

  const parts: string[] = [
    "xcodebuild",
    flag, `"${opts.project_path}"`,
    "-scheme", `"${opts.scheme}"`,
    "-configuration", opts.configuration ?? "Debug",
    "-destination", `'${destination}'`,
  ];

  if (opts.test_plan) {
    parts.push("-testPlan", `"${opts.test_plan}"`);
  }

  if (opts.only_testing && opts.only_testing.length > 0) {
    for (const t of opts.only_testing) {
      parts.push("-only-testing", `"${t}"`);
    }
  }

  parts.push("test", "2>&1");
  const cmd = parts.join(" ");

  logger.info(`Running tests: ${cmd}`);

  let rawOutput = "";
  let exitCode = 0;

  try {
    const result = await execAsync(cmd, {
      timeout: TEST_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (execErr.killed) {
      throw new Error(`xcodebuild test timed out after ${TEST_TIMEOUT_MS / 1000}s`);
    }
    rawOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    exitCode = execErr.code ?? 1;
  }

  const duration = (Date.now() - startTime) / 1000;
  const parsed = parseTestOutput(rawOutput);

  logger.info(
    `Tests finished in ${duration.toFixed(1)}s — ` +
    `${parsed.total} total, ${parsed.failures.length} failed`
  );

  return {
    success: exitCode === 0 && parsed.failures.length === 0,
    total_tests: parsed.total,
    passed: parsed.total - parsed.failures.length - parsed.skipped,
    failed: parsed.failures.length,
    skipped: parsed.skipped,
    failures: parsed.failures,
    raw_output: rawOutput,
    duration_seconds: duration,
    exit_code: exitCode,
  };
}

// ----------------------------------------------------------
// Parse xcodebuild test output
// ----------------------------------------------------------

interface ParsedOutput {
  total: number;
  skipped: number;
  failures: TestFailure[];
}

function parseTestOutput(output: string): ParsedOutput {
  const lines = output.split("\n");
  const failures: TestFailure[] = [];
  let total = 0;
  let skipped = 0;

  // Track current failing test for multi-line messages
  let currentFailure: Partial<TestFailure> | null = null;

  for (const line of lines) {
    // ── Parse failure line: "<file>:<line>: error: -[Class method] : <msg>"
    // Format 1: /path/File.swift:25: error: -[Suite.Class method] : message
    // Format 2: /path/File.swift:25: error: -[Class method] : message
    const errorMatch = line.match(
      /^(.+\.swift):(\d+):\s+error:\s+-\[[\w.]+\.([\w]+)\s+([\w]+)\]\s+:\s+(.+)$/
    ) || line.match(
      /^(.+\.swift):(\d+):\s+error:\s+-\[([\w]+)\s+([\w]+)\]\s+:\s+(.+)$/
    );

    if (errorMatch) {
      const [, filePath, lineStr, testClass, testMethod, message] = errorMatch;
      currentFailure = {
        test_class: testClass,
        test_method: testMethod,
        full_name: `${testClass}/${testMethod}`,
        file_path: filePath.trim(),
        line_number: parseInt(lineStr, 10),
        message: message.trim(),
      };
      continue;
    }

    // ── Test Case failed line
    // "Test Case '-[Suite.Class method]' failed (0.001 seconds)."
    const failedMatch = line.match(
      /Test Case '-\[[\w.]+\.([\w]+)\s+([\w]+)\]' failed/
    ) || line.match(
      /Test Case '-\[([\w]+)\s+([\w]+)\]' failed/
    );

    if (failedMatch) {
      const [, testClass, testMethod] = failedMatch;
      if (currentFailure && currentFailure.test_class === testClass) {
        // Finalize the failure
        failures.push(currentFailure as TestFailure);
      } else {
        // Failure without a preceding error line (e.g. crash)
        failures.push({
          test_class: testClass,
          test_method: testMethod,
          full_name: `${testClass}/${testMethod}`,
          file_path: "",
          line_number: 0,
          message: "Test failed (no assertion message — possible crash or timeout)",
        });
      }
      currentFailure = null;
      continue;
    }

    // ── Executed N tests, with M failure(s)
    // "Executed 42 tests, with 3 failures (0 unexpected) in 1.234 (5.678) seconds"
    const summaryMatch = line.match(
      /Executed\s+(\d+)\s+test[s]?,\s+with\s+(\d+)\s+failure/i
    );
    if (summaryMatch) {
      total = Math.max(total, parseInt(summaryMatch[1], 10));
      continue;
    }

    // ── Skipped
    const skippedMatch = line.match(/(\d+)\s+test[s]?\s+skipped/i);
    if (skippedMatch) {
      skipped = Math.max(skipped, parseInt(skippedMatch[1], 10));
    }
  }

  return { total, skipped, failures };
}
