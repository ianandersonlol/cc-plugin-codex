---
name: setup
description: 'Check whether the cc plugin can use Node.js, Claude Code, and the current repository. Args: --cwd PATH, --json. Use for installation, authentication, or runtime-readiness checks.'
---

# CC Setup

Resolve `<plugin-root>` as `../..` from the directory containing this `SKILL.md`. Always run the companion from that active installed plugin root; do not rely on plugin-root environment variables and do not search for a similarly named runtime.

Resolve `<node>` to `node` when it is on `PATH`. If it is absent and Codex exposes its bundled workspace dependencies, load them and use the returned Node.js executable. Otherwise report that Node.js 18.18+ is required.

Raw arguments:
`$ARGUMENTS`

Run:

```bash
"<node>" "<plugin-root>/scripts/cc-companion.mjs" setup $ARGUMENTS
```

Return the command output faithfully. If Claude Code is missing or not authenticated, report the companion's guidance and let the user decide whether to install or log in. Do not install software without permission.
