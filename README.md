# cc — plugin for Codex and Antigravity

Delegate reviews and implementation work to Claude Code from inside Codex or
Antigravity.

This is the mirror image of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc),
which lets Claude Code call Codex. This one runs the other direction: you sit in
another agent, and `cc` gives you a second engineering voice on demand.

## Status

The review runtime and its first three skills are wired and tested on both
hosts: `setup`, `review`, and `adversarial-review`. The remaining planned skills
are not implemented yet. See [`docs/DESIGN.md`](docs/DESIGN.md) for the
component map and the findings the design rests on.

One plugin directory installs on both. `plugins/cc/` carries two manifests —
`plugin.json` at the root for Antigravity, `.codex-plugin/plugin.json` for
Codex — and each host ignores the other's. The skills themselves are the same
files.

## Platform support

Windows, macOS, and Linux are first-class, verified by a 3-OS × 2-Node CI matrix
from the first commit. Platform behaviour is injected rather than detected, so
Windows path and shim handling is exercised on every runner, not only on
Windows. See the cross-platform contract in [`docs/DESIGN.md`](docs/DESIGN.md)
for the rules — prompt on stdin, `shell: false` by default, resolve the
executable rather than letting a shell find it, `CODEX_HOME` (or `CC_STATE_DIR`)
for state.

```bash
npm test    # no network or Claude Code install required
```

## Surface

Codex invokes these as `$cc:review`; Antigravity exposes every skill as a slash
command, so the same skill is `/review` there.

| Skill | Status | Purpose |
|---|---|---|
| `review` | Available | Read-only review of the working tree or a branch |
| `adversarial-review` | Available | Challenge review — attacks the approach, not just defects |
| `setup` | Available | Check the local Claude Code install and repository state |
| `rescue` | Planned | Delegate a real task: diagnosis, a fix, an implementation pass |
| `status` | Planned | Progress of background runs |
| `result` | Planned | Fetch a finished run |
| `cancel` | Planned | Stop a background run |
| `transfer` | Planned | Hand the current host session's context to a fresh Claude Code session |

## Models, effort, and finding priority

Reviews use **Claude Opus 5.5** (`claude-opus-5-5`) by default. Fable 5.2 is
available with `--model fable`, which resolves to `claude-fable-5-2`. Other
explicit model aliases and IDs are passed through to the installed Claude Code
CLI unchanged (after trimming surrounding whitespace).

Opus 5.5 requires Claude Code 2.1.280 or later; Fable 5.2 requires 2.1.321 or
later. Update Claude Code with `claude update`. See the official [Claude Code
model configuration](https://code.claude.com/docs/en/model-config) and
[Claude models overview](https://platform.claude.com/docs/en/models/overview)
for supported IDs and current requirements.

These are `cc` review-specific effort defaults, not Claude model defaults:

| Model family | `cc` review effort |
|---|---|
| Fable 5.2 (`claude-fable-5-2`) | `max` |
| Opus 5.5 (`claude-opus-5-5`) | `xhigh` |
| Sonnet | `high` |
| Haiku or an unknown model | Claude Code's default |

Pass `--effort low|medium|high|xhigh|max` to override that selection. For
example: `$cc:adversarial-review --model fable --effort high`.

Use Opus 5.5 for normal reviews. Fable 5.2 can be suggested for genuinely
difficult reasoning, ambiguous cross-system design, high-stakes architecture,
subtle concurrency, or substantive issues that remain unresolved after an Opus
review. Use Fable only when the user explicitly requests it or confirms both
access and agreement to use it. Do not infer or probe for access; otherwise
continue with Opus. An adversarial review alone is not a reason to use Fable.
If Fable access fails, surface the CLI error and offer an Opus retry; never
silently switch models or rerun automatically.

Effort controls how hard the reviewer reasons. Separately, every finding is
assigned a **priority** (`critical`, `high`, `medium`, or `low`) and rendered in
priority order, then by confidence within the same priority.

## Requirements

- **Claude Code CLI** (`claude`) installed and authenticated. `cc` invokes
  `claude -p` and removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from its
  child environment. Do not assume Fable is available or included with a
  subscription: Claude Code print mode can consume usage credits without an
  interactive prompt. See the official [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)
  and [pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- **Node.js 18.18+**
- Codex with `plugins` enabled (stable since 0.144.x), or Antigravity (`agy`).

## Install

### Codex

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

### Antigravity

`agy` installs from a local directory — there is no marketplace registered in
the current build, so clone first:

```bash
git clone https://github.com/ianandersonlol/cc-plugin-codex
agy plugin install ./cc-plugin-codex/plugins/cc
```

That copies the plugin into `~/.gemini/config/plugins/cc/`, where it applies to
every workspace. `agy plugin validate ./plugins/cc` checks it without
installing, and `agy plugin uninstall cc` removes it. Plugins are read at
session start, so restart `agy` after installing.

To scope it to one repository instead, put the plugin directory at
`.agents/plugins/cc/` in that repository and Antigravity discovers it there.

**Antigravity runs shell commands from its own home directory, not your
workspace.** The skills compensate by always passing `--cwd`, but the agent can
only fill that in when it knows the workspace — in `agy -p` print mode, attach
one with `--add-dir <repo>` or the review has no repository to look at.

## Design in one paragraph

Every review skill resolves a review scope with git, renders a prompt from
`prompts/`, and runs a single `claude -p` subprocess with `--safe-mode`,
a read-only tool allowlist, and `--json-schema schemas/review-output.schema.json`.
Claude Code returns a validated object on `structured_output`, which the runtime
renders for the host.

`--safe-mode` is load-bearing: it keeps subscription auth working while
disabling `AGENTS.md`/`CLAUDE.md`, MCP servers, and user plugins in the
reviewer. That buys isolation, a 5.6x speedup, and — importantly — stops a
`CLAUDE.md` that says "delegate to Codex" or "delegate to agy" from bouncing the
request straight back and looping.

## Safety posture

`review` and `adversarial-review` are read-only by construction: a tool
allowlist covering `Read`, `Grep`, `Glob`, and read-only `git` subcommands, with
`Edit`/`Write`/`NotebookEdit` explicitly denied. Any attempt to step outside it
lands in `permission_denials` on the result envelope, so the runtime can report
it rather than silently swallow it.

The planned `rescue` skill will be the only write-capable entry point.

## License

MIT
