import { mkdir, copyFile, readdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output, platform } from 'node:process'
import YAML from 'yaml'
import { PATHS, loadDotEnv } from './env.mjs'
import { tryInstallGoose } from './install-goose.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

/**
 * Copy bundled recipes to ~/.config/agentmesh/recipes/.
 * Non-destructive: only copies files that don't exist locally, unless force=true.
 * Returns { copied, skipped, overwritten } for reporting.
 */
async function copyRecipes({ force = false } = {}) {
  const src = join(PKG_ROOT, 'recipes')
  const dst = PATHS.agentmeshRecipes
  await ensureDir(dst)
  const files = await readdir(src)
  const result = { copied: [], skipped: [], overwritten: [] }
  for (const file of files) {
    if (!file.endsWith('.yaml')) continue
    const dstPath = join(dst, file)
    if (existsSync(dstPath) && !force) {
      result.skipped.push(file)
      continue
    }
    if (existsSync(dstPath) && force) {
      result.overwritten.push(file)
    } else {
      result.copied.push(file)
    }
    await copyFile(join(src, file), dstPath)
  }
  return result
}

async function ensureEnvFile() {
  const path = PATHS.agentmeshEnv
  await ensureDir(PATHS.agentmeshDir)
  if (existsSync(path)) {
    // Tighten permissions to 0600 even on existing files (Codex review item)
    try { await chmod(path, 0o600) } catch { /* best effort */ }
    return false
  }
  const example = await readFile(join(PKG_ROOT, '.env.example'), 'utf8')
  await writeFile(path, example, { mode: 0o600 })
  return true
}

/**
 * Goose config policy: non-destructive.
 *  - If the user has no goose config, write our template there.
 *  - If they have one, do not modify it. Print where to find our template
 *    so they can hand-merge any stanzas they want.
 * Returns { wrote: bool, existing: bool, templatePath: string }.
 */
async function syncGooseConfig() {
  const templatePath = join(PKG_ROOT, 'goose', 'config.template.yaml')
  if (existsSync(PATHS.gooseConfig)) {
    return { wrote: false, existing: true, templatePath }
  }
  await ensureDir(PATHS.gooseDir)
  // Sanity-parse the template so we never write malformed YAML.
  const text = await readFile(templatePath, 'utf8')
  YAML.parse(text)
  await writeFile(PATHS.gooseConfig, text)
  return { wrote: true, existing: false, templatePath }
}

