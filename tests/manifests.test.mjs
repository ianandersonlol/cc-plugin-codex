import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(ROOT, "plugins", "cc");
const SKILLS = ["setup", "review", "adversarial-review"];

const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(...segments), "utf8"));

/** Semver build metadata is a local-dev cachebuster; compare the release part. */
const release = (version) => String(version).split("+")[0];

test("the plugin ships a root plugin.json for Antigravity", () => {
  // Verified against `agy plugin validate`: it stats <root>/plugin.json and
  // accepts nothing else. Both .codex-plugin/plugin.json and
  // .claude-plugin/plugin.json are rejected outright.
  const manifest = readJson(PLUGIN, "plugin.json");
  assert.equal(manifest.name, "cc");
});

test("the plugin ships a .codex-plugin manifest for Codex", () => {
  const manifest = readJson(PLUGIN, ".codex-plugin", "plugin.json");
  assert.equal(manifest.name, "cc");
  // Codex's own validate_plugin.py treats this as required.
  assert.ok(Array.isArray(manifest.interface?.defaultPrompt));
});

test("both manifests agree with package.json on the version", () => {
  const pkg = readJson(ROOT, "package.json").version;
  assert.equal(release(readJson(PLUGIN, "plugin.json").version), pkg);
  assert.equal(release(readJson(PLUGIN, ".codex-plugin", "plugin.json").version), pkg);
});

test("both manifests agree with each other on the name", () => {
  assert.equal(
    readJson(PLUGIN, "plugin.json").name,
    readJson(PLUGIN, ".codex-plugin", "plugin.json").name
  );
});

test("every skill sits where both hosts discover it", () => {
  // skills/<name>/SKILL.md is the entry point on both, and the companion is
  // resolved from it as ../.. — so the runtime has to live beside the skills.
  for (const name of SKILLS) {
    assert.ok(fs.existsSync(path.join(PLUGIN, "skills", name, "SKILL.md")), name);
  }
  assert.ok(fs.existsSync(path.join(PLUGIN, "scripts", "cc-companion.mjs")));
  assert.ok(fs.existsSync(path.join(PLUGIN, "schemas", "review-output.schema.json")));
});

test("the Codex marketplace points at the plugin directory", () => {
  const marketplace = readJson(ROOT, ".agents", "plugins", "marketplace.json");
  const entry = marketplace.plugins.find((plugin) => plugin.name === "cc");
  assert.ok(entry, "no cc entry in the marketplace");
  assert.equal(path.resolve(ROOT, entry.source.path), PLUGIN);
});
