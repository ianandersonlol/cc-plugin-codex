# cc — plugin for Codex

Delegate reviews and implementation work to Claude Code from inside Codex.

This is the mirror image of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc),
which lets Claude Code call Codex. This one runs the other direction: you sit in
Codex, and `cc` gives you a second engineering voice on demand.

## Status

**Foundation laid; runtime not yet implemented.** The manifests, prompts, output
schema, and design are in place and the plugin is installable. The
`scripts/cc-companion.mjs` runtime that actually shells out to Claude Code is
the next piece of work. See [`docs/DESIGN.md`](docs/DESIGN.md) for the full
component map and the findings the design rests on.

## Planned surface

| Command | Purpose |
|---|---|
| `/cc:review` | Read-only review of the working tree or a branch |
| `/cc:adversarial-review` | Challenge review — attacks the approach, not just defects |
| `/cc:rescue` | Delegate a real task: diagnosis, a fix, an implementation pass |
| `/cc:setup` | Check the local Claude Code install, auth, and sandbox/network access |
| `/cc:status` | Progress of background runs |
| `/cc:result` | Fetch a finished run |
| `/cc:cancel` | Stop a background run |
| `/cc:transfer` | Hand the current Codex session's context to a fresh Claude Code session |

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
codex plugin add cc@cc-plugin-codex
```

For local development against a checkout:

```bash
codex plugin marketplace add ~/cc-plugin-codex
codex plugin add cc@cc
```

## Design in one paragraph

Every command resolves a review or task scope with git, renders a prompt from
`prompts/`, and runs a single `claude -p` subprocess with `--safe-mode`,
a read-only tool allowlist, and `--json-schema schemas/review-output.schema.json`.
Claude Code returns a validated object on `structured_output`, which the runtime
renders for the Codex TUI. Long runs detach and are tracked in a state file so
`/cc:status` and `/cc:result` can pick them up later.

`--safe-mode` is load-bearing: it keeps subscription auth working while
disabling `AGENTS.md`/`CLAUDE.md`, MCP servers, and user plugins in the
reviewer. That buys isolation, a 5.6x speedup, and — importantly — stops a
`CLAUDE.md` that says "delegate to Codex" from bouncing the request straight
back and looping.

## Safety posture

`/cc:review` and `/cc:adversarial-review` are read-only by construction: a tool
allowlist covering `Read`, `Grep`, `Glob`, and read-only `git` subcommands, with
`Edit`/`Write`/`NotebookEdit` explicitly denied. Any attempt to step outside it
lands in `permission_denials` on the result envelope, so the runtime can report
it rather than silently swallow it.

`/cc:rescue` is the only write-capable command, and it is opt-in per invocation.

## License

MIT
