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
node "$CODEX_PLUGIN_ROOT/scripts/cc-companion.mjs" adversarial-review $ARGUMENTS
```

Pass `$ARGUMENTS` straight through — the runtime parses it. Do not strip flags,
reword the user's focus text, or soften the adversarial framing.

## Return the result

- Return the command's stdout exactly as-is.
- Do not paraphrase, summarize, re-rank, or add commentary before or after it.
- If the command fails, show the error rather than reviewing the change yourself.

Reviews take a few minutes on a large change. That is expected; wait for it.
