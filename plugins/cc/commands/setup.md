---
description: Check whether cc is ready — Claude Code install, auth, and repository state
argument-hint: '[--cwd <path>] [--json]'
---

Check that cc can run.

Raw arguments: `$ARGUMENTS`

## Run it

```bash
node "$CODEX_PLUGIN_ROOT/scripts/cc-companion.mjs" setup $ARGUMENTS
```

## Return the result

Return the output verbatim, then help with any listed next step if the user asks.

Do not install anything without being asked. If the Claude Code CLI is missing,
report that and let the user decide how to install it.
