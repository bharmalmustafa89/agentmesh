# Adding your own recipes

A recipe is a YAML file that tells Goose what to do. agentmesh just runs `goose run --recipe <path>` under the hood, so anything Goose's recipe format supports works here.

## Anatomy

```yaml
version: "1.0.0"
title: my-recipe                  # used by `agentmesh run my-recipe`
description: |                    # shown in `agentmesh list`
  One-line description of what this does.
author:
  contact: agentmesh

parameters:                       # optional; pass with --key=value
  - key: target
    input_type: string
    requirement: optional
    description: What to operate on

instructions: |                   # the system prompt
  You are doing X. Use available MCP tools.
  Be terse. Output sections in this order: ...

prompt: |                         # the user prompt template
  Do the thing for {{ target | default: "the current context" }}.
```

## Where they live

- **Bundled recipes:** `<package>/recipes/*.yaml` — shipped with agentmesh.
- **Your recipes:** `~/.config/agentmesh/recipes/*.yaml` — copied here on `agentmesh init` and yours to edit.

`agentmesh list` reads from `~/.config/agentmesh/recipes/`. To override a bundled recipe, just edit the copy there.

## Tips that worked for the bundled recipes

- **State the output format explicitly.** "Output sections in this order" beats "be helpful."
- **Cap bullet counts.** "Output exactly 6 bullets" produces tighter results than "summarize."
- **Tell it what to do when a tool is unavailable.** "If a tool isn't available, say `(tool unavailable)` for that bullet rather than guessing."
- **Require explicit approval for writes.** Even with Goose's approval prompts, recipes should ask before any side effect ("after printing, ask whether you should make the status updates").
- **Pass parameters with sensible defaults.** `{{ pr | default: "current branch" }}` lets a recipe work with or without args.

## Test before sharing

```sh
goose run --recipe ~/.config/agentmesh/recipes/my-recipe.yaml
```

If the output is good, contribute it back via PR to the agentmesh repo.

## Reference

- [Goose recipes documentation](https://block.github.io/goose/docs/guides/recipes/)
- [MCP server registry](https://github.com/modelcontextprotocol/servers)
