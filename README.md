# cc — plugin for Codex

Delegate reviews and implementation work to Claude Code from inside Codex.

This is the mirror image of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc),
which lets Claude Code call Codex. This one runs the other direction: you sit in
Codex, and `cc` gives you a second engineering voice on demand.

## Status

The review runtime and its first three Codex-native skills are wired and tested:
`$cc:setup`, `$cc:review`, and `$cc:adversarial-review`. The remaining planned
skills are not implemented yet. See [`docs/DESIGN.md`](docs/DESIGN.md) for the
component map and the findings the design rests on.

## Platform support

Windows, macOS, and Linux are first-class, verified by a 3-OS × 2-Node CI matrix
from the first commit. Platform behaviour is injected rather than detected, so
Windows path and shim handling is exercised on every runner, not only on
Windows. See the cross-platform contract in [`docs/DESIGN.md`](docs/DESIGN.md)
for the rules — prompt on stdin, `shell: false` by default, resolve the
executable rather than letting a shell find it, `CODEX_HOME` for state.

```bash
npm test    # no network or Claude Code install required
```

## Surface

| Skill | Status | Purpose |
|---|---|---|
| `$cc:review` | Available | Read-only review of the working tree or a branch |
| `$cc:adversarial-review` | Available | Challenge review — attacks the approach, not just defects |
| `$cc:setup` | Available | Check the local Claude Code install and repository state |
| `$cc:rescue` | Planned | Delegate a real task: diagnosis, a fix, an implementation pass |
| `$cc:status` | Planned | Progress of background runs |
| `$cc:result` | Planned | Fetch a finished run |
| `$cc:cancel` | Planned | Stop a background run |
| `$cc:transfer` | Planned | Hand the current Codex session's context to a fresh Claude Code session |

## Models, effort, and finding priority

Reviews use **Opus by default**. Fable is supported with `--model fable` (or
`--model claude-fable-5`), and any model name accepted by the installed Claude
Code CLI can be passed through.

| Model family | Default effort |
|---|---|
| Fable | `max` |
| Opus | `xhigh` |
| Sonnet | `high` |
| Haiku or an unknown model | Claude Code's default |

Pass `--effort low|medium|high|xhigh|max` to override that selection. For
example: `$cc:adversarial-review --model fable --effort high`.

Effort controls how hard the reviewer reasons. Separately, every finding is
assigned a **priority** (`critical`, `high`, `medium`, or `low`) and rendered in
priority order, then by confidence within the same priority.

## Requirements

- **Claude Code CLI** (`claude`) installed and logged in. A Claude subscription
  covers usage — the runtime shells out to `claude -p` and never touches
  `ANTHROPIC_API_KEY`, so runs bill against your existing plan.
- **Node.js 18.18+**
- Codex with `plugins` enabled (stable since 0.144.x).

## Install

Once published:

```bash
codex plugin marketplace add ianandersonlol/cc-plugin-codex
codex plugin add cc@cc
```

For local development against a checkout:

```bash
codex plugin marketplace add ~/cc-plugin-codex
codex plugin add cc@cc
```

## Design in one paragraph

Every review skill resolves a review scope with git, renders a prompt from
`prompts/`, and runs a single `claude -p` subprocess with `--safe-mode`,
a read-only tool allowlist, and `--json-schema schemas/review-output.schema.json`.
Claude Code returns a validated object on `structured_output`, which the runtime
renders for Codex.

`--safe-mode` is load-bearing: it keeps subscription auth working while
disabling `AGENTS.md`/`CLAUDE.md`, MCP servers, and user plugins in the
reviewer. That buys isolation, a 5.6x speedup, and — importantly — stops a
`CLAUDE.md` that says "delegate to Codex" from bouncing the request straight
back and looping.

## Safety posture

`$cc:review` and `$cc:adversarial-review` are read-only by construction: a tool
allowlist covering `Read`, `Grep`, `Glob`, and read-only `git` subcommands, with
`Edit`/`Write`/`NotebookEdit` explicitly denied. Any attempt to step outside it
lands in `permission_denials` on the result envelope, so the runtime can report
it rather than silently swallow it.

The planned `$cc:rescue` skill will be the only write-capable entry point.

## License

MIT
