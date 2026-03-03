import { describe, it, expect } from "vitest";
import { extractFileContext } from "../src/utils/context-extractor.js";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function createTempFile(content: string): Promise<string> {
  const path = join(tmpdir(), `xca-test-${Date.now()}-${Math.random().toString(36).slice(2)}.swift`);
  await writeFile(path, content, "utf-8");
  return path;
}

describe("extractFileContext", () => {
  it("extracts context around error line", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `  line ${i + 1}`).join("\n");
    const filePath = await createTempFile(lines);

    try {
      const ctx = await extractFileContext(filePath, [50]);
      expect(ctx).not.toBeNull();
      expect(ctx!.start_line).toBeLessThanOrEqual(50);
      expect(ctx!.end_line).toBeGreaterThanOrEqual(50);
      expect(ctx!.context_text).toContain("50");
    } finally {
      await unlink(filePath);
    }
  });

  it("marks error lines with > prefix", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5";
    const filePath = await createTempFile(content);

    try {
      const ctx = await extractFileContext(filePath, [3], 5);
      expect(ctx).not.toBeNull();
      expect(ctx!.context_text).toContain(">");
    } finally {
      await unlink(filePath);
    }
  });

  it("returns null for non-existent file", async () => {
    const ctx = await extractFileContext("/non/existent/file.swift", [1]);
    expect(ctx).toBeNull();
  });

  it("handles multiple error lines in same file", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    const filePath = await createTempFile(lines);

    try {
      const ctx = await extractFileContext(filePath, [50, 150], 10);
      expect(ctx).not.toBeNull();
      expect(ctx!.error_lines).toContain(50);
      expect(ctx!.error_lines).toContain(150);
    } finally {
      await unlink(filePath);
    }
  });

  it("clamps range to file boundaries", async () => {
    const content = "line 1\nline 2\nline 3";
    const filePath = await createTempFile(content);

    try {
      const ctx = await extractFileContext(filePath, [2], 100);
      expect(ctx).not.toBeNull();
      expect(ctx!.start_line).toBe(1);
      expect(ctx!.end_line).toBe(3);
    } finally {
      await unlink(filePath);
    }
  });
});
