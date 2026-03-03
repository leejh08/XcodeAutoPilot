// ============================================================
// XcodeAutoPilot — Logger (stderr only)
// MCP servers must use stderr for logging (stdout = protocol)
// ============================================================

const PREFIX = "[XcodeAutoPilot]";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string): void {
  console.error(`${PREFIX} [${timestamp()}] [${level}] ${message}`);
}

export const logger = {
  info(message: string): void {
    log("INFO", message);
  },

  warn(message: string): void {
    log("WARN", message);
  },

  error(message: string): void {
    log("ERROR", message);
  },

  debug(message: string): void {
    if (process.env.AUTOPILOT_DEBUG === "1") {
      log("DEBUG", message);
    }
  },

  /**
   * Log iteration progress in a structured, readable format.
   * Example: [XcodeAutoPilot] [iteration 2/5] 에러 5개 발견, Claude API 호출 중...
   */
  iteration(current: number, total: number, message: string): void {
    console.error(`${PREFIX} [iteration ${current}/${total}] ${message}`);
  },

  /**
   * Log a section separator for readability.
   */
  section(title: string): void {
    console.error(`${PREFIX} ${"─".repeat(50)}`);
    console.error(`${PREFIX} ${title}`);
    console.error(`${PREFIX} ${"─".repeat(50)}`);
  },

  /**
   * Log a summary line (important outcome).
   */
  summary(message: string): void {
    console.error(`${PREFIX} ✦ ${message}`);
  },
};
