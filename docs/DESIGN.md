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

## Cross-platform contract

Windows, macOS, and Linux are first-class targets. The forward plugin's commit
history is a useful map of where this goes wrong — `.cmd` shim ENOENT (#13),
app-server ENOENT (#55), Git Bash `SHELL` handling (#178), and most recently
`db52e28 Remove shell expansion for git commands` (#447), whose comment states
the rule directly:

> Git is directly executable on Windows. Repository-derived arguments must never
> pass through a shell.

Its CI, however, is ubuntu-only. `cc` runs a 3-OS × 2-Node matrix from the first
commit.

### Rules

**1. The prompt goes on stdin, never in argv.** *Verified* — `claude -p` reads
its prompt from stdin. This is not a stylistic choice: Windows caps a command
line near 32k characters, and a review prompt carrying a scope summary exceeds
it. stdin also removes every quoting question about the prompt body.

**2. `shell: false` by default, everywhere.** `runCommand` in `lib/platform.mjs`
defaults to no shell on all platforms — stricter than the forward plugin, which
defaults to a shell on Windows. Anything derived from the repository (branch
names, paths, focus text) must never reach a shell.

**3. Resolve the executable; don't make the shell find it.** Node refuses to
spawn `.cmd`/`.bat`/`.ps1` without a shell (EINVAL, hardened in Node 18.20.2 /
20.12.2), which is the real cause of the "add `shell: true` for .cmd shims"
class of fix. `resolveClaudeBinary` prefers a native install
(`~/.local/bin/claude`, `.exe` on Windows) over a PATH lookup, and `where`
results are sorted so a real binary wins over a shim. Only if nothing but a shim
exists does it fall back to a shell, and then every argument is quoted through
`quoteForCmd`. `CC_CLAUDE_BIN` overrides all of it.

This matters for the tool allowlist specifically: `Bash(git diff:*)` contains
parentheses, which are cmd.exe metacharacters.

**4. `node:path` for every path; `fileURLToPath` for every module-relative
path.** `new URL(...).pathname` yields `/C:/Users/...` on Windows and
percent-encodes spaces. `pluginRootFrom` uses `fileURLToPath` and is tested
against a path containing a space.

**5. Split on `/\r?\n/`.** Git on Windows emits CRLF, and a repo with
`core.autocrlf=true` emits CRLF inside diff bodies too. `splitLines` is the only
sanctioned splitter.

**6. State lives under `CODEX_HOME`, not `os.tmpdir()`.** `/cc:result` has to
survive a reboot, and Windows cleans temp aggressively. Following `CODEX_HOME`
(default `~/.codex`) gives one rule for all three platforms instead of an
XDG/AppData/Application Support split.

**7. Atomic writes retry.** `fs.rename` over an existing file is atomic on
POSIX but fails on Windows with EPERM/EBUSY when a scanner or reader briefly
holds the target. `writeFileAtomic` retries before surfacing the error.

**8. Process termination is platform-specific.** `process.kill(-pid)` kills a
process group on POSIX and does nothing useful on Windows; there it is
`taskkill /PID <pid> /T /F`. The forward plugin's `terminateProcessTree` handles
this well and ports directly — lift it when `/cc:cancel` lands.

### How this is tested

Platform behaviour is injected, not detected: `classifyExecutable`,
`findExecutable`, and `resolveClaudeBinary` all take `platform`, `env`,
`homedir`, and the command runner as options. Windows path handling is therefore
exercised on every OS in the matrix, and the matrix additionally verifies the
real filesystem and separator behaviour per platform.

Current suite: 70 tests, no network, no Claude Code install required. The git
tests build a real repository in a temp directory and skip cleanly where git is
absent.

## Open questions

1. **Which variable names the plugin root in a command body?** *Resolved —
   `CLAUDE_PLUGIN_ROOT`.* There is no `CODEX_PLUGIN_ROOT`: the binary contains
   20+ `CODEX_*` env literals (`CODEX_HOME`, `CODEX_SANDBOX`, `CODEX_THREAD_ID`,
   …) and zero occurrences of `CODEX_PLUGIN_ROOT`. What it does carry is the
   pair `PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` (and `PLUGIN_DATA` /
   `CLAUDE_PLUGIN_DATA`) — a canonical name plus a Claude-plugin compatibility
   alias, which is why plugins imported from that ecosystem work unchanged.

   This cost a real failure worth recording. The first command bodies used
   `$CODEX_PLUGIN_ROOT`, which expanded to nothing, and paired it with a
   fallback telling the model to look for the runtime under the plugin cache.
   The model found `codex-companion.mjs` — the *forward* plugin's runtime,
   installed in a sibling cache directory — decided it was close enough to
   `cc-companion.mjs`, and ran it. `/cc:setup` returned a confident, correct,
   entirely wrong report about Codex's own installation.

   Two rules came out of it: a command must never be told to search for its
   own runtime, and every command's output must carry an identity stamp so a
   substitute cannot pass for the real thing.

2. **Hooks.** *Verified* — Codex runs `Stop` hooks; a `codex exec` run emits
   `hook: Stop` / `hook: Stop Completed`. Plugin `hooks.json` uses the Claude
   Code schema. The stop-time review gate is therefore portable. Supported
   events seen in the binary: `pre_tool_use`, `permission_request`,
   `post_tool_use`, `pre_compact`, `post_compact`, `session_start`,
   `user_prompt_submit`, `subagent_start`, `subagent_stop`, plus `Stop`.

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

## Verified end to end

`adversarial-review` against a scratch repository with a deliberate bug
(`applyDiscount` reading an unknown key from a lookup table) returned a
schema-valid review in 60.9s over 7 turns: a HIGH finding for the NaN
corruption and a MEDIUM finding for non-idempotent reapplication that the
prompt never hinted at. No permission denials — the read-only policy held
without the reviewer trying to escape it.

Two defects surfaced only in that run, neither reachable by unit tests:
`--json-schema` takes the schema document inline rather than a path, and its
validator rejects a `$schema` dialect it cannot resolve, so `readSchema`
strips the declaration before the call.

## Local development loop

Codex caches installed plugins under `<codex-home>/plugins/cache/<marketplace>/<plugin>/<version>/`,
keyed by version. Reinstalling without changing the version can serve a stale copy, and
`codex plugin marketplace upgrade` only works on Git marketplaces — a local one errors with
"not configured as a Git marketplace".

Codex ships the flow for this in its own `plugin-creator` skill:

```bash
CREATOR=~/.codex/skills/.system/plugin-creator
python3 $CREATOR/scripts/update_plugin_cachebuster.py <repo>/plugins/cc   # version -> 0.1.1+codex.<ts>
python3 $CREATOR/scripts/validate_plugin.py           <repo>/plugins/cc
codex plugin add cc@cc
```

The cachebuster is a semver build-metadata suffix, so CI compares only the part before `+`.
Keep it out of commits; it exists to force a re-copy during iteration.

**Plugins are read at session start.** After reinstalling, start a new Codex session — an
already-running one keeps the previously loaded copy.

### Validate against Codex's own rules

`plugin-creator/scripts/validate_plugin.py` is the authoritative check. It caught a real defect
here: `interface.defaultPrompt` is required, and this plugin's manifest lacked it.

Also worth knowing: the official `plugin.json` spec has no `commands` key. `skills`, `hooks`, and
`mcpServers` are declared paths "supplemented on top of default component discovery", and the
scaffold offers `skills/`, `hooks/`, `scripts/`, `assets/`, `.mcp.json`, `.app.json` — but not
`commands/`. Slash commands appear to arrive through default discovery rather than a manifest
declaration, which is how Claude-format plugins like `agy` and `openai-codex` expose theirs. If
command registration proves unreliable, the fallback is to expose the runtime through `.mcp.json`
instead, which is a documented, first-class path.
