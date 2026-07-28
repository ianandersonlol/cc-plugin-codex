---
description: Check whether cc is ready — Claude Code install, auth, and repository state
argument-hint: '[--cwd <path>] [--json]'
---

Check that cc can run.

Raw arguments: `$ARGUMENTS`

## Run it

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/cc-companion.mjs" setup $ARGUMENTS
```

`CLAUDE_PLUGIN_ROOT` is the variable Codex exports for plugin roots (`PLUGIN_ROOT`
is a synonym). The name is Codex's, not this plugin's.

**If that variable is empty, stop and report that cc is not installed correctly.**
Do not search the filesystem for a replacement, and never run a script whose
filename is not exactly `cc-companion.mjs` — a similarly named
`codex-companion.mjs` from an unrelated plugin may be installed nearby, and
running it produces confidently wrong output.

## Return the result

Return the output verbatim, then help with any listed next step if the user asks.

Do not install anything without being asked. If the Claude Code CLI is missing,
report that and let the user decide how to install it.
