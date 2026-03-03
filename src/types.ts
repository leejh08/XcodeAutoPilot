// ============================================================
// XcodeAutoPilot — Shared Type Definitions
// ============================================================

// ----------------------------------------------------------
// Build Engine Types
// ----------------------------------------------------------

export interface BuildDiagnostic {
  type: "error" | "warning";
  file_path: string;
  line_number: number;
  column_number?: number;
  message: string;
  raw_output: string;
}

export interface BuildOptions {
  project_path: string;       // .xcodeproj or .xcworkspace absolute path
  scheme: string;
  configuration?: string;     // "Debug" | "Release", default: "Debug"
  destination?: string;       // e.g. "platform=iOS Simulator,name=iPhone 16"
  derived_data_path?: string;
}

export interface BuildResult {
  success: boolean;
  diagnostics: BuildDiagnostic[];
  raw_output: string;
  duration_seconds: number;
  exit_code: number;
}

// ----------------------------------------------------------
// Fix / Patch Types
// ----------------------------------------------------------

export interface Fix {
  file_path: string;
  line_number: number;
  original_line: string;
  fixed_line: string;
  explanation: string;
}

export interface UnfixableError {
  file_path: string;
  line_number: number;
  error_message: string;
  reason: string;
}

export interface ClaudeFixResponse {
  fixes: Fix[];
  unfixable: UnfixableError[];
}

export interface SkippedFix {
  fix: Fix;
  reason: string;
}

export interface PatchResult {
  applied: Fix[];
  skipped: SkippedFix[];
  backed_up: string[];        // List of backup file paths
}

export interface RollbackRecord {
  iteration: number;
  file_path: string;
  backup_path: string;
  reason: string;
  timestamp: string;
}

// ----------------------------------------------------------
// Autopilot Loop Types
// ----------------------------------------------------------

export interface IterationResult {
  iteration: number;
  errors_before: number;
  errors_after: number;
  fixes_applied: number;
  fixes_skipped: number;
  unfixable_count: number;
  duration_seconds: number;
}

export interface AppliedFixSummary {
  file: string;
  line: number;
  description: string;
  iteration: number;
}

export interface AutopilotReport {
  status: "success" | "partial" | "failed";
  summary: string;
  iterations: IterationResult[];
  all_fixes: AppliedFixSummary[];
  remaining_errors: BuildDiagnostic[];
  rollbacks: RollbackRecord[];
  unfixable: UnfixableError[];
  duration_seconds: number;
  backup_path: string;
  stop_reason?: string;
}

// ----------------------------------------------------------
// Tool Parameter Types
// ----------------------------------------------------------

export interface AutopilotRunParams {
  project_path: string;
  scheme: string;
  max_iterations?: number;    // default: 5, hard limit: 10
  configuration?: string;
  destination?: string;
  fix_warnings?: boolean;     // default: false
}

export interface AutopilotBuildParams {
  project_path: string;
  scheme: string;
  configuration?: string;
  destination?: string;
}

export interface AutopilotAnalyzeParams {
  project_path: string;
  scheme: string;
  configuration?: string;
  destination?: string;
}

export interface AutopilotListSchemesParams {
  project_path: string;
}

export interface AutopilotCleanParams {
  project_path: string;
  scheme: string;
}

// ----------------------------------------------------------
// History / Session Types
// ----------------------------------------------------------

export interface SessionHistoryEntry {
  project_path: string;
  scheme: string;
  started_at: string;
  finished_at?: string;
  report?: AutopilotReport;
  status: "running" | "completed" | "failed" | "aborted";
}

// ----------------------------------------------------------
// Safety Types
// ----------------------------------------------------------

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface LoopDetectionState {
  previous_error_signatures: string[];
  error_counts: number[];
}
