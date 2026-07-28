import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, tokenize } from "../plugins/cc/scripts/lib/args.mjs";

const SPEC = {
  valueOptions: ["cwd", "base", "scope", "model", "effort"],
  booleanOptions: ["json"]
};

test("tokenize keeps quoted phrases together", () => {
  assert.deepEqual(tokenize('--focus "auth and data loss" --json'), [
    "--focus",
    "auth and data loss",
    "--json"
  ]);
  assert.deepEqual(tokenize("--base 'origin/main'"), ["--base", "origin/main"]);
});

test("tokenize collapses arbitrary whitespace", () => {
  assert.deepEqual(tokenize("  a\t\tb \n c "), ["a", "b", "c"]);
  assert.deepEqual(tokenize(""), []);
});

test("tokenize preserves an intentionally empty quoted argument", () => {
  assert.deepEqual(tokenize('--model "" rest'), ["--model", "", "rest"]);
});

test("value options accept both spaced and inline forms", () => {
  assert.equal(parseArgs("--base origin/main", SPEC).options.base, "origin/main");
  assert.equal(parseArgs("--base=origin/main", SPEC).options.base, "origin/main");
  assert.equal(parseArgs("--effort=medium", SPEC).options.effort, "medium");
});

test("boolean options do not consume the next token", () => {
  const parsed = parseArgs("--json check the auth path", SPEC);
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.focusText, "check the auth path");
});

test("free text becomes focus text and is never dropped", () => {
  const parsed = parseArgs('--base main focus on migrations and "tenant isolation"', SPEC);
  assert.equal(parsed.options.base, "main");
  assert.equal(parsed.focusText, "focus on migrations and tenant isolation");
});

test("focus text is empty when only flags are supplied", () => {
  assert.equal(parseArgs("--json --scope branch", SPEC).focusText, "");
});

test("an argv array is accepted directly", () => {
  const parsed = parseArgs(["--scope", "working-tree", "race", "conditions"], SPEC);
  assert.equal(parsed.options.scope, "working-tree");
  assert.equal(parsed.focusText, "race conditions");
});

test("a missing value is an explicit error", () => {
  assert.throws(() => parseArgs("--base", SPEC), /Missing value for --base/);
  assert.throws(() => parseArgs("--base --json", SPEC), /Missing value for --base/);
});

test("unknown options fail loudly rather than becoming focus text", () => {
  assert.throws(() => parseArgs("--wat", SPEC), /Unknown option: --wat/);
});
