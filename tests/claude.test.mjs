import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  READ_ONLY_TOOLS,
  WRITE_DENIED_TOOLS,
  buildReviewArgs,
  parseClaudeResult,
  quoteForCmd,
  resolveClaudeBinary,
  runClaude,
  subscriptionEnv
} from "../plugins/cc/scripts/lib/claude.mjs";

function fakeRunner(stdout, { status = 0, error = null } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { command, args, status, signal: null, stdout, stderr: "", error };
  };
  run.calls = calls;
  return run;
}

const RESULT_ENVELOPE = JSON.stringify([
  { type: "system", subtype: "init" },
  { type: "rate_limit_event" },
  {
    type: "result",
    is_error: false,
    session_id: "abc-123",
    total_cost_usd: 0.21,
    duration_ms: 20346,
    num_turns: 3,
    permission_denials: [],
    result: '{"verdict":"approve"}',
    structured_output: { verdict: "approve", summary: "fine", findings: [], next_steps: [] }
  }
]);

test("review args never carry the prompt", () => {
  const args = buildReviewArgs({ model: "sonnet", schema: '{"type":"object"}' });
  assert.equal(args.includes("-p"), true);
  assert.equal(
    args.some((arg) => arg.length > 200),
    false,
    "no argv entry should look like a prompt body"
  );
});

test("review args never pass --bare, which would break subscription auth", () => {
  assert.equal(buildReviewArgs({}).includes("--bare"), false);
});

test("review args request safe mode and structured json", () => {
  const args = buildReviewArgs({ schema: '{"type":"object"}' });
  assert.equal(args.includes("--safe-mode"), true);
  assert.deepEqual(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2), [
    "--output-format",
    "json"
  ]);
  assert.deepEqual(args.slice(args.indexOf("--json-schema"), args.indexOf("--json-schema") + 2), [
    "--json-schema",
    '{"type":"object"}'
  ]);
});

test("review args default to a read-only tool policy", () => {
  const args = buildReviewArgs({});
  const allowed = args[args.indexOf("--allowedTools") + 1];
  const denied = args[args.indexOf("--disallowedTools") + 1];
  assert.equal(allowed, READ_ONLY_TOOLS.join(","));
  for (const tool of WRITE_DENIED_TOOLS) {
    assert.equal(denied.includes(tool), true, `${tool} must be denied`);
  }
  assert.equal(allowed.includes("Edit"), false);
  assert.equal(allowed.includes("Write"), false);
});

test("subscriptionEnv strips api credentials but keeps the rest", () => {
  const env = subscriptionEnv({
    PATH: "/usr/bin",
    CODEX_HOME: "/home/ian/.codex",
    ANTHROPIC_API_KEY: "sk-should-not-survive",
    ANTHROPIC_AUTH_TOKEN: "also-not"
  });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.CODEX_HOME, "/home/ian/.codex");
});

test("CC_CLAUDE_BIN overrides discovery", () => {
  const binary = resolveClaudeBinary({
    env: { CC_CLAUDE_BIN: "/opt/claude/claude" },
    platform: "linux",
    existsImpl: () => false
  });
  assert.equal(binary.path, "/opt/claude/claude");
  assert.equal(binary.source, "CC_CLAUDE_BIN");
  assert.equal(binary.requiresShell, false);
});

test("the native install is preferred over PATH", () => {
  const homedir = path.join(path.sep, "home", "ian");
  const native = path.join(homedir, ".local", "bin", "claude");
  const runner = fakeRunner("/usr/bin/claude\n");
  const binary = resolveClaudeBinary({
    env: {},
    platform: "linux",
    homedir,
    existsImpl: (candidate) => candidate === native,
    runCommandImpl: runner
  });
  assert.equal(binary.path, native);
  assert.equal(binary.source, "native-install");
  assert.equal(runner.calls.length, 0, "PATH lookup should be skipped");
});

