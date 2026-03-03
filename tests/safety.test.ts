import { describe, it, expect } from "vitest";
import {
  clampMaxIterations,
  isWithinProjectScope,
  isProtectedPath,
  validateFixes,
  createLoopDetectionState,
  detectLoop,
  detectErrorIncrease,
  acquireProjectLock,
  releaseProjectLock,
} from "../src/core/safety.js";
import type { BuildDiagnostic, Fix } from "../src/types.js";

describe("clampMaxIterations", () => {
  it("clamps values above 10 to 10", () => {
    expect(clampMaxIterations(15)).toBe(10);
    expect(clampMaxIterations(100)).toBe(10);
  });

  it("clamps values below 1 to 1", () => {
    expect(clampMaxIterations(0)).toBe(1);
    expect(clampMaxIterations(-5)).toBe(1);
  });

  it("preserves valid values", () => {
    expect(clampMaxIterations(5)).toBe(5);
    expect(clampMaxIterations(1)).toBe(1);
    expect(clampMaxIterations(10)).toBe(10);
  });
});

describe("isWithinProjectScope", () => {
  const projectPath = "/Users/test/MyApp";

  it("allows files within project", () => {
    const result = isWithinProjectScope("/Users/test/MyApp/Sources/File.swift", projectPath);
    expect(result.allowed).toBe(true);
  });

  it("rejects files outside project", () => {
    const result = isWithinProjectScope("/Users/other/File.swift", projectPath);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects relative paths", () => {
    const result = isWithinProjectScope("relative/path.swift", projectPath);
    expect(result.allowed).toBe(false);
  });
});

describe("isProtectedPath", () => {
  it("blocks Pods directory", () => {
    expect(isProtectedPath("/Users/test/MyApp/Pods/SomeLib/File.swift").allowed).toBe(false);
  });

  it("blocks .build directory", () => {
    expect(isProtectedPath("/Users/test/MyApp/.build/debug/File.swift").allowed).toBe(false);
  });

  it("blocks DerivedData", () => {
    expect(isProtectedPath("/Users/test/MyApp/DerivedData/Build/File.swift").allowed).toBe(false);
  });

  it("blocks .git directory", () => {
    expect(isProtectedPath("/Users/test/MyApp/.git/hooks/pre-commit").allowed).toBe(false);
  });

  it("allows normal source files", () => {
    expect(isProtectedPath("/Users/test/MyApp/Sources/ViewModel.swift").allowed).toBe(true);
  });
});

describe("validateFixes", () => {
  const projectPath = "/Users/test/MyApp";

  it("allows safe fixes", () => {
    const fixes: Fix[] = [
      {
        file_path: "/Users/test/MyApp/Sources/File.swift",
        line_number: 10,
        original_line: "  let x = y",
        fixed_line: "  let x: Int = y",
        explanation: "Added type annotation",
      },
    ];
    const { safeFixes, rejectedFixes } = validateFixes(fixes, projectPath);
    expect(safeFixes.length).toBe(1);
    expect(rejectedFixes.length).toBe(0);
  });

  it("rejects fixes outside project scope", () => {
    const fixes: Fix[] = [
      {
        file_path: "/Users/other/File.swift",
        line_number: 1,
        original_line: "let x = 1",
        fixed_line: "let x: Int = 1",
        explanation: "Test",
      },
    ];
    const { safeFixes, rejectedFixes } = validateFixes(fixes, projectPath);
    expect(safeFixes.length).toBe(0);
    expect(rejectedFixes.length).toBe(1);
  });

  it("rejects fixes in Pods directory", () => {
    const fixes: Fix[] = [
      {
        file_path: "/Users/test/MyApp/Pods/Lib/File.swift",
        line_number: 1,
        original_line: "let x = 1",
        fixed_line: "let x: Int = 1",
        explanation: "Test",
      },
    ];
    const { safeFixes, rejectedFixes } = validateFixes(fixes, projectPath);
    expect(safeFixes.length).toBe(0);
    expect(rejectedFixes.length).toBe(1);
  });
});

describe("loop detection", () => {
  it("detects same errors repeating", () => {
    const state = createLoopDetectionState();
    const diagnostics: BuildDiagnostic[] = [
      {
        type: "error",
        file_path: "/path/file.swift",
        line_number: 1,
        message: "some error",
        raw_output: "/path/file.swift:1:1: error: some error",
      },
    ];
    detectLoop(state, diagnostics);
    const isLoop = detectLoop(state, diagnostics);
    expect(isLoop).toBe(true);
  });

  it("does not flag different errors as loop", () => {
    const state = createLoopDetectionState();
    const d1: BuildDiagnostic[] = [
      { type: "error", file_path: "/f.swift", line_number: 1, message: "error A", raw_output: "" },
    ];
    const d2: BuildDiagnostic[] = [
      { type: "error", file_path: "/f.swift", line_number: 2, message: "error B", raw_output: "" },
    ];
    detectLoop(state, d1);
    expect(detectLoop(state, d2)).toBe(false);
  });
});

describe("error increase detection", () => {
  it("detects when error count increases", () => {
    const state = createLoopDetectionState();
    detectErrorIncrease(state, 5);
    expect(detectErrorIncrease(state, 7)).toBe(true);
  });

  it("does not flag decreasing errors", () => {
    const state = createLoopDetectionState();
    detectErrorIncrease(state, 5);
    expect(detectErrorIncrease(state, 3)).toBe(false);
  });
});

describe("project lock", () => {
  it("prevents concurrent runs on same project", () => {
    const path = "/Users/test/LockTestUnique";
    expect(acquireProjectLock(path).allowed).toBe(true);
    expect(acquireProjectLock(path).allowed).toBe(false);
    releaseProjectLock(path);
    expect(acquireProjectLock(path).allowed).toBe(true);
    releaseProjectLock(path);
  });
});
