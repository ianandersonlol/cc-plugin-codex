---
description: Read-only review of the current change by Claude Code
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [focus text]'
---

Run a review of the current change through the cc runtime.

Raw arguments: `$ARGUMENTS`

## Core constraint

This command is **review-only**. Do not fix issues, apply patches, or stage
anything. Run the review and return its output verbatim.

## Run it

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/cc-companion.mjs" review $ARGUMENTS
```

`CLAUDE_PLUGIN_ROOT` is the variable Codex exports for plugin roots (`PLUGIN_ROOT`
is a synonym). The name is Codex's, not this plugin's.

**If that variable is empty, stop and report that cc is not installed correctly.**
Do not search the filesystem for a replacement, and never run a script whose
filename is not exactly `cc-companion.mjs` — a similarly named
`codex-companion.mjs` from an unrelated plugin may be installed nearby, and
running it produces confidently wrong output.

Pass `$ARGUMENTS` straight through — the runtime parses it. Anything that is not
a recognised flag becomes the reviewer's focus text, so do not drop it.

## Return the result

- Return the command's stdout exactly as-is.
- Do not paraphrase, summarize, or add commentary.
- If the command fails, show the error rather than reviewing the change yourself.
