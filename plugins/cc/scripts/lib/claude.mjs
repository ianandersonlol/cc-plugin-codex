/**
 * The Claude Code runner.
 *
 * Design constraints, in priority order:
 *   1. Bill against the user's subscription — never set ANTHROPIC_API_KEY, and
 *      never pass --bare (its auth is API-key-only; OAuth and keychain are
 *      never read).
 *   2. Send the prompt on stdin, never as an argv entry. Windows caps a command
 *      line at ~32k characters and applies cmd.exe metacharacter rules; a
 *      review prompt carrying a scope summary blows past both.
 *   3. Resolve the executable and spawn with shell: false wherever possible.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  classifyExecutable,
  findExecutable,
  isWindows,
  runCommand
} from "./platform.mjs";

/** Read-only tool allowlist shared by /cc:review and /cc:adversarial-review. */
export const READ_ONLY_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git rev-parse:*)",
  "Bash(git ls-files:*)"
];

export const WRITE_DENIED_TOOLS = ["Edit", "Write", "NotebookEdit"];

/**
 * Locate the Claude Code CLI.
 *
 * Prefers the native install (a real binary) over an npm shim, because a
 * .cmd/.ps1 shim cannot be spawned without a shell on Windows.
 */
export function resolveClaudeBinary(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();
  const exists = options.existsImpl ?? ((p) => fs.existsSync(p));

  const override = env.CC_CLAUDE_BIN?.trim();
  if (override) {
    return { path: override, source: "CC_CLAUDE_BIN", ...classifyExecutable(override, platform) };
  }

  const nativeNames = isWindows(platform) ? ["claude.exe", "claude"] : ["claude"];
  for (const name of nativeNames) {
    const candidate = path.join(homedir, ".local", "bin", name);
    if (exists(candidate)) {
      return { path: candidate, source: "native-install", ...classifyExecutable(candidate, platform) };
    }
  }

  const onPath = findExecutable("claude", {
    platform,
    env,
    runCommandImpl: options.runCommandImpl ?? runCommand
  });
  if (onPath) {
    return { path: onPath, source: "PATH", ...classifyExecutable(onPath, platform) };
  }

  return { path: null, source: null, kind: "missing", requiresShell: false };
}

/** Quote a single argument for cmd.exe. Only used on the Windows shim path. */
export function quoteForCmd(arg) {
  const text = String(arg);
  if (text === "") {
    return '""';
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Read a JSON Schema from disk and minify it.
 *
 * `--json-schema` takes the schema document itself, not a path to one. Minifying
 * keeps the argument well clear of the Windows command-line limit.
 */
export function readSchema(schemaPath) {
  return JSON.stringify(stripSchemaDialect(JSON.parse(fs.readFileSync(schemaPath, "utf8"))));
}

/**
 * Drop the `$schema` dialect declaration.
 *
 * The file keeps it for editor tooling, but Claude Code's validator rejects a
 * schema whose dialect it cannot resolve ("no schema with key or ref
 * https://json-schema.org/draft/2020-12/schema").
 */
export function stripSchemaDialect(schema) {
  const { $schema, ...rest } = schema;
  return rest;
}

/**
 * Build the argv for a review run. The prompt is intentionally absent — it
 * goes on stdin.
 */
export function buildReviewArgs(options = {}) {
  const args = ["-p", "--output-format", "json", "--safe-mode"];

  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.schema) {
    args.push("--json-schema", options.schema);
  }

  const allowed = options.allowedTools ?? READ_ONLY_TOOLS;
  if (allowed.length > 0) {
    args.push("--allowedTools", allowed.join(","));
  }

  const denied = options.disallowedTools ?? WRITE_DENIED_TOOLS;
  if (denied.length > 0) {
    args.push("--disallowedTools", denied.join(","));
  }

  for (const dir of options.addDirs ?? []) {
    args.push("--add-dir", dir);
  }

  return args.concat(options.extraArgs ?? []);
}

/**
 * Strip credentials that would move billing off the user's subscription.
 * Keeps everything else so PATH, CODEX_HOME, and proxy settings survive.
 */
export function subscriptionEnv(env = process.env) {
  const next = { ...env };
  delete next.ANTHROPIC_API_KEY;
  delete next.ANTHROPIC_AUTH_TOKEN;
  return next;
}

/**
 * Run Claude Code and return the parsed result envelope.
 */
export function runClaude(prompt, options = {}) {
  const binary = options.binary ?? resolveClaudeBinary(options);
  if (!binary.path) {
    throw new Error(
      "Claude Code CLI not found. Install it, or point cc at it with CC_CLAUDE_BIN."
    );
  }

  const args = options.args ?? buildReviewArgs(options);
  const runner = options.runCommandImpl ?? runCommand;

  const spawnArgs = binary.requiresShell ? args.map(quoteForCmd) : args;
  const spawnTarget = binary.requiresShell ? quoteForCmd(binary.path) : binary.path;

  const result = runner(spawnTarget, spawnArgs, {
    cwd: options.cwd,
    env: subscriptionEnv(options.env ?? process.env),
    input: prompt,
    shell: binary.requiresShell,
    maxBuffer: options.maxBuffer
  });

  return parseClaudeResult(result);
}

/**
 * Pull the result message out of a `--output-format json` run.
 * The payload may be a single object or an array of stream messages.
 */
export function parseClaudeResult(result) {
  if (result.error) {
    throw result.error;
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Claude Code returned unparseable output (exit=${result.status}): ${
        (result.stderr || result.stdout || "").trim().slice(0, 400)
      }`
    );
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const resultMessage = messages.find((message) => message?.type === "result") ?? messages.at(-1);

  if (!resultMessage) {
    throw new Error("Claude Code returned no result message.");
  }

  return {
    isError: Boolean(resultMessage.is_error),
    structured: resultMessage.structured_output ?? null,
    text: resultMessage.result ?? "",
    sessionId: resultMessage.session_id ?? null,
    permissionDenials: resultMessage.permission_denials ?? [],
    costUsd: resultMessage.total_cost_usd ?? null,
    durationMs: resultMessage.duration_ms ?? null,
    numTurns: resultMessage.num_turns ?? null,
    rateLimited: messages.some((message) => message?.type === "rate_limit_event")
  };
}
