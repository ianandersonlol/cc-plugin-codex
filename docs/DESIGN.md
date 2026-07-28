# Design

`cc` is the mirror of `openai/codex-plugin-cc`. That plugin lets Claude Code
call Codex; this one lets Codex call Claude Code. The two ecosystems turn out to
be close enough that most of the work is transport, not architecture.

Everything marked **verified** below was checked against a real install
(Codex CLI 0.144.5, Claude Code 2.1.220) rather than assumed.

## Why this is tractable

**Verified — Codex has a first-class plugin system.** `codex plugin add`,
`codex plugin marketplace add <git-url>`, and `plugins` / `plugin_sharing` /
`remote_plugin` / `multi_agent` all sit at `stable` in `codex features list`.

**Verified — the plugin layout is nearly identical to Claude Code's.**

```
plugin-root/
  .codex-plugin/plugin.json    manifest ("skills": "./skills/", interface metadata)
  commands/*.md                slash commands
  skills/<name>/SKILL.md       same SKILL.md format
  agents/*.md                  subagents
  hooks.json                   same schema as Claude Code, incl. matchers
  .mcp.json                    bundled MCP servers
```

**Verified — `hooks.json` uses the Claude Code schema verbatim.** From the
shipped `figma` plugin:

```json
{"hooks":{"PostToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"./scripts/post_write_figma_parity_check.sh"}]}]}}
```

`replayio` additionally registers a `Stop` hook — which is exactly the shape the
forward plugin's stop-time review gate needs.

**Verified — `$ARGUMENTS` substitution and YAML frontmatter both work.** The
Codex-native `cloudflare` and `vercel` plugins use `$ARGUMENTS`, and their
commands carry `description` / `argument-hint` / `allowed-tools` frontmatter.
(Other bundled plugins use a bare `# /command-name` heading instead; both parse.)

## Component map

| `codex-plugin-cc` (Claude Code → Codex) | `cc` (Codex → Claude Code) |
|---|---|
| `.claude-plugin/plugin.json` + `marketplace.json` | `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` |
| `commands/*.md` → `/codex:review` | `commands/*.md` → `/cc:review` |
| `skills/*/SKILL.md` | identical format |
| `agents/codex-rescue.md` | `agents/cc-rescue.md` |
| `hooks/hooks.json` stop gate | `hooks.json`, same schema — see open questions |
| `scripts/codex-companion.mjs` | `scripts/cc-companion.mjs` |
| `lib/app-server.mjs` + broker (JSON-RPC to `codex app-server`) | `claude -p` subprocess |
| `lib/git.mjs` scope resolution | ports nearly verbatim |
| `schemas/review-output.schema.json` | **identical file** |
| `lib/state.mjs`, `tracked-jobs.mjs`, `job-control.mjs` | ports, and matters more here |
| `/codex:transfer` reads Claude session JSONL | reads `~/.codex/sessions/**/rollout-*.jsonl` |

## Transport: `claude -p` subprocess

Chosen over the Agent SDK and over an MCP wrapper for one decisive reason:
**it bills against a Claude subscription.** The runtime never sets
`ANTHROPIC_API_KEY`, so the CLI uses stored OAuth credentials.

### The invocation

```bash
claude -p "$PROMPT" \
  --safe-mode \
  --model "$MODEL" \
  --json-schema "$PLUGIN_ROOT/schemas/review-output.schema.json" \
  --output-format json \
  --allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*)" \
  --disallowedTools "Edit,Write,NotebookEdit"
```

**Verified — `--json-schema` returns a parsed object.** The result envelope
carries both a `result` string and a `structured_output` object:

```
RESULT KEYS: is_error, duration_api_ms, num_turns, stop_reason, session_id,
             total_cost_usd, usage, modelUsage, permission_denials,
             terminal_reason, ..., result, structured_output, ttft_ms, ...
structured_output: {"verdict":"needs-attention","summary":"..."}
```

So `schemas/review-output.schema.json` transfers from the forward plugin
byte-for-byte, and the runtime reads `structured_output` directly — no parsing,
no repair loop.

Two other fields are worth surfacing: `permission_denials` (proves the
read-only allowlist held) and a `rate_limit_event` message type in the stream
(subscription throttling, worth showing in `/cc:status`).

### `--safe-mode` is load-bearing

