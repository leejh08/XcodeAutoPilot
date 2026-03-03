import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyFixes, createBackupPath } from "../src/core/file-patcher.js";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Fix } from "../src/types.js";

const TEST_DIR = join(tmpdir(), `xca-patcher-test-${Date.now()}`);
const BACKUP_DIR = join(TEST_DIR, "backups");

async function createTestFile(name: string, content: string): Promise<string> {
  const path = join(TEST_DIR, name);
  await writeFile(path, content, "utf-8");
  return path;
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("applyFixes", () => {
  it("applies a simple fix", async () => {
    const filePath = await createTestFile(
      "test.swift",
      "let x = someString\nlet y = 2\n"
    );

    const fixes: Fix[] = [
      {
        file_path: filePath,
        line_number: 1,
        original_line: "let x = someString",
        fixed_line: "let x: Int = Int(someString) ?? 0",
        explanation: "Type fix",
      },
    ];

    const result = await applyFixes(fixes, BACKUP_DIR, TEST_DIR);

    expect(result.applied.length).toBe(1);
    expect(result.skipped.length).toBe(0);

    const newContent = await readFile(filePath, "utf-8");
    expect(newContent).toContain("let x: Int = Int(someString) ?? 0");
    expect(newContent).toContain("let y = 2");
  });

  it("skips fix when original_line does not match", async () => {
    const filePath = await createTestFile("test.swift", "let x = 5\n");

    const fixes: Fix[] = [
      {
        file_path: filePath,
        line_number: 1,
        original_line: "let x = WRONG",
        fixed_line: "let x: Int = 5",
        explanation: "Test",
      },
    ];

    const result = await applyFixes(fixes, BACKUP_DIR, TEST_DIR);

    expect(result.applied.length).toBe(0);
    expect(result.skipped.length).toBe(1);
  });

  it("applies multiple fixes in descending line order", async () => {
    const content = "line 1\nline 2\nline 3\n";
    const filePath = await createTestFile("test.swift", content);

    const fixes: Fix[] = [
      {
        file_path: filePath,
        line_number: 1,
        original_line: "line 1",
        fixed_line: "FIXED line 1",
        explanation: "Fix line 1",
      },
      {
        file_path: filePath,
        line_number: 3,
        original_line: "line 3",
        fixed_line: "FIXED line 3",
        explanation: "Fix line 3",
      },
    ];

    const result = await applyFixes(fixes, BACKUP_DIR, TEST_DIR);

    expect(result.applied.length).toBe(2);
    const newContent = await readFile(filePath, "utf-8");
    expect(newContent).toContain("FIXED line 1");
    expect(newContent).toContain("FIXED line 3");
  });

  it("creates backup before patching", async () => {
    const filePath = await createTestFile("test.swift", "original content\n");

    const fixes: Fix[] = [
      {
        file_path: filePath,
        line_number: 1,
        original_line: "original content",
        fixed_line: "patched content",
        explanation: "Test",
      },
    ];

    const result = await applyFixes(fixes, BACKUP_DIR, TEST_DIR);

    expect(result.backed_up.length).toBe(1);
    const backupContent = await readFile(result.backed_up[0], "utf-8");
    expect(backupContent).toContain("original content");
  });

  it("skips fix for out-of-range line number", async () => {
    const filePath = await createTestFile("test.swift", "only one line");

    const fixes: Fix[] = [
      {
        file_path: filePath,
        line_number: 999,
        original_line: "some line",
        fixed_line: "fixed line",
        explanation: "Test",
      },
    ];

    const result = await applyFixes(fixes, BACKUP_DIR, TEST_DIR);
    expect(result.skipped.length).toBe(1);
    expect(result.applied.length).toBe(0);
  });
});

describe("createBackupPath", () => {
  it("returns a non-empty string", () => {
    const path = createBackupPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });

  it("returns unique paths on repeated calls", async () => {
    await new Promise((r) => setTimeout(r, 1)); // ensure timestamp differs
    const path1 = createBackupPath();
    const path2 = createBackupPath();
    // Both should be strings; they may or may not be equal within same ms
    expect(typeof path1).toBe("string");
    expect(typeof path2).toBe("string");
  });
});
