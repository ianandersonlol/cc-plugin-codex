import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  codexHome,
  ensureDir,
  pluginRootFrom,
  splitLines,
  stateDir,
  writeFileAtomic
} from "../plugins/cc/scripts/lib/paths.mjs";

test("pluginRootFrom resolves the plugin root from a lib module", () => {
  // path.resolve, not path.join: a rooted-but-driveless path like \repo\x is
  // relative to the current drive on Windows, and pathToFileURL resolves it.
  const root = path.resolve(path.join(path.sep, "repo", "plugins", "cc"));
  const libModule = pathToFileURL(path.join(root, "scripts", "lib", "paths.mjs")).href;
  assert.equal(pluginRootFrom(libModule), root);
});

test("pluginRootFrom survives spaces in the path", () => {
  // new URL(...).pathname would percent-encode this; fileURLToPath must not.
  const libModule = pathToFileURL(
    path.join(os.homedir(), "My Plugins", "cc", "scripts", "lib", "paths.mjs")
  ).href;
  const root = pluginRootFrom(libModule);
  assert.equal(root, path.join(os.homedir(), "My Plugins", "cc"));
  assert.equal(root.includes("%20"), false);
});

test("codexHome honours CODEX_HOME", () => {
  const home = codexHome({ CODEX_HOME: path.join(path.sep, "custom", "codex") }, path.sep);
  assert.equal(home, path.resolve(path.join(path.sep, "custom", "codex")));
});

test("codexHome falls back to ~/.codex", () => {
  const fakeHome = path.join(path.sep, "home", "ian");
  assert.equal(codexHome({}, fakeHome), path.join(fakeHome, ".codex"));
  assert.equal(codexHome({ CODEX_HOME: "   " }, fakeHome), path.join(fakeHome, ".codex"));
});

test("stateDir lives under the codex home, not the temp directory", () => {
  const fakeHome = path.join(path.sep, "home", "ian");
  const dir = stateDir({}, fakeHome);
  assert.equal(dir, path.join(fakeHome, ".codex", "cc", "jobs"));
  assert.equal(dir.startsWith(os.tmpdir()), false);
});

test("CC_STATE_DIR overrides the host home", () => {
  // The escape hatch for a host that is not Codex. Antigravity does not expose
  // its per-install home to plugin subprocesses, so the location is explicit
  // rather than guessed.
  const fakeHome = path.join(path.sep, "home", "ian");
  const override = path.join(path.sep, "var", "cc-state");
  assert.equal(stateDir({ CC_STATE_DIR: override }, fakeHome), path.normalize(override));
  assert.equal(stateDir({ CC_STATE_DIR: "   " }, fakeHome), path.join(fakeHome, ".codex", "cc", "jobs"));
});

test("CC_STATE_DIR wins over CODEX_HOME", () => {
  const override = path.join(path.sep, "var", "cc-state");
  const env = { CC_STATE_DIR: override, CODEX_HOME: path.join(path.sep, "custom", "codex") };
  assert.equal(stateDir(env, path.sep), path.normalize(override));
});

test("a relative CC_STATE_DIR is rejected rather than resolved", () => {
  // path.resolve() would anchor it to process.cwd(), which on Antigravity is
  // ~/.gemini/antigravity-cli — a silently wrong home for state meant to
  // outlive the session.
  const fakeHome = path.join(path.sep, "home", "ian");
  assert.throws(
    () => stateDir({ CC_STATE_DIR: path.join(".cc-state") }, fakeHome),
    /must be an absolute path/
  );
});

test("splitLines handles LF, CRLF, and mixed output", () => {
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines("a\r\nb"), ["a", "b"]);
  assert.deepEqual(splitLines("a\r\nb\nc"), ["a", "b", "c"]);
});

test("writeFileAtomic writes, overwrites, and leaves no temp files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-paths-"));
  try {
    const target = path.join(dir, "job.json");

    writeFileAtomic(target, JSON.stringify({ status: "running" }));
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).status, "running");

    writeFileAtomic(target, JSON.stringify({ status: "done" }));
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).status, "done");

    const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic creates missing directories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-paths-"));
  try {
    const target = path.join(dir, "nested", "deeper", "job.json");
    writeFileAtomic(target, "{}");
    assert.equal(fs.existsSync(target), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureDir is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-paths-"));
  try {
    const nested = path.join(dir, "a", "b");
    assert.equal(ensureDir(nested), nested);
    assert.equal(ensureDir(nested), nested);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
