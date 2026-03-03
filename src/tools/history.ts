// ============================================================
// XcodeAutoPilot — autopilot_history Tool
// Returns in-memory session history of autopilot_run executions
// ============================================================

import type { AutopilotReport, SessionHistoryEntry } from "../types.js";
import { logger } from "../utils/logger.js";

const sessionHistory: SessionHistoryEntry[] = [];

export function recordSessionStart(projectPath: string, scheme: string): number {
  const entry: SessionHistoryEntry = {
    project_path: projectPath,
    scheme,
    started_at: new Date().toISOString(),
    status: "running",
  };
  sessionHistory.push(entry);
  return sessionHistory.length - 1;
}

export function recordSessionEnd(index: number, report: AutopilotReport): void {
  const entry = sessionHistory[index];
  if (!entry) return;
  entry.finished_at = new Date().toISOString();
  entry.report = report;
  entry.status =
    report.status === "success" || report.status === "partial" ? "completed" : "failed";
}

export async function handleHistory(): Promise<string> {
  logger.info("autopilot_history: returning session history");

  if (sessionHistory.length === 0) {
    return JSON.stringify(
      {
        message: "No autopilot sessions have been run in this server session.",
        sessions: [],
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      total_sessions: sessionHistory.length,
      sessions: sessionHistory.map((entry, idx) => ({
        session_id: idx + 1,
        project_path: entry.project_path,
        scheme: entry.scheme,
        started_at: entry.started_at,
        finished_at: entry.finished_at,
        status: entry.status,
        summary: entry.report?.summary ?? "In progress...",
        fixes_applied: entry.report?.all_fixes.length ?? 0,
        errors_remaining: entry.report?.remaining_errors.length ?? 0,
        iterations: entry.report?.iterations.length ?? 0,
        backup_path: entry.report?.backup_path ?? "",
      })),
    },
    null,
    2
  );
}
