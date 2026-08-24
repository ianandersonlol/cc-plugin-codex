import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = ["setup", "review", "adversarial-review"];

function readSkill(name) {
  return fs.readFileSync(path.join(ROOT, "plugins", "cc", "skills", name, "SKILL.md"), "utf8");
}

/** Every fenced block in a skill body, fence markers stripped. */
function fencedBlocks(source) {
  return [...source.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

for (const name of SKILLS) {
  test(`${name} is packaged as a portable plugin skill`, () => {
    const source = readSkill(name);

    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.match(source, /description: ['"].+['"]/);
    assert.match(source, /\.\.\/\.\./);
    assert.match(source, /scripts\/cc-companion\.mjs/);
    assert.doesNotMatch(source, /CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/);
    assert.doesNotMatch(source, /\[TODO:/);
  });

  test(`${name} never puts $ARGUMENTS inside a command`, () => {
    // Codex substitutes $ARGUMENTS; Antigravity does not, and leaves the token
    // as written. A shell then expands it to the empty string, so every flag
    // the user typed is silently dropped. Keep the token out of the fence and
    // resolve it in prose instead.
    for (const block of fencedBlocks(readSkill(name))) {
      assert.doesNotMatch(block, /\$ARGUMENTS/);
    }
  });

  test(`${name} resolves arguments for both hosts`, () => {
    const source = readSkill(name);

    // The raw line Codex rewrites still has to be there...
    assert.match(source, /Raw arguments:\n`\$ARGUMENTS`/);
    // ...and the fallback for hosts that do not substitute it.
    assert.match(source, /if the line still reads literally `\$ARGUMENTS`/);
    // The command carries the resolved placeholder, not the raw token.
    const commands = fencedBlocks(source).filter((block) => block.includes("cc-companion.mjs"));
    assert.equal(commands.length, 1);
    assert.match(commands[0], /cc-companion\.mjs" \S+ --cwd "<repo-root>" <arguments>/);
  });

  test(`${name} pins the repository explicitly`, () => {
    // Verified: `agy -p` runs shell commands from ~/.gemini/antigravity-cli,
    // not the workspace, so an implicit process.cwd() reviews nothing. The
    // user's own --cwd lands later on the line and wins, since parseArgs takes
    // the last occurrence.
    const source = readSkill(name);
    assert.match(source, /Resolve `<repo-root>`/);
    const [command] = fencedBlocks(source).filter((block) => block.includes("cc-companion.mjs"));
    assert.ok(command.indexOf("--cwd") < command.indexOf("<arguments>"));
  });

  test(`${name} does not name one host as a hard requirement`, () => {
    // "Codex exposes its bundled workspace dependencies" read as an
    // instruction that only Codex could satisfy. Mentioning a host is fine;
    // requiring one is not. Assert the host-neutral phrasing positively — a
    // bare doesNotMatch on the old sentence passes for any rewording at all.
    assert.match(readSkill(name), /If it is absent and the host exposes/);
  });

  test(`${name} says to quote freeform focus text`, () => {
    // <arguments> is spliced into a shell command, and focus text routinely
    // carries parentheses — "focus on parseArgs() and tokenize()" is a bash
    // syntax error unquoted, and `$foo` or `&&` would be worse than that.
    assert.match(readSkill(name), /quote any freeform focus text as one shell argument/);
  });

  test(`${name} allows --cwd to be dropped when the repo is unknown`, () => {
    // Emitting a literal <repo-root> would be worse than omitting the flag:
    // the companion would look for a repository at a path that cannot exist.
    assert.match(readSkill(name), /drop `--cwd` and its value from the command entirely/);
  });
}
