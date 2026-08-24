/**
 * Path and state-directory resolution.
 *
 * Two rules this module exists to enforce:
 *   1. Never derive a filesystem path from `new URL(...).pathname`. On Windows
 *      that yields `/C:/Users/...` and percent-encodes spaces. Always go
 *      through `fileURLToPath`.
 *   2. Never hand-join with "/" or "\\". `node:path` knows the separator.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Resolve the plugin root from a module's `import.meta.url`.
 * Scripts live at <root>/scripts/lib/, so the root is two levels up.
 */
export function pluginRootFrom(importMetaUrl, levelsUp = 2) {
  let dir = path.dirname(fileURLToPath(importMetaUrl));
  for (let i = 0; i < levelsUp; i += 1) {
    dir = path.dirname(dir);
  }
  return dir;
}

/**
 * Codex's home directory. Codex honours CODEX_HOME and passes it to plugin
 * subprocesses, so state written here follows the user's Codex install rather
 * than assuming ~/.codex.
 */
export function codexHome(env = process.env, homedir = os.homedir()) {
  const configured = env.CODEX_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(homedir, ".codex");
}

/**
 * Where background job records live.
 *
 * Deliberately not os.tmpdir(): /cc:result must survive a reboot, and on
 * Windows the temp directory is aggressively cleaned. Deliberately not an
 * XDG/AppData split either — following CODEX_HOME keeps one rule for all three
 * platforms and keeps cc's state next to the tool it extends.
 *
 * CC_STATE_DIR overrides it outright. That is the escape hatch for a host that
 * is not Codex: Antigravity's per-install home is not exposed to plugin
 * subprocesses in any form this plugin has verified, so rather than guess at
 * one, the location stays explicit. Nothing ships that writes here yet — the
 * background job commands are still unbuilt — but the rule belongs with the
 * path code rather than in the commit that needs it.
 */
export function stateDir(env = process.env, homedir = os.homedir()) {
  const configured = env.CC_STATE_DIR?.trim();
  if (configured) {
    // Absolute only. path.resolve() would anchor a relative value to
    // process.cwd(), and on Antigravity that is ~/.gemini/antigravity-cli
    // rather than anywhere the user meant — a silently wrong location for
    // state that is supposed to outlive the session.
    if (!path.isAbsolute(configured)) {
      throw new Error(`CC_STATE_DIR must be an absolute path, got: ${configured}`);
    }
    return path.normalize(configured);
  }
  return path.join(codexHome(env, homedir), "cc", "jobs");
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Write a file atomically.
 *
 * `fs.rename` over an existing target is atomic on POSIX but can fail on
 * Windows with EPERM/EBUSY when an antivirus scanner or another reader briefly
 * holds the destination. Retry a few times before giving up.
 */
export function writeFileAtomic(filePath, contents, options = {}) {
  const retries = options.retries ?? 5;
  const sleepMs = options.sleepMs ?? 20;
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, contents, "utf8");

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return filePath;
    } catch (error) {
      lastError = error;
      if (error.code !== "EPERM" && error.code !== "EBUSY" && error.code !== "EACCES") {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    }
  }

  try {
    fs.unlinkSync(tempPath);
  } catch {
    // Best effort; the temp file is namespaced by pid.
  }
  throw lastError;
}

/**
 * Split command output into lines regardless of the producing platform.
 * Git on Windows emits CRLF, and a repo with core.autocrlf=true will emit CRLF
 * inside diff bodies too.
 */
export function splitLines(text) {
  return String(text).split(/\r?\n/);
}
