/**
 * Platform primitives. Every function takes its platform/env/runner as an
 * injectable option so the whole module is testable on any host OS.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** Windows executable extensions that Node can spawn directly, in preference order. */
const WINDOWS_DIRECT_EXTS = [".exe", ".com"];

/**
 * Extensions that are batch shims. Node refuses to spawn these without a shell
 * (EINVAL, hardened in Node 18.20.2 / 20.12.2), so they need special handling.
 */
const WINDOWS_SHIM_EXTS = [".cmd", ".bat", ".ps1"];

export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * Run a command. Defaults to `shell: false` on every platform.
 *
 * Passing arguments through a shell is how repository-derived text (branch
 * names, paths, focus strings) turns into command injection, and how `(` in
 * `Bash(git diff:*)` turns into a cmd.exe syntax error. Resolve the executable
 * instead of leaning on the shell to find it.
 */
export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? false,
    windowsHide: true
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  parts.push(result.signal ? `signal=${result.signal}` : `exit=${result.status}`);
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}

/**
 * Classify a resolved executable path.
 *
 * `direct` can be spawned with `shell: false`. `shim` is a .cmd/.bat/.ps1
 * wrapper that Node will not spawn without a shell — usable, but it forces
 * every argument through cmd.exe quoting rules, so we prefer a direct binary
 * whenever one exists.
 */
export function classifyExecutable(executablePath, platform = process.platform) {
  if (!executablePath) {
    return { kind: "missing", requiresShell: false };
  }

  if (!isWindows(platform)) {
    return { kind: "direct", requiresShell: false };
  }

  const ext = path.extname(executablePath).toLowerCase();
  if (WINDOWS_SHIM_EXTS.includes(ext)) {
    return { kind: "shim", requiresShell: true };
  }
  if (WINDOWS_DIRECT_EXTS.includes(ext)) {
    return { kind: "direct", requiresShell: false };
  }
  // Extensionless on Windows is unusual and not directly spawnable.
  return { kind: "shim", requiresShell: true };
}

/**
 * Locate an executable on PATH, preferring a directly spawnable binary over a
 * batch shim when the platform offers both (npm installs on Windows typically
 * drop `claude`, `claude.cmd`, and `claude.ps1` side by side).
 */
export function findExecutable(name, options = {}) {
  const platform = options.platform ?? process.platform;
  const runner = options.runCommandImpl ?? runCommand;
  const finder = isWindows(platform) ? "where" : "which";
  const args = isWindows(platform) ? [name] : ["-a", name];

  const result = runner(finder, args, { env: options.env, cwd: options.cwd });
  if (result.error || result.status !== 0) {
    return null;
  }

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  const direct = candidates.find(
    (candidate) => classifyExecutable(candidate, platform).kind === "direct"
  );

  return direct ?? candidates[0];
}