**Verified — it preserves subscription auth.** Its help text is explicit that
auth, model selection, built-in tools, and permissions work normally, while
`CLAUDE.md`, skills, plugins, hooks, MCP servers, custom commands, and agents
are all disabled.

Measured on a trivial Sonnet prompt:

| mode | duration |
|---|---|
| default | 118s (loaded every user MCP server) |
| `--safe-mode` | **21s** |

It solves three problems with one flag: config bleed, latency, and recursion —
a user `CLAUDE.md` that says "delegate to Codex" would otherwise bounce the
request straight back.

**Do not use `--bare` for this.** It looks like the right isolation flag but its
auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper`; OAuth and keychain are
never read. It would silently move billing off the subscription.

### Read-only enforcement

Prefer the `--allowedTools` allowlist over `--permission-mode plan`. In testing,
plan mode wrote a plan artifact to `~/.claude/plans/` as a side effect and ran
noticeably chattier. The allowlist has no side effects, and anything outside it
is denied and recorded in `permission_denials`.

## The one real architectural change

The forward plugin embeds the diff inline when it is small (≤2 files, ≤256KB)
and otherwise falls back to a summary plus this instruction
(`lib/git.mjs:297`):

> "The repository context below is a lightweight summary. Inspect the target
> diff yourself with read-only git commands before finalizing findings."

That fallback was a bug fix — `bc8fa66 fix: avoid embedding large adversarial
review diffs` — and it added 186 lines of size heuristics to `git.mjs`.

**In `cc`, the fallback is the only mode.** `claude -p` is an agentic loop; give
it the scope and read-only git and it will read the files and grep for call
sites itself, which is what makes a review catch breakage in files the diff
never touched. This deletes the entire inline/lightweight branch: no file-count
threshold, no byte budget, no `ENOBUFS` handling.

Tradeoff: more turns per review, so higher latency and subscription usage than
stuffing a diff into one prompt. Worth it — the resulting findings are grounded
in real call sites instead of a diff read in isolation.

## Backgrounding is the hard part

The forward plugin detaches long reviews with Claude Code's
`Bash(run_in_background: true)`, a harness feature. Codex's shell tool has no
confirmed equivalent, so `cc` needs *more* job-control machinery than the
forward direction, not less: a detached child writing to a state file, plus
`/cc:status`, `/cc:result`, and `/cc:cancel` to poll and manage it. That is
`state.mjs` + `tracked-jobs.mjs` + `job-control.mjs` ported roughly as-is.

Worth checking before building it: `~/.codex/process_manager/chat_processes.json`
exists on disk, which hints Codex may manage background processes natively.

## Open questions

1. **Do plugin-supplied hooks actually fire?** `hooks` is `stable/true` in
   `codex features list`, but `plugin_hooks` reads `removed/false`. Codex's
   vocabulary is ambiguous here — `steer` shows `removed/true`, i.e. graduated
   and on. Test empirically before designing the stop-time review gate around it.
2. **Is there a plugin-root variable for command bodies?** No Codex-native
   plugin uses one. Hooks use `./scripts/...` and `.mcp.json` uses
   `"command": "./bin/...", "cwd": "."`, both plugin-root-relative. Claude Code's
   `${CLAUDE_PLUGIN_ROOT}` appears only in plugins imported from the Claude
   ecosystem. If no equivalent exists, wiring the runtime through `.mcp.json`
   sidesteps the question entirely — and makes `cc` model-invocable rather than
   only slash-invocable.
3. **Sandbox and network.** Codex sandboxes tool calls; `claude -p` needs
   network. On a default `workspace-write` policy this fails. `/cc:setup` must
   detect it and say so plainly.
4. **Model default.** Sonnet for routine review, `--model opus` behind an
   explicit flag for adversarial passes on risky diffs — mirroring the forward
   plugin's escalation discipline. A trivial 3-turn Sonnet run reported
   `total_cost_usd: 0.209`, so an Opus pass over a real diff is not free of
   rate-limit consequences even on a subscription.

## Build order

1. `lib/git.mjs` scope resolution + `lib/render.mjs` — port, drop the inline-diff branch
2. `cc-companion.mjs review` / `adversarial-review` foreground, `/cc:setup`
3. State file + `/cc:status`, `/cc:result`, `/cc:cancel`, background detach
4. `/cc:rescue` with worktree isolation (`claude --worktree`)
5. `/cc:transfer` reading Codex rollout JSONL
6. Stop-time review gate, if and only if open question 1 resolves yes
