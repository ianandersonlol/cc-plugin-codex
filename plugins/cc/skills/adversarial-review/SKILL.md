---
name: adversarial-review
description: 'Run a read-only, design-challenging Claude Code review of local git changes. Args: --cwd PATH, --base REF, --scope auto|working-tree|branch, --model NAME, --effort low|medium|high|xhigh|max, --json, [focus text]. Defaults to Opus 5.5 with xhigh effort. Use when the user explicitly wants stronger scrutiny, tradeoff challenges, or risk-focused review.'
---

# CC Adversarial Review

Resolve `<plugin-root>` as `../..` from the directory containing this `SKILL.md`. Always run the companion from that active installed plugin root; do not rely on plugin-root environment variables and do not search for a similarly named runtime.

Resolve `<node>` to `node` when it is on `PATH`. If it is absent and the host exposes its bundled workspace dependencies, load them and use the returned Node.js executable. Otherwise report that Node.js 18.18+ is required.

Resolve `<repo-root>` to the absolute path of the repository the user is working in, and pass it. Antigravity runs shell commands from its own home directory rather than the workspace, so without it the companion fails with `Not a git repository`. A `--cwd` the user typed lands later on the command line and overrides this one. If you cannot determine the repository path, drop `--cwd` and its value from the command entirely rather than passing an unresolved placeholder.

Resolve `<arguments>` from the raw argument line below. Codex replaces that line with everything the user typed after the command name; Antigravity leaves the token unsubstituted. So if the line still reads literally `$ARGUMENTS`, ignore it and use the text the user typed after the skill invocation instead. When the user passed nothing, `<arguments>` is empty and nothing is appended. Pass flags exactly as the user typed them, and quote any freeform focus text as one shell argument — it routinely contains parentheses, `&&`, `;`, or `$`, and has to reach the companion literally rather than being expanded by the shell.

Raw arguments:
`$ARGUMENTS`

Use Claude Opus 5.5 (`claude-opus-5-5`) with `xhigh` effort for a normal review.
Fable 5.2 (`claude-fable-5-2`, selected with `--model fable`) may be suggested
for genuinely hard reasoning, ambiguous cross-system design, high-stakes
architectural decisions, subtle concurrency reviews, or substantive issues that
remain unresolved after an Opus review. Do not delay the normal review for a
model change: use Fable only if the user explicitly requests it or confirms
access and agrees to use it; otherwise continue with Opus. Do not infer or
probe for access. When offering Fable, tell the user that Claude Code's print
mode can incur usage-credit charges without an interactive prompt. An
adversarial review alone is not a reason to use Fable.

Preserve user-provided `--model`, `--effort`, and all other flags exactly; do
not replace or normalize them in the skill. Model-family effort defaults for
`cc` reviews are Fable `max`, Opus `xhigh`, and Sonnet `high`; Haiku and unknown
models use Claude Code's default. An explicit `--effort` overrides these.
Opus 5.5 requires Claude Code 2.1.280 or later; Fable 5.2 requires 2.1.321 or
later. If Fable access fails, surface the CLI error and offer a separate retry
with Opus 5.5; do not silently fall back or automatically rerun. If an update is
needed, tell the user to run `claude update` rather than updating it yourself.

Findings are returned in priority order with critical/high/medium/low labels.

Run:

```bash
"<node>" "<plugin-root>/scripts/cc-companion.mjs" adversarial-review --cwd "<repo-root>" <arguments>
```

Rules:

- Treat this skill as review-only. Do not fix issues, apply patches, or stage changes.
- Preserve the user's flags and focus text exactly; do not soften the adversarial framing.
- Run the companion in the foreground and wait for completion; larger reviews can take several minutes.
- Return stdout faithfully without paraphrasing or re-ranking findings. If the command fails, surface the error instead of reviewing the change yourself.
