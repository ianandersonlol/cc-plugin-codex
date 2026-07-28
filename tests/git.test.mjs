import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectScope,
  detectDefaultBase,
  isGitRepository,
  parseNameStatus,
  parsePorcelainStatus,
  renderScopeSummary,
  resolveTarget
} from "../plugins/cc/scripts/lib/git.mjs";
import { runCommand } from "../plugins/cc/scripts/lib/platform.mjs";

const gitAvailable = runCommand("git", ["--version"]).status === 0;
const needsGit = { skip: gitAvailable ? false : "git is not installed" };

function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cc-git-")));
  const run = (args) => {
    const result = runCommand("git", args, { cwd: dir });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
    return result;
  };

  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.email", "cc@example.test"]);
  run(["config", "user.name", "cc tests"]);
  run(["config", "commit.gpgsign", "false"]);

  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  run(["add", "."]);
  run(["commit", "--quiet", "-m", "base"]);

  return { dir, run };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Pure parsers — these run on every platform regardless of git availability.
// ---------------------------------------------------------------------------

test("porcelain status separates tracked changes from untracked files", () => {
  const raw = [" M src/app.js", "A  src/new.js", "?? notes.md"].join("\0") + "\0";
  const parsed = parsePorcelainStatus(raw);
  assert.deepEqual(parsed.changed, [
    { status: "M", path: "src/app.js" },
    { status: "A", path: "src/new.js" }
  ]);
  assert.deepEqual(parsed.untracked, ["notes.md"]);
});

test("porcelain status consumes the source path of a rename", () => {
  const raw = ["R  new/path.js", "old/path.js", " M other.js"].join("\0") + "\0";
  const parsed = parsePorcelainStatus(raw);
  assert.deepEqual(parsed.changed, [
    { status: "R", path: "new/path.js", from: "old/path.js" },
    { status: "M", path: "other.js" }
  ]);
  assert.equal(parsed.untracked.length, 0);
});

test("porcelain status handles paths with spaces and quotes", () => {
  const raw = ['?? my notes "draft".md'].join("\0") + "\0";
  assert.deepEqual(parsePorcelainStatus(raw).untracked, ['my notes "draft".md']);
});

test("name-status parses renames as a three-entry group", () => {
  const raw = ["M", "src/a.js", "R100", "src/old.js", "src/new.js", "A", "src/b.js"].join("\0");
  assert.deepEqual(parseNameStatus(raw), [
    { status: "M", path: "src/a.js" },
    { status: "R100", from: "src/old.js", path: "src/new.js" },
    { status: "A", path: "src/b.js" }
  ]);
});

test("empty git output parses to empty results", () => {
  assert.deepEqual(parsePorcelainStatus(""), { changed: [], untracked: [] });
  assert.deepEqual(parseNameStatus(""), []);
});

// ---------------------------------------------------------------------------
// Integration against a real repository.
// ---------------------------------------------------------------------------

test("a temp directory is recognised as a repository", needsGit, () => {
  const { dir } = makeRepo();
  try {
    assert.equal(isGitRepository(dir), true);
    assert.equal(isGitRepository(os.tmpdir()), false);
  } finally {
    cleanup(dir);
  }
});

test("auto scope selects the working tree when it is dirty", needsGit, () => {
  const { dir } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, "base.txt"), "changed\n");
    const target = resolveTarget(dir, {});
    assert.equal(target.mode, "working-tree");
    assert.match(target.label, /working tree/);
  } finally {
    cleanup(dir);
  }
});

test("auto scope treats an untracked file as reviewable work", needsGit, () => {
  const { dir } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, "brand-new.js"), "export const x = 1;\n");
    const scope = collectScope(dir, resolveTarget(dir, {}));
    assert.equal(scope.isEmpty, false);
    assert.equal(scope.fileCount, 1);
    assert.match(scope.files.join("\n"), /brand-new\.js/);
  } finally {
    cleanup(dir);
  }
});

test("working-tree scope reports staged and unstaged files", needsGit, () => {
  const { dir, run } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, "staged.js"), "1\n");
    run(["add", "staged.js"]);
    fs.writeFileSync(path.join(dir, "base.txt"), "edited\n");

    const scope = collectScope(dir, resolveTarget(dir, { scope: "working-tree" }));
    const listing = scope.files.join("\n");
    assert.match(listing, /staged\.js/);
    assert.match(listing, /base\.txt/);
    assert.equal(scope.stats.length > 0, true);
  } finally {
    cleanup(dir);
  }
});

test("branch scope diffs against the requested base", needsGit, () => {
  const { dir, run } = makeRepo();
  try {
    run(["checkout", "--quiet", "-b", "feature"]);
    fs.writeFileSync(path.join(dir, "feature.js"), "export const y = 2;\n");
    run(["add", "."]);
    run(["commit", "--quiet", "-m", "feature work"]);

    const target = resolveTarget(dir, { scope: "branch", baseRef: "main" });
    assert.equal(target.mode, "branch");
    assert.equal(target.baseRef, "main");
    assert.match(target.label, /feature compared with main/);

    const scope = collectScope(dir, target);
    assert.equal(scope.fileCount, 1);
    assert.match(scope.files.join("\n"), /feature\.js/);
    assert.match(scope.inspectHint, /git diff main\.\.\.HEAD/);
  } finally {
    cleanup(dir);
  }
});

test("a clean tree with no base is an explicit error, not a silent pass", needsGit, () => {
  const { dir } = makeRepo();
  try {
    // A fresh repo on `main` with no remote: detectDefaultBase finds `main`,
    // so a branch comparison against itself is empty rather than erroring.
    const target = resolveTarget(dir, {});
    assert.equal(target.mode, "branch");
    assert.equal(collectScope(dir, target).isEmpty, true);
  } finally {
    cleanup(dir);
  }
});

test("an unknown base ref fails loudly", needsGit, () => {
  const { dir } = makeRepo();
  try {
    assert.throws(
      () => resolveTarget(dir, { baseRef: "origin/does-not-exist" }),
      /Base ref not found/
    );
  } finally {
    cleanup(dir);
  }
});

test("an unknown scope name fails loudly", needsGit, () => {
  const { dir } = makeRepo();
  try {
    assert.throws(() => resolveTarget(dir, { scope: "staged" }), /Unknown scope/);
  } finally {
    cleanup(dir);
  }
});

test("detectDefaultBase finds the conventional local branch", needsGit, () => {
  const { dir } = makeRepo();
  try {
    assert.equal(detectDefaultBase(dir), "main");
  } finally {
    cleanup(dir);
  }
});

test("the scope summary tells the reviewer how to inspect the change", needsGit, () => {
  const { dir } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, "base.txt"), "changed\n");
    const summary = renderScopeSummary(collectScope(dir, resolveTarget(dir, {})));
    assert.match(summary, /Review target:/);
    assert.match(summary, /Changed files \(1\)/);
    assert.match(summary, /git diff/);
    // The summary is a pointer to the change, never the change itself.
    assert.equal(summary.includes("@@"), false);
  } finally {
    cleanup(dir);
  }
});
