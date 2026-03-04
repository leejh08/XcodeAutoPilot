// ============================================================
// XcodeAutoPilot — autopilot_cache_clean Tool
// Selectively clear Xcode caches beyond xcodebuild clean
// ============================================================

import { z } from "zod";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils/logger.js";

export const cacheClearSchema = z.object({
  project_path: z
    .string()
    .describe("Absolute path to .xcodeproj or .xcworkspace"),
  scope: z
    .enum(["project", "module_cache", "spm", "index", "all"])
    .describe(
      "Cache scope: 'project' (DerivedData for this project only), " +
        "'module_cache' (Xcode ModuleCache.noindex), " +
        "'spm' (SPM fetch cache + project SourcePackages), " +
        "'index' (Index store for this project), " +
        "'all' (all of the above)"
    ),
});

export type CacheClearInput = z.infer<typeof cacheClearSchema>;

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function extractProjectName(projectPath: string): string {
  return path.basename(projectPath).replace(/\.(xcodeproj|xcworkspace)$/, "");
}

async function getDirSize(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map((entry) => {
        const full = path.join(dirPath, entry.name);
        return entry.isDirectory() ? getDirSize(full) : fs.stat(full).then((s) => s.size).catch(() => 0);
      })
    );
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface CleanEntry {
  path: string;
  freed: string;
  status: "deleted" | "not_found" | "error";
  error?: string;
}

async function removeDir(dirPath: string): Promise<CleanEntry> {
  try {
    const size = await getDirSize(dirPath);
    await fs.rm(dirPath, { recursive: true, force: true });
    logger.info(`Removed: ${dirPath} (${formatBytes(size)})`);
    return { path: dirPath, freed: formatBytes(size), status: "deleted" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: dirPath, freed: "0 B", status: "error", error: message };
  }
}

async function tryRemoveDir(dirPath: string): Promise<CleanEntry> {
  try {
    await fs.access(dirPath);
    return removeDir(dirPath);
  } catch {
    return { path: dirPath, freed: "0 B", status: "not_found" };
  }
}

/** Find DerivedData subdirs matching <projectName>-<hash> */
async function findProjectDerivedDataDirs(projectName: string): Promise<string[]> {
  const base = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData");
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith(projectName + "-"))
      .map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
}

// ----------------------------------------------------------
// Scope handlers
// ----------------------------------------------------------

/** 'project': entire DerivedData folder(s) for this project */
async function cleanProject(projectName: string): Promise<CleanEntry[]> {
  const dirs = await findProjectDerivedDataDirs(projectName);
  if (dirs.length === 0) {
    const placeholder = path.join(
      os.homedir(),
      `Library/Developer/Xcode/DerivedData/${projectName}-*`
    );
    return [{ path: placeholder, freed: "0 B", status: "not_found" }];
  }
  return Promise.all(dirs.map(removeDir));
}

/** 'module_cache': ~/Library/Developer/Xcode/DerivedData/ModuleCache.noindex */
async function cleanModuleCache(): Promise<CleanEntry[]> {
  const p = path.join(
    os.homedir(),
    "Library/Developer/Xcode/DerivedData/ModuleCache.noindex"
  );
  return [await tryRemoveDir(p)];
}

/** 'spm': global SPM fetch cache + project SourcePackages in DerivedData */
async function cleanSpm(projectName: string): Promise<CleanEntry[]> {
  const globalSpmCache = path.join(
    os.homedir(),
    "Library/Caches/org.swift.swiftpm"
  );
  const results: CleanEntry[] = [await tryRemoveDir(globalSpmCache)];

  const projectDirs = await findProjectDerivedDataDirs(projectName);
  for (const dir of projectDirs) {
    const sourcePackages = path.join(dir, "SourcePackages");
    results.push(await tryRemoveDir(sourcePackages));
  }

  if (projectDirs.length === 0) {
    const placeholder = path.join(
      os.homedir(),
      `Library/Developer/Xcode/DerivedData/${projectName}-*/SourcePackages`
    );
    results.push({ path: placeholder, freed: "0 B", status: "not_found" });
  }

  return results;
}

/** 'index': Index.noindex (or Index) inside project DerivedData */
async function cleanIndex(projectName: string): Promise<CleanEntry[]> {
  const projectDirs = await findProjectDerivedDataDirs(projectName);
  if (projectDirs.length === 0) {
    const placeholder = path.join(
      os.homedir(),
      `Library/Developer/Xcode/DerivedData/${projectName}-*/Index.noindex`
    );
    return [{ path: placeholder, freed: "0 B", status: "not_found" }];
  }

  const results: CleanEntry[] = [];
  for (const dir of projectDirs) {
    // Xcode may use either name depending on version
    const indexNoindex = path.join(dir, "Index.noindex");
    const index = path.join(dir, "Index");
    results.push(await tryRemoveDir(indexNoindex));
    const indexEntry = await tryRemoveDir(index);
    if (indexEntry.status !== "not_found") results.push(indexEntry);
  }
  return results;
}

// ----------------------------------------------------------
// Main handler
// ----------------------------------------------------------

export async function handleCacheClean(input: CacheClearInput): Promise<string> {
  logger.info(`autopilot_cache_clean: scope=${input.scope} project=${input.project_path}`);

  const projectName = extractProjectName(input.project_path);
  const results: CleanEntry[] = [];

  const runProject = input.scope === "project" || input.scope === "all";
  const runModuleCache = input.scope === "module_cache" || input.scope === "all";
  const runSpm = input.scope === "spm" || input.scope === "all";
  const runIndex = input.scope === "index" || input.scope === "all";

  if (runProject) results.push(...(await cleanProject(projectName)));
  if (runModuleCache) results.push(...(await cleanModuleCache()));
  if (runSpm) results.push(...(await cleanSpm(projectName)));
  if (runIndex) results.push(...(await cleanIndex(projectName)));

  const deleted = results.filter((r) => r.status === "deleted");
  const notFound = results.filter((r) => r.status === "not_found");
  const errors = results.filter((r) => r.status === "error");

  // Total freed (approximate sum — overlaps possible when scope=all + project removes everything)
  const summary =
    deleted.length > 0
      ? `Cleared ${deleted.length} cache location(s) for "${projectName}".`
      : `No cache found to clear for "${projectName}" (scope: ${input.scope}).`;

  return JSON.stringify(
    {
      success: errors.length === 0,
      summary,
      project_name: projectName,
      scope: input.scope,
      deleted: deleted.map((r) => ({ path: r.path, freed: r.freed })),
      not_found: notFound.map((r) => r.path),
      errors: errors.map((r) => ({ path: r.path, error: r.error })),
    },
    null,
    2
  );
}
