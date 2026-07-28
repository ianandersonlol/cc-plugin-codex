/**
 * Review scope resolution.
 *
 * This module answers one question: what is being reviewed? It deliberately
 * does not assemble a diff. The reviewer is an agent with read-only repository
 * access; handing it a file list and letting it read the code produces findings
 * grounded in real call sites, and sidesteps every diff-size heuristic.
 */
import { runCommand } from "./platform.mjs";
import { splitLines } from "./paths.mjs";

/**
 * Repository-derived arguments must never pass through a shell. Git is
 * directly executable on every supported platform, so there is no reason to
 * involve one.
 */
function git(cwd, args, options = {}) {
  return runCommand("git", args, { ...options, cwd, shell: false });
}

function gitText(cwd, args, options = {}) {
  const result = git(cwd, args, options);
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

/** Split NUL-delimited git output. Avoids core.quotepath escaping entirely. */
function splitNul(text) {
  return String(text ?? "")
    .split("\0")
    .filter((entry) => entry.length > 0);
}

export function isGitRepository(cwd) {
  return gitText(cwd, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
}

export function repositoryRoot(cwd) {
  return gitText(cwd, ["rev-parse", "--show-toplevel"])?.trim() ?? null;
}

export function currentBranch(cwd) {
  const name = gitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  return name && name !== "HEAD" ? name : null;
}

export function refExists(cwd, ref) {
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return !result.error && result.status === 0;
}

/**
 * Best-effort default base branch: the remote's HEAD if configured, then the
 * conventional names. Returns null when none resolve, which callers surface as
 * "pass --base explicitly" rather than guessing wrong.
 */
export function detectDefaultBase(cwd) {
  const symbolic = gitText(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])?.trim();
  if (symbolic) {
    const shortened = symbolic.replace(/^refs\/remotes\//, "");
    if (refExists(cwd, shortened)) {
      return shortened;
    }
  }

  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (refExists(cwd, candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Parse `git status --porcelain=v1 -z --untracked-files=all`. */
export function parsePorcelainStatus(raw) {
  const entries = splitNul(raw);
  const changed = [];
  const untracked = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);

    if (code === "??") {
      untracked.push(filePath);
      continue;
    }

    // Renames and copies emit the source path as the following NUL-separated
    // entry; consume it so it is not mistaken for another change.
    if (code[0] === "R" || code[0] === "C") {
      const from = entries[index + 1];
      index += 1;
      changed.push({ status: code.trim(), path: filePath, from });
      continue;
    }

    changed.push({ status: code.trim(), path: filePath });
  }

  return { changed, untracked };
}

/** Parse `git diff --name-status -z`. */
export function parseNameStatus(raw) {
  const entries = splitNul(raw);
  const changed = [];

  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index];
    if (status.startsWith("R") || status.startsWith("C")) {
      changed.push({ status, from: entries[index + 1], path: entries[index + 2] });
      index += 2;
      continue;
    }
    changed.push({ status, path: entries[index + 1] });
    index += 1;
  }

  return changed;
}

/**
 * Decide what to review.
 *
 * `auto` prefers the working tree when it has content, because that is what the
 * user is looking at; otherwise it falls back to comparing the branch against
 * its base.
 */
export function resolveTarget(cwd, options = {}) {
  const requested = options.scope ?? "auto";
  const baseRef = options.baseRef ?? null;

  if (baseRef && !refExists(cwd, baseRef)) {
    throw new Error(`Base ref not found: ${baseRef}`);
  }

  if (requested === "working-tree") {
    return { mode: "working-tree", baseRef: null, label: "uncommitted changes in the working tree" };
  }

  if (requested === "branch" || baseRef) {
    const base = baseRef ?? detectDefaultBase(cwd);
    if (!base) {
      throw new Error(
        "Could not determine a base branch. Pass --base <ref> explicitly."
      );
    }
    const branch = currentBranch(cwd) ?? "HEAD";
    return { mode: "branch", baseRef: base, label: `${branch} compared with ${base}` };
  }

  if (requested !== "auto") {
    throw new Error(`Unknown scope: ${requested}. Use auto, working-tree, or branch.`);
  }

  const status = parsePorcelainStatus(
    gitText(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) ?? ""
  );
  if (status.changed.length > 0 || status.untracked.length > 0) {
    return { mode: "working-tree", baseRef: null, label: "uncommitted changes in the working tree" };
  }

  const base = detectDefaultBase(cwd);
  if (!base) {
    throw new Error(
      "The working tree is clean and no base branch could be determined. Pass --base <ref>."
    );
  }
  const branch = currentBranch(cwd) ?? "HEAD";
  return { mode: "branch", baseRef: base, label: `${branch} compared with ${base}` };
}

/**
 * Gather the scope summary handed to the reviewer: which files changed, how
 * much, and how to inspect the change. Not the diff itself.
 */
export function collectScope(cwd, target) {
  if (target.mode === "working-tree") {
    const status = parsePorcelainStatus(
      gitText(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) ?? ""
    );
    const staged = (gitText(cwd, ["diff", "--shortstat", "--cached"]) ?? "").trim();
    const unstaged = (gitText(cwd, ["diff", "--shortstat"]) ?? "").trim();

    const files = status.changed.map((entry) => `${entry.status}\t${entry.path}`);
    const untracked = status.untracked.map((entry) => `??\t${entry}`);

    return {
      mode: target.mode,
      label: target.label,
      baseRef: null,
      files: [...files, ...untracked],
      fileCount: status.changed.length + status.untracked.length,
      stats: [staged && `staged: ${staged}`, unstaged && `unstaged: ${unstaged}`].filter(Boolean),
      inspectHint:
        "Inspect with `git diff`, `git diff --cached`, and by reading untracked files directly.",
      isEmpty: status.changed.length === 0 && status.untracked.length === 0
    };
  }

  const range = `${target.baseRef}...HEAD`;
  const changed = parseNameStatus(gitText(cwd, ["diff", "--name-status", "-z", range]) ?? "");
  const stat = (gitText(cwd, ["diff", "--shortstat", range]) ?? "").trim();

  return {
    mode: target.mode,
    label: target.label,
    baseRef: target.baseRef,
    files: changed.map((entry) =>
      entry.from ? `${entry.status}\t${entry.from} -> ${entry.path}` : `${entry.status}\t${entry.path}`
    ),
    fileCount: changed.length,
    stats: stat ? [stat] : [],
    inspectHint: `Inspect with \`git diff ${range}\` and by reading the changed files.`,
    isEmpty: changed.length === 0
  };
}

/** Render the scope summary that gets interpolated into the prompt. */
export function renderScopeSummary(scope) {
  const lines = [`Review target: ${scope.label}`];

  if (scope.baseRef) {
    lines.push(`Base ref: ${scope.baseRef}`);
  }
  lines.push(`Changed files (${scope.fileCount}):`);
  lines.push(scope.files.length > 0 ? scope.files.join("\n") : "(none)");

  if (scope.stats.length > 0) {
    lines.push("", scope.stats.join("\n"));
  }

  lines.push("", scope.inspectHint);
  return lines.join("\n");
}

/** Lines of a repository file list, tolerant of platform line endings. */
export function toLines(text) {
  return splitLines(text)
    .map((line) => line.trim())
    .filter(Boolean);
}