test("a windows shim is usable but flagged for shell quoting", () => {
  const binary = resolveClaudeBinary({
    env: {},
    platform: "win32",
    homedir: "C:\\Users\\Ian",
    existsImpl: () => false,
    runCommandImpl: fakeRunner("C:\\npm\\claude.cmd\r\n")
  });
  assert.equal(binary.path, "C:\\npm\\claude.cmd");
  assert.equal(binary.kind, "shim");
  assert.equal(binary.requiresShell, true);
});

test("a missing cli reports missing rather than throwing", () => {
  const binary = resolveClaudeBinary({
    env: {},
    platform: "linux",
    existsImpl: () => false,
    runCommandImpl: fakeRunner("", { status: 1 })
  });
  assert.equal(binary.path, null);
  assert.equal(binary.kind, "missing");
});

test("quoteForCmd wraps arguments containing cmd.exe metacharacters", () => {
  assert.equal(quoteForCmd("Bash(git diff:*)"), '"Bash(git diff:*)"');
  assert.equal(quoteForCmd("C:\\My Plugins\\schema.json"), '"C:\\My Plugins\\schema.json"');
  assert.equal(quoteForCmd(""), '""');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
});

test("runClaude sends the prompt on stdin and shells out only for shims", () => {
  const runner = fakeRunner(RESULT_ENVELOPE);
  runClaude("REVIEW THIS", {
    binary: { path: "/home/ian/.local/bin/claude", kind: "direct", requiresShell: false },
    runCommandImpl: runner,
    env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-nope" },
    schema: '{"type":"object"}'
  });

  const [call] = runner.calls;
  assert.equal(call.options.input, "REVIEW THIS");
  assert.equal(call.options.shell, false);
  assert.equal(call.args.includes("REVIEW THIS"), false, "prompt must not be an argv entry");
  assert.equal(call.options.env.ANTHROPIC_API_KEY, undefined);
});

test("runClaude quotes every argument when forced through a shim", () => {
  const runner = fakeRunner(RESULT_ENVELOPE);
  runClaude("REVIEW THIS", {
    binary: { path: "C:\\npm\\claude.cmd", kind: "shim", requiresShell: true },
    runCommandImpl: runner,
    env: {},
    schema: '{"type":"object"}'
  });

  const [call] = runner.calls;
  assert.equal(call.options.shell, true);
  assert.equal(call.command, '"C:\\npm\\claude.cmd"');
  for (const arg of call.args) {
    assert.equal(arg.startsWith('"') && arg.endsWith('"'), true, `${arg} should be quoted`);
  }
  assert.equal(call.options.input, "REVIEW THIS");
});

test("runClaude throws a clear error when the cli is missing", () => {
  assert.throws(
    () =>
      runClaude("x", {
        binary: { path: null, kind: "missing", requiresShell: false },
        runCommandImpl: fakeRunner("")
      }),
    /CC_CLAUDE_BIN/
  );
});

test("parseClaudeResult pulls structured output from a stream array", () => {
  const parsed = parseClaudeResult({ stdout: RESULT_ENVELOPE, stderr: "", status: 0, error: null });
  assert.equal(parsed.structured.verdict, "approve");
  assert.equal(parsed.sessionId, "abc-123");
  assert.equal(parsed.costUsd, 0.21);
  assert.equal(parsed.numTurns, 3);
  assert.equal(parsed.rateLimited, true);
  assert.deepEqual(parsed.permissionDenials, []);
});

test("parseClaudeResult accepts a bare result object", () => {
  const single = JSON.stringify({ type: "result", structured_output: { verdict: "needs-attention" } });
  const parsed = parseClaudeResult({ stdout: single, stderr: "", status: 0, error: null });
  assert.equal(parsed.structured.verdict, "needs-attention");
});

test("parseClaudeResult surfaces unparseable output with context", () => {
  assert.throws(
    () =>
      parseClaudeResult({
        stdout: "not json",
        stderr: "auth required",
        status: 1,
        error: null
      }),
    /auth required/
  );
});
