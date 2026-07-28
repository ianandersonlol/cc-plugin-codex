import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = ["setup", "review", "adversarial-review"];

for (const name of SKILLS) {
  test(`${name} is packaged as a Codex-native skill`, () => {
    const skillPath = path.join(ROOT, "plugins", "cc", "skills", name, "SKILL.md");
    const source = fs.readFileSync(skillPath, "utf8");

    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.match(source, /description: ['"].+['"]/);
    assert.match(source, /\.\.\/\.\./);
    assert.match(source, /scripts\/cc-companion\.mjs/);
    assert.doesNotMatch(source, /CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/);
    assert.doesNotMatch(source, /\[TODO:/);
  });
}
