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

If `$CODEX_PLUGIN_ROOT` is empty, try `$CLAUDE_PLUGIN_ROOT`. If both are empty,
the runtime is at `<codex-home>/plugins/cache/cc/cc/<version>/scripts/cc-companion.mjs`
(`~/.codex` unless `CODEX_HOME` is set).

## Return the result

Return the output verbatim, then help with any listed next step if the user asks.

Do not install anything without being asked. If the Claude Code CLI is missing,
report that and let the user decide how to install it.
