<!-- Identical content lives in CLAUDE.md (Claude Code) and AGENTS.md (Codex CLI). Keep both in sync. -->

# Setup instructions for AI agents

You are setting up `agentmesh` for the current user. Follow steps in order. After each step, verify success before continuing. Never skip the verification. If any verification fails, surface the error to the user and stop — do not improvise fixes.

## Prerequisites to verify

- **Node 20+:** `node --version`. If older, instruct the user to upgrade (`nvm install 20 && nvm use 20`) and stop.
- **Goose CLI:** `goose --version`. If missing:
  - macOS: `brew install block-goose-cli` (note the `-cli` suffix — the unsuffixed cask is the GUI app)
  - Linux: `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash`
  - Reference: https://block.github.io/goose/docs/getting-started/installation
- **At least one provider:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` in shell env or `~/.config/agentmesh/.env`. Ollama running locally on `:11434` also satisfies this. If none are set and the user has not started Ollama, ask the user before continuing. Never invent values.

## Step 1: Install the CLI

Run: `npm install -g agentmesh` (or `bun install -g agentmesh`).

Verify: `agentmesh --version` returns a version. If `command not found`, the user's npm global bin directory is not on PATH — instruct them to add it (e.g. `export PATH="$(npm prefix -g)/bin:$PATH"`) and retry.

## Step 2: Initialize config

Run: `agentmesh init`.

This will:
- Create `~/.config/agentmesh/` if missing.
- Copy bundled recipes to `~/.config/agentmesh/recipes/`. **Existing local recipes are preserved**, not overwritten — only files that don't already exist are copied. Use `agentmesh init --force` to overwrite local edits with bundled defaults.
- Create `~/.config/agentmesh/.env` from the template if absent (mode `0600`). On existing files, mode is re-tightened to `0600`.
- If the user has no `~/.config/goose/config.yaml`, write the bundled template there. **If they already have a goose config, agentmesh will not modify it.** It will print the template path so the user (or you) can hand-merge stanzas.
- Verify the Goose CLI is on PATH. If not, exit non-zero and stop.
- Optionally prompt the user (only when running interactively) for a provider key to write into the env file. Never echoes the key back.

`agentmesh init` exits non-zero on missing prerequisites. Treat exit code != 0 as a hard stop.

Verify: run `agentmesh doctor`. It should report at least the following as `pass`:
- Node.js, Goose CLI, agentmesh config dir, Recipes dir, Recipes count.
- Goose config (location).
- Env file permissions (mode `0600`).
- At least one provider (Anthropic, OpenAI, Google, or Ollama local).

If `doctor` reports any failing check, fix it before continuing.

## Step 3: Wire MCP servers (optional but recommended)

Open `~/.config/goose/config.yaml`. Uncomment the stanzas the user wants enabled. The bundled options are:

| Server | Auth | Notes |
|---|---|---|
| `linear` | OAuth (no env) | Official remote at `https://mcp.linear.app/mcp`. First tool call opens a browser. |
| `notion` | OAuth (no env) | Official remote at `https://mcp.notion.com/mcp`. First tool call opens a browser. |
| `github` | `GITHUB_TOKEN` | Runs the official Docker image `ghcr.io/github/github-mcp-server`. Docker must be installed. |
| `slack` | `SLACK_XOXC_TOKEN` + `SLACK_XOXD_TOKEN` | Uses **browser** tokens (per `korotovsky/slack-mcp-server` README), not bot tokens. |
| `gsuite` | `~/.config/agentmesh/.gauth.json` + `~/.config/agentmesh/.accounts.json` | Gmail + Calendar + Drive. Needs `uvx` (`brew install uv`). First run opens a browser for OAuth. |

For env-based servers, set the matching env var in `~/.config/agentmesh/.env`. Never put credentials directly in `~/.config/goose/config.yaml` — keep them in `.env` and reference them as `${VAR}`.

Verify: `agentmesh doctor` again. Each enabled MCP server should show `✓ MCP: <name> — configured + reachable`. If a server shows `✗ configured but missing env`, fix that env var. If `✗ malformed`, the YAML stanza is broken — re-paste from the template.

## Step 4: First-run smoke test

Run: `agentmesh run morning-brief`.

If it produces a non-empty briefing, setup is complete. If it errors:
- "goose not found" → Step prerequisite missed; reinstall Goose.
- Provider auth error → Provider key is missing or invalid.
- "extension X failed" → The corresponding MCP server in `~/.config/goose/config.yaml` is misconfigured; surface the goose error to the user.

Do not attempt to fix recipe-level errors automatically. Surface them and stop.

## Done

Tell the user: *"agentmesh is set up. Try `agentmesh list` to see all recipes, or `agentmesh run morning-brief` for a real run."*

## Diagnostic conventions

`agentmesh doctor` is the source of truth for setup health. It exits non-zero on any failure and prints plain-English remediation. Whenever in doubt, run it and act on its output. Do not bypass `doctor` failures.

Environment variable precedence (used by both `init` and `doctor`): shell env wins over `~/.config/agentmesh/.env`. Set values in shell to override anything in the dotfile.