function checkGoose() {
  const path = which('goose')
  if (!path) {
    const installHint = platform === 'darwin'
      ? '  brew install block-goose-cli'
      : '  curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash'
    console.log(c.yellow('!') + ' Goose CLI is not installed.')
    console.log(c.dim(installHint))
    console.log(c.dim('  See https://block.github.io/goose/docs/getting-started/installation'))
    return false
  }
  try {
    const version = execSync('goose --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    console.log(c.green('✓') + ' Goose installed: ' + c.dim(version))
    return true
  } catch {
    console.log(c.yellow('!') + ' Goose found at ' + path + ' but `goose --version` failed.')
    return false
  }
}

/**
 * Check whether at least one provider key is reachable.
 * Reads only shell env (we don't echo secrets and we don't read .env at this stage).
 * Returns { ok: bool, configuredVia: string | null }.
 */
/**
 * Check whether at least one provider key is reachable.
 * Precedence: shell env wins over ~/.config/agentmesh/.env (Codex review item #8).
 * Returns { ok: bool, source: 'shell' | 'dotenv' | null, key: string | null }.
 */
function checkProviderKey() {
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
  for (const k of keys) {
    if (process.env[k]?.length >= 8) {
      console.log(c.green('✓') + ` ${k} found in shell environment.`)
      return { ok: true, source: 'shell', key: k }
    }
  }
  const dotenv = loadDotEnv()
  for (const k of keys) {
    if (dotenv[k]?.length >= 8) {
      console.log(c.green('✓') + ` ${k} found in ~/.config/agentmesh/.env`)
      return { ok: true, source: 'dotenv', key: k }
    }
  }
  return { ok: false, source: null, key: null }
}

/**
 * If we're running from a local checkout of the agentmesh package and the
 * `agentmesh` command isn't on PATH yet, offer to `npm link` so the user can
 * type `agentmesh ...` directly. Skips silently when:
 *   - non-interactive
 *   - running from an npx temp dir (will be GC'd anyway)
 *   - already on PATH
 *   - not actually inside the agentmesh package source (e.g. user installed
 *     globally; npm took care of PATH)
 */
async function maybeOfferLink() {
  // Already on PATH? Nothing to do.
  if (which('agentmesh')) return

  // Are we running from a real checkout of this package?
  const pkgRoot = PKG_ROOT
  const pkgJsonPath = join(pkgRoot, 'package.json')
  if (!existsSync(pkgJsonPath)) return
  let pkg
  try {
    pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
  } catch {
    return
  }
  if (pkg.name !== 'agentmesh') return

  // npx unpacks into a temp path under .npm/_npx — skip linking that, it gets cleaned up.
  if (pkgRoot.includes('/_npx/') || pkgRoot.includes('/.npm/')) return

  if (!input.isTTY) {
    console.log(c.dim('To use `agentmesh` as a global command: run `npm link` in ' + pkgRoot))
    return
  }

  const rl = readline.createInterface({ input, output })
  let answer
  try {
    answer = await rl.question('Run `npm link` to make `agentmesh` available globally? [Y/n] ')
  } finally {
    rl.close()
  }
  // Default-yes (empty answer accepts).
  if (/^n(o)?$/i.test(answer.trim())) {
    console.log(c.dim('  Skipped. Run manually with: cd ' + pkgRoot + ' && npm link'))
    return
  }

  console.log(c.dim('Running: npm link'))
  try {
    execSync('npm link', { cwd: pkgRoot, stdio: 'inherit' })
    if (which('agentmesh')) {
      console.log(c.green('✓') + ' `agentmesh` is now available globally.')
    } else {
      console.log(c.yellow('!') + ' `npm link` succeeded but `agentmesh` is not on PATH yet — open a new shell or check your npm global bin.')
    }
  } catch (err) {
    console.log(c.yellow('!') + ' npm link failed: ' + (err.message || err))
    console.log(c.dim('  Run manually: cd ' + pkgRoot + ' && npm link'))
  }
}

/**
 * If running interactively and no provider key is configured, prompt the user
 * for one to write into the .env file. Never echo the entered value back.
 * In non-interactive shells, just print a remediation hint.
 */
async function maybePromptApiKey({ alreadyOk }) {
  if (alreadyOk) return
  if (!input.isTTY) {
    console.log(c.yellow('!') + ' No provider key set. Edit ' + PATHS.agentmeshEnv + ' before first run.')
    return
  }
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question('Paste your ANTHROPIC_API_KEY (will be saved to ' + PATHS.agentmeshEnv + ', mode 0600). Leave blank to skip: ')
    const key = answer.trim()
    if (!key) {
      console.log(c.dim('  Skipped. Edit ' + PATHS.agentmeshEnv + ' later.'))
      return
    }
    if (!/^sk-[A-Za-z0-9_-]{20,}/.test(key)) {
      console.log(c.yellow('!') + ' That does not look like an Anthropic API key (expected sk-... prefix). Saving anyway.')
    }
    const text = await readFile(PATHS.agentmeshEnv, 'utf8')
    const lines = text.split('\n')
    let updated = false
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('ANTHROPIC_API_KEY=')) {
        lines[i] = `ANTHROPIC_API_KEY=${key}`
        updated = true
        break
      }
    }
    if (!updated) lines.push(`ANTHROPIC_API_KEY=${key}`)
    await writeFile(PATHS.agentmeshEnv, lines.join('\n'), { mode: 0o600 })
    await chmod(PATHS.agentmeshEnv, 0o600)
    // Confirm without echoing the key back
    console.log(c.green('✓') + ' Saved to ' + PATHS.agentmeshEnv + ' (key not echoed for safety).')
  } finally {
    rl.close()
  }
}

