# `agentmesh` — a shareable wrapper that wires agents, models, and your tools together

A single repo + install script that bundles your Goose config, MCP server manifest, and recipes so anyone (or any AI agent) can stand up the same setup in one command. The name captures what the tool actually does: stitches a *mesh* of agents (Goose), models (Claude / GPT / Ollama / local), and tools (MCP servers — Gmail, GCal, Linear, GitHub, Slack, Notion) into one coherent interface.

npm availability has to be confirmed at publish (Phase 4 verification step). If `agentmesh` is taken, backup forms: `@yourname/agentmesh` (scoped — almost always available), `agent-mesh` (hyphenated), `meshcli`.

---

## What this is (and isn't)

**Is:** a small distributable bundle — config templates, 6 recipes, an idempotent setup script, and an `AGENTS.md` that lets Claude Code, Codex CLI, or Goose itself install everything for the user. Wraps Goose; doesn't replace it.

**Isn't:** a framework, a daemon, an agent, or a model abstraction. The substrate stays Goose. We're packaging usability, not building tech.

**Why it matters:** without this, "install Goose, configure providers, write recipes" is a 4-hour personal setup that doesn't transfer. With this, it's a one-liner that anyone (including a teammate, or Claude itself) can run.

---

## Repo layout

```
agentmesh/
├── README.md                    # human-facing one-line install
├── AGENTS.md                    # AI-facing setup instructions (Claude/Codex/Goose)
├── LICENSE                      # MIT or Apache-2.0
├── package.json                 # for npx distribution + version pin
├── bin/
│   └── agentmesh                   # the CLI entrypoint (Node, single file, ~150 lines)
├── lib/
│   ├── setup.mjs                # idempotent setup logic
│   ├── recipes.mjs              # list/run/update recipes
│   └── env.mjs                  # detect mac/linux, resolve config paths
├── goose/
│   ├── config.template.yaml     # providers + extensions, with ${ENV} placeholders
│   └── extensions.json          # MCP server manifest (gmail, gcal, linear, etc.)
├── recipes/
│   ├── morning-brief.yaml
│   ├── meeting-prep.yaml
│   ├── eod-wrap.yaml
│   ├── pr-describe.yaml
│   ├── incident-context.yaml
│   └── linear-triage.yaml
├── docs/
│   ├── adding-recipes.md        # how to extend
│   └── byo-mcp.md               # how to add your own MCP servers
├── .env.example                 # required env vars (ANTHROPIC_API_KEY, etc.)
└── .github/
    └── workflows/
        └── ci.yml               # lint config, validate recipes
```

Total bespoke code: **~300 lines of JS + 6 YAML recipes + 2 markdown files.** Everything else is config and docs.

---

## How sharing works

Three distribution paths, in order of friction:

1. **Pure copy/paste:** user runs `npx agentmesh-cli init` (or `bunx agentmesh-cli init`). One command, no clone, no install.
2. **AI-driven:** user pastes the repo URL into Claude Code or Codex CLI and says "set this up for me." The agent reads `AGENTS.md`, runs the setup script, prompts for any missing env vars, validates each step. Zero manual config editing.
3. **Manual clone (for tinkerers):** `git clone … && cd agentmesh && ./bin/agentmesh init`.

All three paths converge on the same final state: `~/.config/goose/config.yaml` populated, recipes copied to `~/.config/agentmesh/recipes/`, the `agentmesh` command on `PATH`.

---

## The `agentmesh` CLI surface (trimmed after Codex review)

Four commands. `update` and `mcp add` cut — they drag the project into lifecycle/support problems and aren't worth it for v0.

```
agentmesh init          # one-time setup; idempotent; safe to re-run
agentmesh list          # show available recipes with one-line descriptions
agentmesh run <recipe>  # run a recipe (passes args through to goose)
agentmesh doctor        # check providers, MCP servers, env vars; print plain-English status
```

Under the hood every `agentmesh run X` is just `goose run --recipe ~/.config/agentmesh/recipes/X.yaml`. The wrapper exists so users don't memorize Goose's flag surface and so we own the recipe versioning.

### What was cut and why

