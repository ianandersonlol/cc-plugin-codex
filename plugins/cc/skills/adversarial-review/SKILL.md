---
name: adversarial-review
description: 'Run a read-only, design-challenging Claude Code review of local git changes. Args: --cwd PATH, --base REF, --scope auto|working-tree|branch, --model NAME, --effort low|medium|high|xhigh|max, --json, [focus text]. Defaults to Opus with xhigh effort. Use when the user explicitly wants stronger scrutiny, tradeoff challenges, or risk-focused review.'
---

# CC Adversarial Review

Resolve `<plugin-root>` as `../..` from the directory containing this `SKILL.md`. Always run the companion from that active installed plugin root; do not rely on plugin-root environment variables and do not search for a similarly named runtime.

Resolve `<node>` to `node` when it is on `PATH`. If it is absent and Codex exposes its bundled workspace dependencies, load them and use the returned Node.js executable. Otherwise report that Node.js 18.18+ is required.

Raw arguments:
`$ARGUMENTS`

The default model is Opus. Fable is supported with `--model fable` (or its full
model identifier). Model-family effort defaults are Fable `max`, Opus `xhigh`,
Sonnet `high`, and Haiku's CLI default; an explicit `--effort` overrides them.
Findings are returned in priority order with critical/high/medium/low labels.

Run:

```bash
"<node>" "<plugin-root>/scripts/cc-companion.mjs" adversarial-review $ARGUMENTS
```

Rules:

- Treat this skill as review-only. Do not fix issues, apply patches, or stage changes.
- Preserve the user's flags and focus text exactly; do not soften the adversarial framing.
- Run the companion in the foreground and wait for completion; larger reviews can take several minutes.
- Return stdout faithfully without paraphrasing or re-ranking findings. If the command fails, surface the error instead of reviewing the change yourself.
