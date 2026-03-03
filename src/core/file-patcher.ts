// ============================================================
// XcodeAutoPilot — File Patcher
// Applies Claude-generated fixes to source files with backup/rollback
// ============================================================

import { readFile, writeFile, copyFile, mkdir } from "fs/promises";
import { join, dirname, relative, basename } from "path";
import { logger } from "../utils/logger.js";
import type { Fix, PatchResult, RollbackRecord } from "../types.js";

const BACKUP_DIR = process.env.AUTOPILOT_BACKUP_DIR ?? ".autofix-backup";
const FILE_SIZE_LIMIT = parseInt(
  process.env.AUTOPILOT_FILE_SIZE_LIMIT ?? "1048576",
  10
);

// ----------------------------------------------------------
// Backup
// ----------------------------------------------------------

/**
 * Create a timestamped backup directory path.
 */
export function createBackupPath(): string {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+/, "")
    .substring(0, 15); // YYYYMMDDHHmmss format → e.g. "20250303141523"
  return join(BACKUP_DIR, ts);
}

/**
 * Back up a file to the backup directory.
 * Returns the backup file path.
 */
export async function backupFile(
  filePath: string,
  backupBasePath: string,
  projectPath: string
): Promise<string> {
  // Compute relative path inside project to preserve directory structure
  let relativePath: string;
  try {
    relativePath = relative(projectPath, filePath);
  } catch {
    relativePath = basename(filePath);
  }

  const backupFilePath = join(backupBasePath, relativePath);
  const backupFileDir = dirname(backupFilePath);

  await mkdir(backupFileDir, { recursive: true });
  await copyFile(filePath, backupFilePath);

  logger.debug(`Backed up: ${filePath} → ${backupFilePath}`);
  return backupFilePath;
}

/**
 * Restore a file from its backup.
 */
export async function restoreFromBackup(
  originalPath: string,
  backupPath: string
): Promise<void> {
  await copyFile(backupPath, originalPath);
  logger.info(`Rolled back: ${originalPath} ← ${backupPath}`);
}

// ----------------------------------------------------------
// Patch application
// ----------------------------------------------------------

/**
 * Apply a list of fixes to their respective source files.
 *
 * Rules:
 * - Group fixes by file.
 * - Sort fixes within each file in DESCENDING line order (bottom → top)
 *   so that line numbers don't shift after earlier edits.
 * - Verify original_line matches before applying.
 * - Back up each file once before the first patch.
 * - If fixed_line contains \n, split it into multiple lines.
 */
