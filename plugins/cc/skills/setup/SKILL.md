---
name: setup
description: 'Check whether the cc plugin can use Node.js, Claude Code, and the current repository. Args: --cwd PATH, --json. Use for installation, authentication, or runtime-readiness checks.'
---

# CC Setup

Resolve `<plugin-root>` as `../..` from the directory containing this `SKILL.md`. Always run the companion from that active installed plugin root; do not rely on plugin-root environment variables and do not search for a similarly named runtime.

Resolve `<node>` to `node` when it is on `PATH`. If it is absent and the host exposes its bundled workspace dependencies, load them and use the returned Node.js executable. Otherwise report that Node.js 18.18+ is required.

Resolve `<repo-root>` to the absolute path of the repository the user is working in, and pass it. Antigravity runs shell commands from its own home directory rather than the workspace, so without it the companion reports that it is not inside a git repository. A `--cwd` the user typed lands later on the command line and overrides this one. If you cannot determine the repository path, drop `--cwd` and its value from the command entirely rather than passing an unresolved placeholder.

Resolve `<arguments>` from the raw argument line below. Codex replaces that line with everything the user typed after the command name; Antigravity leaves the token unsubstituted. So if the line still reads literally `$ARGUMENTS`, ignore it and use the text the user typed after the skill invocation instead. When the user passed nothing, `<arguments>` is empty and nothing is appended. Pass flags exactly as the user typed them, and quote any freeform focus text as one shell argument — it routinely contains parentheses, `&&`, `;`, or `$`, and has to reach the companion literally rather than being expanded by the shell.

Raw arguments:
`$ARGUMENTS`

Run:

```bash
"<node>" "<plugin-root>/scripts/cc-companion.mjs" setup --cwd "<repo-root>" <arguments>
```

Return the command output faithfully. If Claude Code is missing or not authenticated, report the companion's guidance and let the user decide whether to install or log in. Do not install software without permission.
