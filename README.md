# agentmesh

A shareable wrapper that wires **agents** (Goose), **models** (Claude / GPT / Ollama), and **tools** (MCP servers — Gmail, Google Calendar, Linear, Slack, GitHub, Notion) into one coherent setup. Recipes for the work you actually do.

## Install

```sh
npx agentmesh init
```

That's it. `agentmesh init` checks Goose, copies recipes to `~/.config/agentmesh/recipes/`, and prompts for your Anthropic API key if it's not already set. Run `agentmesh doctor` afterwards to verify your setup.

> **Prerequisites:** Node 20+, [Goose CLI](https://block.github.io/goose/docs/getting-started/installation) (`brew install block-goose-cli` on macOS — note the `-cli` suffix; the unsuffixed cask is the desktop GUI app), and an `ANTHROPIC_API_KEY` (or use Ollama for local-only).

## Usage

```sh
agentmesh list                       # Show available recipes
agentmesh run hello                  # Zero-config smoke test (no MCP creds needed)
agentmesh run morning-brief          # Tight brief of what matters today
agentmesh run pr-describe --pr 803   # Draft a PR description from a diff
agentmesh doctor                     # Health-check providers, MCP servers, env vars
```

Recipe parameters can be passed in any of these forms — they all translate to Goose's `--params key=value`:

```sh
agentmesh run pr-describe --pr 803
agentmesh run pr-describe --pr=803
agentmesh run pr-describe --params pr=803
```

After install, the fastest way to verify everything is wired:

```sh
agentmesh run hello
```

It uses only Goose's built-in developer tools — no Gmail/Linear/etc. setup required.

## Recipes shipped in v0

| Recipe | What it does | External integrations |
|---|---|---|
| `hello` | Zero-config first-run smoke test | None — built-ins only |
| `morning-brief` | Calendar + urgent email + blocked Linear + PRs awaiting review | Gmail, GCal, Linear, GitHub |
| `meeting-prep` | Pre-meeting brief joining calendar, attendees' Linear issues, Slack threads, docs | GCal, Linear, Slack, Drive/Notion |
| `eod-wrap` | End-of-day summary: shipped, reviewed, Linear progress, follow-ups, tomorrow's prep | Git, Linear, GitHub, GCal, Notion |
| `pr-describe` | Draft a PR description from a git diff in Summary / Why / Test plan format | Git, Linear |
| `incident-context` | Compact incident note joining observability + commits + Slack | Observability tool, Git, Slack |
| `linear-triage` | Weekly triage of Linear issues — active/stale/dupes/closeable + 3 to promote | Linear |

## How it works

`agentmesh run X` is a thin wrapper around `goose run --recipe ~/.config/agentmesh/recipes/X.yaml`. Recipes are short YAML files; Goose handles tool calls, model routing, and approvals. We just package the recipes + setup so you can share one command instead of a copy-paste tutorial.

```
                ┌────────────────────────────┐
                │       agentmesh CLI         │
                │  init / list / run / doctor │
                └─────────────┬──────────────┘
                              │
                ┌─────────────▼──────────────┐
                │         Goose              │
                │   (agent, MCP-native)      │
                └─────────────┬──────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  ┌──────────┐          ┌──────────┐          ┌──────────┐
  │ Models   │          │  MCP     │          │  Goose   │
  │ Claude / │          │ servers  │          │ built-ins│
  │ GPT /    │          │ (Gmail,  │          │ (shell,  │
  │ Ollama   │          │  Linear, │          │  fs, git)│
  └──────────┘          │  …)      │          └──────────┘
                        └──────────┘
```

## Install via AI agent

Paste this into Claude Code or Codex CLI:

> Set up agentmesh from `https://github.com/bharmalmustafa89/agentmesh`. Read `AGENTS.md` and follow the steps. Stop and ask me if any verification fails.

The agent reads [`AGENTS.md`](./AGENTS.md), runs the install steps deterministically, and asks for any missing credentials. No manual config editing.

## Daily use

See [docs/usage.md](./docs/usage.md) for concrete daily/weekly workflows: morning brief, end-of-day wrap, meeting prep, PR description drafting, incident response, weekly Linear triage, plus cost estimates and a 14-day experiment plan.

## Adding your own recipes

Drop a YAML file in `~/.config/agentmesh/recipes/`. See [docs/adding-recipes.md](./docs/adding-recipes.md) and Goose's [recipe docs](https://block.github.io/goose/docs/guides/recipes/).

## What this is not

- Not a daemon. Goose is request/response; use `cron` if you want scheduled runs.
- Not a replacement for Goose. It's a wrapper that pre-packages recipes and a setup script.
- Not a model abstraction layer. Goose handles providers; we don't reinvent that.
- Not a trust/policy framework. Goose's existing approval prompts are what you get.

## License

MIT