export async function applyFixes(
  fixes: Fix[],
  backupBasePath: string,
  projectPath: string
): Promise<PatchResult> {
  const applied: Fix[] = [];
  const skipped: { fix: Fix; reason: string }[] = [];
  const backed_up: string[] = [];

  // Group by file path
  const byFile = new Map<string, Fix[]>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.file_path) ?? [];
    existing.push(fix);
    byFile.set(fix.file_path, existing);
  }

  for (const [filePath, fileFixes] of byFile) {
    // Check file size
    try {
      const { stat } = await import("fs/promises");
      const stats = await stat(filePath);
      if (stats.size > FILE_SIZE_LIMIT) {
        for (const fix of fileFixes) {
          skipped.push({ fix, reason: `File exceeds size limit: ${stats.size} bytes` });
        }
        continue;
      }
    } catch (err) {
      for (const fix of fileFixes) {
        skipped.push({ fix, reason: `Cannot stat file: ${String(err)}` });
      }
      continue;
    }

    // Read file
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      for (const fix of fileFixes) {
        skipped.push({ fix, reason: `Cannot read file: ${String(err)}` });
      }
      continue;
    }

    const lines = content.split("\n");

    // Backup file (once)
    try {
      const backupPath = await backupFile(filePath, backupBasePath, projectPath);
      backed_up.push(backupPath);
    } catch (err) {
      logger.warn(`Failed to backup ${filePath}: ${String(err)}. Skipping all fixes for this file.`);
      for (const fix of fileFixes) {
        skipped.push({ fix, reason: `Backup failed: ${String(err)}` });
      }
      continue;
    }

    // Sort descending by line number (bottom → top application)
    const sortedFixes = [...fileFixes].sort((a, b) => b.line_number - a.line_number);

    let fileModified = false;

    for (const fix of sortedFixes) {
      const lineIdx = fix.line_number - 1; // Convert to 0-indexed

      if (lineIdx < 0 || lineIdx >= lines.length) {
        skipped.push({ fix, reason: `Line ${fix.line_number} out of range (file has ${lines.length} lines)` });
        continue;
      }

      const actualLine = lines[lineIdx];

      // Verify original_line matches (trim both for whitespace tolerance)
      if (actualLine.trim() !== fix.original_line.trim()) {
        skipped.push({
          fix,
          reason:
            `Line content mismatch at ${fix.line_number}. ` +
            `Expected: "${fix.original_line.trim()}" ` +
            `Got: "${actualLine.trim()}"`,
        });
        continue;
      }

      // Apply fix — handle multiline fixed_line
      const fixedLines = fix.fixed_line.split("\n");

      // Preserve original indentation if fixed_line starts with no indentation
      // but original_line has indentation
      const originalIndent = actualLine.match(/^(\s*)/)?.[1] ?? "";
      const needsIndentPreservation = fix.fixed_line.match(/^\S/) && originalIndent.length > 0;

      const replacementLines = needsIndentPreservation
        ? fixedLines.map((l, i) => (i === 0 ? originalIndent + l.trimStart() : l))
        : fixedLines;

      lines.splice(lineIdx, 1, ...replacementLines);
      applied.push(fix);
      fileModified = true;

      logger.debug(
        `Applied fix at ${filePath}:${fix.line_number}: ${fix.explanation}`
      );
    }

    // Write modified file
    if (fileModified) {
      try {
        await writeFile(filePath, lines.join("\n"), "utf-8");
        logger.info(`Patched: ${filePath} (${sortedFixes.length} fix(es) attempted)`);
      } catch (err) {
        logger.error(`Failed to write ${filePath}: ${String(err)}`);
        // Mark all applied fixes for this file as skipped (we couldn't write)
        for (const fix of fileFixes) {
          const idx = applied.findIndex((f) => f === fix);
          if (idx !== -1) {
            applied.splice(idx, 1);
            skipped.push({ fix, reason: `Write failed: ${String(err)}` });
          }
        }
      }
    }
  }

  return { applied, skipped, backed_up };
}

// ----------------------------------------------------------
// Rollback
// ----------------------------------------------------------

/**
 * Roll back all files in a backup directory to their original locations.
 */
export async function rollbackAll(
  backupBasePath: string,
  projectPath: string
): Promise<RollbackRecord[]> {
  const records: RollbackRecord[] = [];
  const timestamp = new Date().toISOString();

  // Walk backup directory
  const { readdirSync, statSync } = await import("fs");

  function walkDir(dir: string): string[] {
    const entries: string[] = [];
    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          entries.push(...walkDir(fullPath));
        } else {
          entries.push(fullPath);
        }
      }
    } catch {
      // ignore
    }
    return entries;
  }

  const backupFiles = walkDir(backupBasePath);

  for (const backupFile of backupFiles) {
    const relPath = relative(backupBasePath, backupFile);
    const originalPath = join(projectPath, relPath);

    try {
      await restoreFromBackup(originalPath, backupFile);
      records.push({
        iteration: 0, // Will be filled by caller
        file_path: originalPath,
        backup_path: backupFile,
        reason: "Error count increased — rolling back all changes",
        timestamp,
      });
    } catch (err) {
      logger.error(`Rollback failed for ${originalPath}: ${String(err)}`);
    }
  }

  return records;
}
