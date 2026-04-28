# Using agentmesh

Concrete workflows for folding agentmesh into your day. Aimed at engineers who use Linear/Slack/GitHub/Gmail/Calendar — adapt as needed.

The goal is to use agentmesh **2-3 times a day for 14 days** before tweaking anything. Real use surfaces what's missing; you'll know what to fix.

---

## Day 1 — minimum viable setup

Goal: prove the install works and unlock at least Linear.

```sh
# 1. Verify install (5 sec)
agentmesh doctor

# 2. Run the zero-config recipe (1 min, ~5¢)
agentmesh run hello

# 3. Wire Linear — uncomment its block in ~/.config/goose/config.yaml:
#    linear:
#      type: streamable_http
#      name: linear
#      enabled: true
#      url: https://mcp.linear.app/mcp
#      timeout: 30
$EDITOR ~/.config/goose/config.yaml

# 4. First Linear OAuth (browser opens; approve once)
agentmesh run linear-triage
```

If `linear-triage` produces a useful triage list, you've crossed the activation barrier. Everything else is now incremental.

---

## Daily rituals

### Morning — `morning-brief` (~30 sec to read, ~10¢)

Run this first thing, before email. The brief tells you what changed overnight + what you owe people:

```sh
agentmesh run morning-brief
```

Pre-requisite: `gsuite` (Gmail+Calendar) and `linear` MCPs enabled. If you only have Linear, the inbox/calendar sections will be marked `(tool unavailable)` but the rest still works.

### End of day — `eod-wrap` (~30 sec, ~10¢)

Run before closing your laptop. Captures what you actually did today:

```sh
agentmesh run eod-wrap
```

If you uncomment the Notion MCP, the recipe will ask whether to file the wrap-up as a daily note. Approve only when the brief looks right.

### Before any meeting — `meeting-prep`

```sh
agentmesh run meeting-prep --event "next"           # next meeting in your calendar
agentmesh run meeting-prep --event "weekly Linear"  # by title
```

Use 5 minutes before the meeting. Pulls relevant Linear issues and Slack threads for the attendees.

---

## Engineering workflows

### Drafting a PR description

After pushing your branch:

```sh
# from inside the repo, on your feature branch
agentmesh run pr-describe

# or pass an explicit PR number
agentmesh run pr-describe --pr 803
```

Outputs your team's standard `## Summary / ## Why / ## Test plan` format. Copy into the PR; edit as needed.

### Pre-incident-response context dump

When you're paged or pulled into an incident war room:

```sh
agentmesh run incident-context --alert "ManifestSlot p99 latency spike"
agentmesh run incident-context --alert "https://one.newrelic.com/alerts/123"
```

Pulls recent commits, deploy events (if observability MCP wired), and Slack threads. Paste the output into the war-room thread or Linear.

### Weekly Linear triage (Friday afternoon)

```sh
agentmesh run linear-triage
```

Walks all your assigned issues, flags stale ones, surfaces dupes, recommends 3 to promote. After printing, asks before any writes — approve specific items only.

---

## Schedule recurring runs (optional)

If you want morning-brief automatic, add a cron entry. macOS: `crontab -e`:

```
0 8 * * 1-5  /Users/mustafa.bharmal/.nvm/versions/node/v20.20.0/bin/agentmesh run morning-brief > ~/morning-brief-$(date +\%Y\%m\%d).md 2>&1
```

That runs at 8am every weekday and dumps the brief into your home dir. You can iterate on this once you know which recipes you actually want scheduled.

---

## Cost rough estimate

Each recipe run is one Anthropic API call (Claude Sonnet 4.6 by default). Approximate cost per run, based on observed usage:

| Recipe | Tokens (in+out) | $ per run |
|---|---|---|
| `hello` | ~6K | ~$0.02 |
| `linear-triage` (light) | ~15-30K | ~$0.05-0.15 |
| `morning-brief` (full) | ~25-50K | ~$0.10-0.30 |
| `incident-context` | ~20-40K | ~$0.08-0.20 |
| `eod-wrap` | ~20-40K | ~$0.08-0.20 |

Daily use of morning-brief + eod-wrap + 2-3 ad-hoc runs ≈ **$0.50-1.50/day** at Anthropic API list pricing. Cheaper if you switch to Sonnet 4.6 explicitly or use OpenAI/Gemini. Free if you switch to local Ollama (slower and lower quality on long-context tasks).

---

## When agentmesh isn't the right tool

- **Real-time chat/Q&A** — just open Goose interactively (`goose session`) for anything that doesn't fit the recipe shape.
- **Long-running coding tasks** — use Claude Code, Cursor, or `goose session` directly. Recipes are for repeatable structured outputs, not multi-hour rabbit holes.
- **Shared/team automation** — agentmesh is per-user. Need shared scheduled jobs? Use Goose recipes inside CI or n8n. (We deliberately didn't build a daemon.)

---

## Adding your own recipe

If you find yourself repeating the same prompt to Goose more than 3 times, write a recipe.

```sh
# 1. Create a YAML file
$EDITOR ~/.config/agentmesh/recipes/standup.yaml

# 2. Validate it
goose recipe validate ~/.config/agentmesh/recipes/standup.yaml

# 3. Run it
agentmesh run standup
```

See [`adding-recipes.md`](./adding-recipes.md) for the recipe schema and prompt-engineering tips that worked for the bundled recipes.

If your new recipe is genuinely useful, contribute it back via PR.

---

## Two-week experiment

For the first 14 days, **don't change anything in this repo**. Just use it.

Track in a notepad:
- Which recipes did you actually run?
- Which did you stop running and why?
- What did you wish existed?
- What output annoyed you?

After 14 days, fork that notepad into PR titles. Build from felt pain, not anticipated needs.

If you didn't reach for it 5+ times in 14 days, that's the answer — kill the project and don't feel bad. Most personal cockpits die because the maker stopped using them, not because the code didn't work.
