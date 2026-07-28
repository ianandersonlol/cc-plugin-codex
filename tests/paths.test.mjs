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