export async function runInit({ force = false } = {}) {
  console.log(c.bold('agentmesh init') + '\n')
  let hadFatal = false

  await ensureDir(PATHS.agentmeshDir)
  console.log(c.green('✓') + ' Config dir: ' + PATHS.agentmeshDir)

  const created = await ensureEnvFile()
  console.log(c.green('✓') + ' Env file: ' + PATHS.agentmeshEnv + (created ? ' (created from template)' : ' (already exists, mode 0600 enforced)'))

  // Recipes (non-destructive)
  const recipes = await copyRecipes({ force })
  const parts = []
  if (recipes.copied.length) parts.push(`${recipes.copied.length} new (${recipes.copied.join(', ')})`)
  if (recipes.overwritten.length) parts.push(`${recipes.overwritten.length} overwritten`)
  if (recipes.skipped.length) parts.push(`${recipes.skipped.length} preserved`)
  console.log(c.green('✓') + ' Recipes: ' + (parts.join(', ') || 'no recipes bundled') + ' in ' + PATHS.agentmeshRecipes)
  if (recipes.skipped.length && !force) {
    console.log(c.dim('  Use --force to overwrite local edits with bundled defaults.'))
  }

  // Goose config (non-destructive merge)
  const gooseSync = await syncGooseConfig()
  if (gooseSync.wrote) {
    console.log(c.green('✓') + ' Goose config: wrote ' + PATHS.gooseConfig + ' from template')
  } else {
    console.log(c.yellow('!') + ' Goose config: existing file preserved at ' + PATHS.gooseConfig)
    console.log(c.dim('  Reference template (with MCP server stanzas): ' + gooseSync.templatePath))
    console.log(c.dim('  Hand-merge stanzas you want; agentmesh will not modify your existing config.'))
  }

  // Prerequisites
  let gooseOk = checkGoose()
  if (!gooseOk) {
    // Offer to auto-install Goose if interactive and the platform supports it.
    const result = await tryInstallGoose({ interactive: input.isTTY })
    if (result.attempted && result.success) {
      console.log(c.green('✓') + ' Goose installed successfully.')
      gooseOk = checkGoose()
    } else if (result.attempted && !result.success) {
      console.log(c.yellow('!') + ' Goose install did not complete cleanly. Continue manually:')
      console.log(c.dim('  ' + result.strategy.description))
    } else if (!result.attempted) {
      // Either non-TTY, unavailable platform, or user declined. Surface the hint.
      // (`checkGoose()` already printed a hint; only print extra if the strategy
      // has a different description, e.g. on Linux without curl.)
      if (result.strategy && !result.strategy.available) {
        console.log(c.dim('  ' + result.strategy.description))
      }
    }
  }
  if (!gooseOk) hadFatal = true

  const providerKey = checkProviderKey()
  await maybePromptApiKey({ alreadyOk: providerKey.ok })

  // Offer to symlink the CLI globally so the user can type `agentmesh` instead
  // of `node bin/agentmesh.mjs`. Only relevant when running from a local
  // checkout; safe-skip otherwise. Idempotent.
  await maybeOfferLink()

  console.log()
  if (hadFatal) {
    console.log(c.red(c.bold('Setup is incomplete.')) + ' Install Goose, then re-run `agentmesh init`.')
    process.exit(1)
  }
  console.log(c.bold('Next steps:'))
  console.log(`  1. Run ${c.bold('agentmesh doctor')} to verify your setup.`)
  console.log(`  2. Open ${c.bold(PATHS.gooseConfig)} and uncomment the MCP servers you want.`)
  console.log(`  3. Run ${c.bold('agentmesh list')} to see available recipes.`)
  console.log(`  4. Run ${c.bold('agentmesh run morning-brief')} for a real run.`)
  console.log()
  console.log(c.dim('Edit ' + PATHS.agentmeshEnv + ' to add credentials for MCP servers (Slack/GitHub etc.)'))
  console.log(c.dim('Linear and Notion use OAuth in browser — no env vars needed.'))
}
