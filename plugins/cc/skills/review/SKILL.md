---
name: review
description: 'Run a read-only Claude Code review of local git changes. Args: --cwd PATH, --base REF, --scope auto|working-tree|branch, --model NAME, --json, [focus text]. Use for ordinary code-review requests or an independent second opinion.'
---

# CC Review

Resolve `<plugin-root>` as `../..` from the directory containing this `SKILL.md`. Always run the companion from that active installed plugin root; do not rely on plugin-root environment variables and do not search for a similarly named runtime.

Resolve `<node>` to `node` when it is on `PATH`. If it is absent and Codex exposes its bundled workspace dependencies, load them and use the returned Node.js executable. Otherwise report that Node.js 18.18+ is required.

Raw arguments:
`$ARGUMENTS`

Run:

```bash
"<node>" "<plugin-root>/scripts/cc-companion.mjs" review $ARGUMENTS
```

Rules:

- Treat this skill as review-only. Do not fix issues, apply patches, or stage changes.
- Preserve the user's flags and focus text exactly.
- Run the companion in the foreground and wait for completion; larger reviews can take several minutes.
- Return stdout faithfully. If the command fails, surface the error instead of reviewing the change yourself.