- **`agentmesh update`** — cut. Versioning shared YAML across user installs is a real problem but it's a v1 problem. For v0, users re-run `npx agentmesh init` to refresh, and the underlying npm package version is the truth. No git-pull-into-home-directory complexity.
- **`agentmesh mcp add`** — cut. Editing the user's Goose config programmatically invites breakage on edge cases (multiple goose installs, manual edits, format drift). v0 ships with a documented `goose configure` flow; users add servers themselves. `agentmesh doctor` flags missing ones.

### What was added and why

- **`doctor` is now load-bearing.** Codex's biggest-risk callout: "relying on users' existing MCP server names/configs — that will break messily." So `doctor` becomes the single most-tested part of the CLI. It must:
  - check Goose binary version
  - check each provider key is set + reachable
  - check each expected MCP server (gmail, gcal, linear, slack, github, notion) is configured AND responding to a `tools/list` ping
  - print plain-English remediation for each failure: "Linear MCP server is configured but not responding. Try: `goose mcp test linear` or check your `LINEAR_API_KEY` env var."
  - exit non-zero if anything is broken (so AI agents can detect failure)

---

## `AGENTS.md` + `CLAUDE.md` — agent-friendly setup docs

Codex pushed back on framing this as a "universal install contract" — that's overselling. It's just **agent-friendly setup docs.** Codex CLI reads `AGENTS.md` natively; Claude Code users expect `CLAUDE.md`. We ship both, with identical content (one is a symlink to the other), and call it what it is: setup instructions phrased so an AI can follow them deterministically.

```markdown
# Setup instructions for AI agents

You are setting up `agentmesh` for the current user. Follow steps in order. After
each step, verify success before continuing. Never skip the verification.

## Prerequisites to verify
- Node 20+ available: `node --version`
- Goose installed: `goose --version` — if missing, `brew install block-goose`
- The user's API keys (ANTHROPIC_API_KEY at minimum). If not in env or
  ~/.config/agentmesh/.env, ASK the user before continuing. Never invent values.

## Step 1: Install the CLI
Run: `npm install -g agentmesh-cli` (or `bun install -g agentmesh-cli`)
Verify: `agentmesh --version` returns a version.

## Step 2: Initialize config
Run: `agentmesh init`
This will: copy goose/config.template.yaml to ~/.config/goose/config.yaml
(merging if it already exists), copy recipes/* to ~/.config/agentmesh/recipes/,
and write a stub ~/.config/agentmesh/.env if missing.

Verify: `agentmesh doctor` reports OK on (a) goose version, (b) at least one
provider configured, (c) recipes directory populated.

## Step 3: Wire MCP servers
For each MCP server the user already has authenticated (check
~/.config/claude-desktop or similar), register it via:
  `agentmesh mcp add <name> <url-or-stdio-cmd>`
At minimum confirm: gmail, gcal, linear, github, slack.
Verify: `agentmesh doctor` lists each as connected.

## Step 4: First-run smoke test
Run: `agentmesh run morning-brief --dry`
This should produce a non-empty plan without making any tool calls.
If it fails, surface the error to the user and STOP. Do not improvise fixes.

## Done
Tell the user: "agentmesh is set up. Try `agentmesh run morning-brief` for a real run."
```

This file is the contract between the bundle and any AI that sets it up. Claude Code reads it, Codex CLI reads it, future Goose recipes can read it. We avoid AI-specific dialects.

---

## Build phases (one weekend, ~1.5–2 days)

