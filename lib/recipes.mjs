import { readdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, loadDotEnv, mergeEnv } from './env.mjs'

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

async function readRecipeMeta(path) {
  const raw = await readFile(path, 'utf8')
  const titleMatch = raw.match(/^title:\s*(.+)$/m)
  const descMatch = raw.match(/^description:\s*\|\n((?:\s{2,}.*\n?)+)/m)
  const title = titleMatch?.[1]?.trim() ?? path.split('/').pop().replace('.yaml', '')
  const description = descMatch
    ? descMatch[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ')
    : ''
  return { title, description, path }
}

export async function listRecipes() {
  const dir = PATHS.agentmeshRecipes
  if (!existsSync(dir)) {
    console.error(c.red('!') + ` Recipes dir not found: ${dir}`)
    console.error(c.dim('  Run `agentmesh init` first.'))
    process.exit(1)
  }
  const files = (await readdir(dir)).filter(f => f.endsWith('.yaml')).sort()
  if (files.length === 0) {
    console.log(c.dim('No recipes installed. Run `agentmesh init`.'))
    return
  }
  console.log(c.bold('Available recipes:') + '\n')
  for (const file of files) {
    const meta = await readRecipeMeta(join(dir, file))
    const name = file.replace('.yaml', '')
    const desc = meta.description.length > 80 ? meta.description.slice(0, 77) + '...' : meta.description
    console.log(`  ${c.bold(name.padEnd(20))} ${c.dim(desc)}`)
  }
  console.log()
  console.log(c.dim('Run with: ') + 'agentmesh run <name>')
}

export async function runRecipe(name, passthrough = []) {
  if (!name) {
    console.error(c.red('!') + ' Usage: agentmesh run <recipe-name> [args...]')
    process.exit(2)
  }
  const recipePath = join(PATHS.agentmeshRecipes, `${name}.yaml`)
  if (!existsSync(recipePath)) {
    console.error(c.red('!') + ` Recipe not found: ${name}`)
    console.error(c.dim('  Run `agentmesh list` to see available recipes.'))
    process.exit(1)
  }

  const env = mergeEnv(loadDotEnv())
  const args = ['run', '--recipe', recipePath, ...passthrough]

  console.log(c.dim(`$ goose ${args.join(' ')}`))

  return new Promise((resolve) => {
    const proc = spawn('goose', args, { stdio: 'inherit', env })
    proc.on('exit', (code) => {
      process.exit(code ?? 0)
    })
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error(c.red('!') + ' `goose` not found on PATH.')
        console.error(c.dim('  Install: brew install block-goose-cli'))
        process.exit(127)
      }
      console.error(c.red('!') + ' Failed to spawn goose: ' + err.message)
      process.exit(1)
    })
  })
}
