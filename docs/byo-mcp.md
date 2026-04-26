# Bring your own MCP server

agentmesh ships with a manifest of common MCP servers (Gmail, GCal, Linear, Slack, GitHub, Notion). To use one not on that list:

## 1. Find the server

Browse the [MCP server registry](https://github.com/modelcontextprotocol/servers) or community lists. Most servers are NPM packages you can run via `npx`.

## 2. Add it to Goose

Edit `~/.config/goose/config.yaml`. Add a stanza under `extensions:` modeled on the existing entries:

```yaml
extensions:
  myserver:
    type: stdio
    cmd: npx
    args: ["-y", "@vendor/mcp-server-myserver"]
    envs:
      MY_API_KEY: ${MY_API_KEY}
    enabled: true
```

For HTTP-based MCP servers:

```yaml
  myserver:
    type: sse
    url: https://example.com/mcp
    envs:
      MY_API_KEY: ${MY_API_KEY}
    enabled: true
```

## 3. Set credentials

Add the env vars to `~/.config/agentmesh/.env`:

```
MY_API_KEY=...
```

## 4. Verify

```sh
agentmesh doctor
goose mcp test myserver    # if your goose version supports it
```

## 5. Optional: extend the doctor manifest

To have `agentmesh doctor` health-check your custom server too, edit `<package>/goose/extensions.json` (or fork agentmesh and add it). For personal use, skipping this is fine — `doctor` will still surface goose-level errors.

## Tips

- **Stdio servers (most common):** auth via env vars. Keep them in `~/.config/agentmesh/.env`.
- **SSE / HTTP servers:** check the server docs for auth headers; some support env-substituted bearer tokens.
- **Authenticating via OAuth:** if the server uses OAuth (Gmail, GCal), follow its docs to obtain a refresh token, then store the token as an env var.
- **Local tools:** even local CLIs can be wrapped as stdio MCP servers — search the registry before writing one.

## Reference

- [Goose extensions docs](https://block.github.io/goose/docs/guides/extensions/)
- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25)