**Phase 1 — Repo skeleton + recipes (3 hours)**
- Create the repo with the layout above.
- Port the 6 recipes from the prior plan into `recipes/*.yaml`. Test each by hand against `goose run --recipe ./recipes/X.yaml`.
- Write `goose/config.template.yaml` (Anthropic + Ollama providers, no keys).
- Write `goose/extensions.json` (gmail, gcal, linear, github, slack — placeholders for the user's actual server URLs).

**Phase 2 — `agentmesh` CLI (3.5 hours; reduced from 4 after CLI trim)**
- Single Node file, no framework, just `node:fs/promises` + `node:child_process`. No build step.
- Implement `init` (copy templates, prompt for API key, validate goose presence).
- Implement `list` (read recipes dir, render with description from YAML frontmatter).
- Implement `run` (shell out to `goose run --recipe ...`).
- Implement `doctor` — **the load-bearing one.** Per-MCP-server health pings (`tools/list`), per-provider key checks, per-env-var checks. Plain-English remediation messages. Non-zero exit on failure so AI agents detect breakage.
- *Cut:* `update` and `mcp add` per Codex review (lifecycle/support problems for v0).

**Phase 3 — Setup docs + README (2 hours)**
- Write `AGENTS.md` per the spec above.
- Symlink `CLAUDE.md` → `AGENTS.md` (Claude Code reads `CLAUDE.md` by default).
- Write `README.md` with the one-liner install for humans + a 30-second demo gif (defer the gif).

**Phase 4 — `npm publish` + smoke test (1 hour)**
- Publish as `agentmesh-cli` (or whatever's free).
- Run `npx agentmesh-cli init` from a fresh user account on a different machine. Fix anything that breaks.
- Pipe the repo URL into Claude Code with "set this up for me." Confirm AI-driven path works end-to-end.

**Phase 5 — Share (15 minutes)**
- Tweet / post / drop the repo link wherever you want it shared.
- The README's one-liner becomes the share asset.

---

## Why a wrapper at all (when Goose already runs recipes)

Three concrete reasons, all about *sharing*:

1. **Versioned recipes.** Recipes evolve. `agentmesh update` keeps everyone on the same shared baseline; without it, your friend's `morning-brief.yaml` drifts from yours.
2. **Discoverability.** `agentmesh list` shows available recipes; `goose run --recipe ~/.config/agentmesh/recipes/morning-brief.yaml` does not. The wrapper hides the path.
3. **AI-readable bootstrap.** `AGENTS.md` is the contract. Without a wrapper repo, there's no canonical place for "here is how to install this." A `agentmesh` repo *is* that canonical place.

Without these three, the alternative is everyone hand-copies a gist of YAML files and edits paths — which is exactly what Pain 3 ("no unified layer") was about.

---

## What we explicitly do NOT add (to keep it tiny)

- ❌ A daemon. (Goose is request/response; cron handles scheduled runs in 1 line.)
- ❌ A web UI.
- ❌ Auth/SSO/multi-user support.
- ❌ A custom model gateway. (LiteLLM optional, not bundled.)
- ❌ A trust/policy DSL. (Goose's existing approval prompts are enough for personal use; revisit if it becomes a real product.)
- ❌ A plugin system beyond "drop a YAML in `recipes/` and PR it."

If any of these are needed later, they're additive — the wrapper doesn't preclude them.

---

## Verification (when v0 ships)

Four tests (was five — `update` cut):

1. **Clean-machine `npx` install:** `npx agentmesh-cli init` on a brand-new mac account → `agentmesh doctor` reports green within 5 minutes (assuming the user has `ANTHROPIC_API_KEY` set).
2. **AI-driven install:** paste the repo URL into Claude Code (reads `CLAUDE.md`) and Codex CLI (reads `AGENTS.md`) with "set this up for me." Both agents complete the install without human intervention beyond providing the API key.
3. **Doctor catches breakage:** intentionally remove the Linear MCP env var. Run `agentmesh doctor`. Confirm it identifies the missing piece in plain English with a fix command, and exits non-zero.
4. **Recipe runs end-to-end:** `agentmesh run morning-brief` against your real Gmail/GCal/Linear returns a useful brief.
5. **Share-test:** send the README one-liner to one other person; they install successfully without needing you on a call.

If those five pass, ship.

---

## Open questions (will ask via AskUserQuestion before exit)

1. **Naming.** `agentmesh` vs another short name. Working name only — easy to change.
2. **Distribution channel.** `npm` (npx-friendly, broad reach) vs `homebrew tap` (tighter mac integration) vs `curl | bash` (zero-runtime-dep). Recommend npm for v0.
3. **Recipe scope at launch.** Ship all 6, or start with 2 (`morning-brief`, `pr-describe`) and grow?
