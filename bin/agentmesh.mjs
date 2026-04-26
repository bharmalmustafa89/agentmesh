#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit } from '../lib/setup.mjs'
import { listRecipes, runRecipe } from '../lib/recipes.mjs'
import { runDoctor } from '../lib/doctor.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'))
const VERSION = PKG.version

const HELP = `agentmesh — wires agents (Goose), models (Claude/GPT/Ollama), and tools (MCP) together.

Usage:
  agentmesh init [--force]    One-time setup. Idempotent. --force overwrites local recipes.
  agentmesh list              Show installed recipes.
  agentmesh run <name> [...]  Run a recipe (extra args passed through to goose).
  agentmesh doctor            Validate providers, MCP servers, env vars; plain-English status.
  agentmesh --version
  agentmesh --help

Docs: https://github.com/mustafabharmal/agentmesh
`

async function main() {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP)
      return

    case '--version':
    case '-v':
    case 'version':
      console.log(VERSION)
      return

    case 'init': {
      const force = rest.includes('--force') || rest.includes('-f')
      await runInit({ force })
      return
    }

    case 'list':
    case 'ls':
      await listRecipes()
      return

    case 'run':
      await runRecipe(rest[0], rest.slice(1))
      return

    case 'doctor':
      await runDoctor()
      return

    default:
      console.error(`Unknown command: ${command}\n`)
      console.error(HELP)
      process.exit(2)
  }
}

main().catch((err) => {
  console.error('agentmesh: ' + (err.stack || err.message || err))
  process.exit(1)
})
