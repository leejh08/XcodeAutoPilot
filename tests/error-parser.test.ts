import { describe, it, expect } from "vitest";
import {
  parseXcodebuildOutput,
  filterErrors,
  filterWarnings,
  diagnosticsSignature,
  groupByFile,
} from "../src/core/error-parser.js";

const SAMPLE_OUTPUT = `
CompileSwift normal arm64 /Users/test/MyApp/Sources/ViewModel.swift
/Users/test/MyApp/Sources/ViewModel.swift:42:10: error: cannot convert value of type 'String' to expected argument type 'Int'
/Users/test/MyApp/Sources/ViewModel.swift:15:5: warning: variable 'unused' was never used; consider replacing with '_' or removing it
/Users/test/MyApp/Sources/Controller.swift:88:20: error: value of type 'UIView' has no member 'configure'
/Users/test/MyApp/Sources/Controller.swift:102:8: error: use of unresolved identifier 'dataSource'
ld: symbol(s) not found for architecture arm64
error: no such module 'MissingFramework'
** BUILD FAILED **
`;

describe("parseXcodebuildOutput", () => {
  it("parses standard Swift errors", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const errors = filterErrors(diagnostics);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("parses warnings correctly", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const warnings = filterWarnings(diagnostics);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].message).toContain("never used");
  });

  it("extracts correct file paths", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const errors = filterErrors(diagnostics);
    const filePaths = errors.map((e) => e.file_path);
    expect(filePaths).toContain("/Users/test/MyApp/Sources/ViewModel.swift");
    expect(filePaths).toContain("/Users/test/MyApp/Sources/Controller.swift");
  });

  it("extracts correct line and column numbers", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const errors = filterErrors(diagnostics);
    const viewModelError = errors.find(
      (e) => e.file_path === "/Users/test/MyApp/Sources/ViewModel.swift"
    );
    expect(viewModelError?.line_number).toBe(42);
    expect(viewModelError?.column_number).toBe(10);
  });

  it("parses linker errors", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const errors = filterErrors(diagnostics);
    const linkerError = errors.find((e) => e.file_path === "ld");
    expect(linkerError).toBeDefined();
    expect(linkerError?.message).toContain("Linker error");
  });

  it("deduplicates identical errors", () => {
    const duplicateOutput = SAMPLE_OUTPUT + SAMPLE_OUTPUT;
    const diagnostics = parseXcodebuildOutput(duplicateOutput);
    const errors = filterErrors(diagnostics);
    const viewModelErrors = errors.filter(
      (e) => e.file_path === "/Users/test/MyApp/Sources/ViewModel.swift"
    );
    expect(viewModelErrors.length).toBe(1);
  });

  it("skips BUILD FAILED marker lines", () => {
    const diagnostics = parseXcodebuildOutput("** BUILD FAILED **");
    expect(diagnostics.length).toBe(0);
  });
});

describe("diagnosticsSignature", () => {
  it("returns consistent signature for same errors", () => {
    const d1 = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const d2 = parseXcodebuildOutput(SAMPLE_OUTPUT);
    expect(diagnosticsSignature(d1)).toBe(diagnosticsSignature(d2));
  });

  it("returns different signatures for different errors", () => {
    const output1 = `/path/file.swift:1:1: error: first error`;
    const output2 = `/path/file.swift:2:1: error: second error`;
    const d1 = parseXcodebuildOutput(output1);
    const d2 = parseXcodebuildOutput(output2);
    expect(diagnosticsSignature(d1)).not.toBe(diagnosticsSignature(d2));
  });
});

describe("groupByFile", () => {
  it("groups diagnostics by file path", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const grouped = groupByFile(diagnostics);
    expect(grouped.has("/Users/test/MyApp/Sources/ViewModel.swift")).toBe(true);
    expect(grouped.has("/Users/test/MyApp/Sources/Controller.swift")).toBe(true);
  });

  it("excludes non-file diagnostics (ld, module)", () => {
    const diagnostics = parseXcodebuildOutput(SAMPLE_OUTPUT);
    const grouped = groupByFile(diagnostics);
    expect(grouped.has("ld")).toBe(false);
    expect(grouped.has("module")).toBe(false);
  });
});
