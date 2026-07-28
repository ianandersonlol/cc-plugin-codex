#!/usr/bin/env node
/**
 * cc companion runtime.
 *
 * Invoked by the /cc:* slash commands. Everything user-facing that a command
 * needs happens here, so the command bodies stay thin prompts rather than
 * orchestration logic.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import {
  READ_ONLY_TOOLS,
  WRITE_DENIED_TOOLS,
  readSchema,
  resolveClaudeBinary,
  runClaude
} from "./lib/claude.mjs";
import {
  collectScope,
  isGitRepository,
  renderScopeSummary,
  repositoryRoot,
  resolveTarget
} from "./lib/git.mjs";
import { pluginRootFrom } from "./lib/paths.mjs";
import { buildReviewPrompt } from "./lib/prompts.mjs";
import { runCommand } from "./lib/platform.mjs";
import { renderReview, renderSetupReport } from "./lib/render.mjs";

const PLUGIN_ROOT = pluginRootFrom(import.meta.url, 1);
const SCHEMA_PATH = path.join(PLUGIN_ROOT, "schemas", "review-output.schema.json");

const DEFAULT_MODEL = "sonnet";

function pluginVersion() {
  try {
    const manifest = path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

const REVIEW_SPEC = {
  valueOptions: ["cwd", "base", "scope", "model"],
  booleanOptions: ["json"]
};

function usage() {
  return [
    "Usage: cc-companion.mjs <command> [options] [focus text]",
    "",
    "Commands:",
    "  setup                Check the local Claude Code install and repository state",
    "  review               Read-only review of the current change",
    "  adversarial-review   Challenge review of the current change",
    "",
    "Options:",
    "  --cwd <path>         Repository directory (default: process cwd)",
    "  --base <ref>         Compare against this ref instead of the working tree",
    "  --scope <mode>       auto | working-tree | branch (default: auto)",
    "  --model <name>       Claude model (default: sonnet)",
    "  --json               Emit raw JSON instead of rendered text"
  ].join("\n");
}

function resolveCwd(options) {
  return options.cwd ? path.resolve(options.cwd) : process.cwd();
}

function buildSetupReport(cwd) {
  const node = runCommand(process.execPath, ["--version"]);
  const binary = resolveClaudeBinary({});
  const inRepo = isGitRepository(cwd);

  const claudeDetail = binary.path
    ? (runCommand(binary.path, ["--version"], { shell: binary.requiresShell }).stdout || "").trim()
    : "not found";

  const nextSteps = [];
  if (!binary.path) {
    nextSteps.push(
      "Install the Claude Code CLI, or set CC_CLAUDE_BIN to its path."
    );
  }
  if (binary.kind === "shim") {
    nextSteps.push(
      "A native Claude Code install avoids routing arguments through cmd.exe."
    );
  }
  if (!inRepo) {
    nextSteps.push("Run cc from inside a git repository, or pass --cwd.");
  }
  if (binary.path && !claudeDetail) {
    nextSteps.push(
      "Claude Code did not report a version. Check that it is logged in with `claude auth`."
    );
  }

  return {
    version: pluginVersion(),
    ready: Boolean(binary.path) && inRepo,
    node: { available: true, detail: (node.stdout || "").trim() },
    claude: {
      available: Boolean(binary.path),
      detail: claudeDetail,
      path: binary.path,
      source: binary.source,
      kind: binary.kind
    },
    git: { inside: inRepo, detail: inRepo ? (repositoryRoot(cwd) ?? "") : "not a git repository" },
    nextSteps
  };
}

function handleSetup(argv) {
  const { options } = parseArgs(argv, REVIEW_SPEC);
  const report = buildSetupReport(resolveCwd(options));
  process.stdout.write(
    (options.json ? JSON.stringify(report, null, 2) : renderSetupReport(report)) + "\n"
  );
  return report.ready ? 0 : 1;
}

function handleReview(argv, kind) {
  const { options, focusText } = parseArgs(argv, REVIEW_SPEC);
  const cwd = resolveCwd(options);

  if (!isGitRepository(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const target = resolveTarget(cwd, { scope: options.scope, baseRef: options.base });
  const scope = collectScope(cwd, target);

  if (scope.isEmpty) {
    process.stdout.write(`Nothing to review: no changes found for ${target.label}.\n`);
    return 0;
  }

  const promptName = kind === "adversarial" ? "adversarial-review" : "review";
  const title = kind === "adversarial" ? "Adversarial review" : "Review";
  const model = options.model ?? DEFAULT_MODEL;

  const prompt = buildReviewPrompt(PLUGIN_ROOT, promptName, {
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: renderScopeSummary(scope)
  });

  const result = runClaude(prompt, {
    cwd,
    model,
    schema: readSchema(SCHEMA_PATH),
    allowedTools: READ_ONLY_TOOLS,
    disallowedTools: WRITE_DENIED_TOOLS,
    addDirs: [cwd]
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(renderReview(result, { title, target: target.label, model }) + "\n");
  }

  return result.isError ? 1 : 0;
}

function main(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case "setup":
      return handleSetup(rest);
    case "review":
      return handleReview(rest, "review");
    case "adversarial-review":
      return handleReview(rest, "adversarial");
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(usage() + "\n");
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`cc: ${error.message}\n`);
  process.exitCode = 1;
}
