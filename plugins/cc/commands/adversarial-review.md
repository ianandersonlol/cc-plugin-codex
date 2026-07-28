---
description: Adversarial review of the current change by Claude Code — challenges the approach, not just the defects
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [focus text]'
---

Run an adversarial review of the current change through the cc runtime.

Raw arguments: `$ARGUMENTS`

## Core constraint

This command is **review-only**.

- Do not fix issues, apply patches, or stage anything.
- Do not announce that you are about to make changes.
- Your job is to run the review and return its output verbatim.

The reviewer runs read-only by construction: it gets `Read`, `Grep`, `Glob`, and
read-only `git` subcommands, with `Edit`, `Write`, and `NotebookEdit` denied.
A reviewer proposing a fix is evidence, not authorization.

## Run it

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/cc-companion.mjs" adversarial-review $ARGUMENTS
```

`CLAUDE_PLUGIN_ROOT` is the variable Codex exports for plugin roots (`PLUGIN_ROOT`
is a synonym). The name is Codex's, not this plugin's.

**If that variable is empty, stop and report that cc is not installed correctly.**
Do not search the filesystem for a replacement, and never run a script whose
filename is not exactly `cc-companion.mjs` — a similarly named
`codex-companion.mjs` from an unrelated plugin may be installed nearby, and
running it produces confidently wrong output.

Pass `$ARGUMENTS` straight through — the runtime parses it. Do not strip flags,
reword the user's focus text, or soften the adversarial framing.

## Return the result

- Return the command's stdout exactly as-is.
- Do not paraphrase, summarize, re-rank, or add commentary before or after it.
- If the command fails, show the error rather than reviewing the change yourself.

Reviews take a few minutes on a large change. That is expected; wait for it.
