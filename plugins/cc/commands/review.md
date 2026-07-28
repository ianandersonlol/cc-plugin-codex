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
node "$CODEX_PLUGIN_ROOT/scripts/cc-companion.mjs" review $ARGUMENTS
```

If `$CODEX_PLUGIN_ROOT` is empty, try `$CLAUDE_PLUGIN_ROOT`. If both are empty,
the runtime is at `<codex-home>/plugins/cache/cc/cc/<version>/scripts/cc-companion.mjs`
(`~/.codex` unless `CODEX_HOME` is set).

Pass `$ARGUMENTS` straight through — the runtime parses it. Anything that is not
a recognised flag becomes the reviewer's focus text, so do not drop it.

## Return the result

- Return the command's stdout exactly as-is.
- Do not paraphrase, summarize, or add commentary.
- If the command fails, show the error rather than reviewing the change yourself.
