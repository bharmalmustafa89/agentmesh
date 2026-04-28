import { mkdir, copyFile, readdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output, platform } from 'node:process'
import YAML from 'yaml'
import { PATHS, loadDotEnv, mergeEnv } from './env.mjs'
import { tryInstallGoose } from './install-goose.mjs'
import { categorizeRecipes, loadEnabledExtensions } from './next-steps.mjs'

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

/**
 * Ensure ~/.config/agentmesh/.env exists with mode 0600. Returns
 *   { created: bool, chmodOk: bool, chmodError?: string }.
 * Caller renders messaging from the result rather than this function
 * silently lying about permissions.
 */
async function ensureEnvFile() {
  const path = PATHS.agentmeshEnv
  await ensureDir(PATHS.agentmeshDir)
  let created = false
  if (!existsSync(path)) {
    const example = await readFile(join(PKG_ROOT, '.env.example'), 'utf8')
    await writeFile(path, example, { mode: 0o600 })
    created = true
  }
  // Tighten permissions on every run, but report failure honestly.
  try {
    await chmod(path, 0o600)
    return { created, chmodOk: true }
  } catch (err) {
    return { created, chmodOk: false, chmodError: err.message || String(err) }
  }
}

/**
 * Pick a default Goose provider based on which provider keys are reachable.
 * Returns { provider, model } that we'll write into a fresh goose config —
 * or null if none of the supported providers is configured (caller decides
 * what to do).
 *
 * Precedence matches user expectations: Anthropic first (the design default),
 * then OpenAI, then Google. Local Ollama is also detected and chosen if
 * nothing else is set.
 */
async function detectProvider() {
  const env = mergeEnv(loadDotEnv())
  if (env.ANTHROPIC_API_KEY?.length > 8) {
    return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
  }
  if (env.OPENAI_API_KEY?.length > 8) {
    return { provider: 'openai', model: 'gpt-5' }
  }
  if (env.GOOGLE_API_KEY?.length > 8) {
    return { provider: 'google', model: 'gemini-2.5-pro' }
  }
  // Local Ollama probe (best-effort, short timeout).
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(800) })
    if (res.ok) return { provider: 'ollama', model: 'qwen2.5-coder:32b' }
  } catch { /* not running — fine */ }
  return null
}

/**
 * Replace `GOOSE_PROVIDER:` and `GOOSE_MODEL:` in the bundled template with
 * the detected provider's values. Pure string substitution — keeps the rest
 * of the template (extensions, comments, env interpolation) intact.
 */
function applyProviderToTemplate(templateText, { provider, model }) {
  return templateText
    .replace(/^GOOSE_PROVIDER:\s*\S+/m, `GOOSE_PROVIDER: ${provider}`)
    .replace(/^GOOSE_MODEL:\s*\S+/m, `GOOSE_MODEL: ${model}`)
}

/**
 * Goose config policy: non-destructive, but provider-aware on first write.
 *  - If the user has no goose config, write our template there with
 *    GOOSE_PROVIDER set to whatever provider has a reachable key/server.
 *  - If they have one, do not modify it. Print where to find our template
 *    so they can hand-merge any stanzas they want.
 * Returns { wrote, existing, templatePath, provider | null }.
 */
async function syncGooseConfig() {
  const templatePath = join(PKG_ROOT, 'goose', 'config.template.yaml')
  if (existsSync(PATHS.gooseConfig)) {
    return { wrote: false, existing: true, templatePath, provider: null }
  }
  await ensureDir(PATHS.gooseDir)
  let text = await readFile(templatePath, 'utf8')
  // Sanity-parse the template before substitution so we never write malformed YAML.
  YAML.parse(text)

  const detected = await detectProvider()
  if (detected) {
    text = applyProviderToTemplate(text, detected)
    // Sanity-parse again after substitution.
    YAML.parse(text)
  }

  await writeFile(PATHS.gooseConfig, text)
  return { wrote: true, existing: false, templatePath, provider: detected }
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
 * Read a secret from stdin without echoing it to the terminal. Uses raw mode
 * to consume keystrokes manually and emits asterisks instead of the actual
 * characters. Handles backspace, Ctrl-C (cancels with empty result),
 * Enter/Return.
 */
async function readSecret(prompt) {
  output.write(prompt)
  return new Promise((resolve) => {
    const chars = []
    const onData = (chunk) => {
      const s = chunk.toString('utf8')
      for (const ch of s) {
        const code = ch.charCodeAt(0)
        if (code === 13 || code === 10) {
          // Enter / Return — finish.
          output.write('\n')
          cleanup()
          resolve(chars.join(''))
          return
        }
        if (code === 3) {
          // Ctrl-C — cancel.
          output.write('\n')
          cleanup()
          resolve('')
          return
        }
        if (code === 127 || code === 8) {
          // Backspace.
          if (chars.length > 0) {
            chars.pop()
            output.write('\b \b')
          }
          continue
        }
        if (code < 32) continue // ignore other control chars
        chars.push(ch)
        output.write('*')
      }
    }
    function cleanup() {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
    }
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

/**
 * If running interactively and no provider key is configured, prompt the user
 * for one to write into the .env file. The input is masked (asterisks instead
 * of characters) so it isn't visible in the terminal scrollback. Never echoed
 * back. In non-interactive shells, just print a remediation hint.
 *
 * Recommends setting the env var in shell as the safer alternative — pasting
 * a key into any prompt is inherently riskier than `export ANTHROPIC_API_KEY`.
 */
async function maybePromptApiKey({ alreadyOk }) {
  if (alreadyOk) return
  if (!input.isTTY) {
    console.log(c.yellow('!') + ' No provider key set. Edit ' + PATHS.agentmeshEnv + ' before first run.')
    return
  }
  console.log(c.dim('  Recommended: `export ANTHROPIC_API_KEY=sk-ant-...` in your shell rc instead of pasting here.'))
  const key = (await readSecret('  Paste ANTHROPIC_API_KEY (input is masked; will be saved to ' + PATHS.agentmeshEnv + ', mode 0600). Leave blank to skip: ')).trim()
  if (!key) {
    console.log(c.dim('  Skipped. Edit ' + PATHS.agentmeshEnv + ' later or export the key in your shell.'))
    return
  }
  if (!/^sk-[A-Za-z0-9_-]{20,}/.test(key)) {
    console.log(c.yellow('!') + ' That does not look like an Anthropic API key (expected `sk-` prefix). Saving anyway.')
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
  // chmod is best-effort; surface a real error rather than swallowing.
  try {
    await chmod(PATHS.agentmeshEnv, 0o600)
  } catch (err) {
    console.log(c.yellow('!') + ' Could not chmod 0600 on ' + PATHS.agentmeshEnv + ': ' + err.message)
    console.log(c.dim('  Run manually: chmod 600 ' + PATHS.agentmeshEnv))
  }
  // Confirm without echoing the key back
  console.log(c.green('✓') + ' Saved to ' + PATHS.agentmeshEnv + ' (key not echoed for safety).')
}

export async function runInit({ force = false } = {}) {
  console.log(c.bold('agentmesh init') + '\n')
  let hadFatal = false

  await ensureDir(PATHS.agentmeshDir)
  console.log(c.green('✓') + ' Config dir: ' + PATHS.agentmeshDir)

  const envFile = await ensureEnvFile()
  let envSuffix = envFile.created ? ' (created from template)' : ' (already exists)'
  if (envFile.chmodOk) {
    envSuffix += ', mode 0600 enforced'
  }
  console.log((envFile.chmodOk ? c.green('✓') : c.yellow('!')) + ' Env file: ' + PATHS.agentmeshEnv + envSuffix)
  if (!envFile.chmodOk) {
    console.log(c.dim('  chmod failed: ' + envFile.chmodError))
    console.log(c.dim('  Fix manually: chmod 600 ' + PATHS.agentmeshEnv))
  }

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

  // Goose config (non-destructive, provider-aware on first write)
  const gooseSync = await syncGooseConfig()
  if (gooseSync.wrote) {
    if (gooseSync.provider) {
      console.log(c.green('✓') + ' Goose config: wrote ' + PATHS.gooseConfig +
        ` (provider: ${c.bold(gooseSync.provider.provider)}, model: ${gooseSync.provider.model})`)
    } else {
      console.log(c.yellow('!') + ' Goose config: wrote ' + PATHS.gooseConfig +
        ' but NO provider key/server detected — recipes will fail until you set ANTHROPIC_API_KEY (or OPENAI/GOOGLE) or start Ollama.')
    }
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

  // Re-check provider after the prompt: the user may have pasted a key, or
  // declined / hit enter. If they declined and no provider is reachable
  // anywhere (shell env, .env, local Ollama), recipes will fail at runtime —
  // make this a fatal init error so the user can't proceed without realizing.
  if (!providerKey.ok) {
    const reChecked = checkProviderKey()
    if (!reChecked.ok) {
      // Local Ollama is also acceptable.
      let ollamaOk = false
      try {
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(800) })
        ollamaOk = res.ok
      } catch { /* ignore */ }
      if (!ollamaOk) {
        console.log()
        console.log(c.red('✗') + ' No provider configured.')
        console.log(c.dim('  Set ANTHROPIC_API_KEY (or OPENAI/GOOGLE) in your shell, or in ' + PATHS.agentmeshEnv + ',') )
        console.log(c.dim('  or start Ollama locally (`brew install ollama && ollama serve`).'))
        hadFatal = true
      }
    }
  }

  // Offer to symlink the CLI globally so the user can type `agentmesh` instead
  // of `node bin/agentmesh.mjs`. Only relevant when running from a local
  // checkout; safe-skip otherwise. Idempotent.
  await maybeOfferLink()

  console.log()
  if (hadFatal) {
    console.log(c.red(c.bold('Setup is incomplete.')) + ' Address the issues above, then re-run `agentmesh init`.')
    process.exit(1)
  }
  await printNextSteps()
}

/**
 * Context-aware next-steps: based on which MCP servers are enabled in the
 * user's goose config, list which recipes can run now vs. what's blocked.
 * End with a single concrete recommendation.
 */
async function printNextSteps() {
  const enabled = await loadEnabledExtensions()
  const { ready, needsArgs, blocked } = categorizeRecipes(enabled)

  console.log(c.bold('Ready to run now:'))
  if (ready.length === 0) {
    console.log(c.dim('  (none — install Goose first, then re-run `agentmesh init`)'))
  } else {
    for (const r of ready) {
      console.log(`  ${c.bold(`agentmesh run ${r}`)}`)
    }
  }

  if (needsArgs.length) {
    console.log()
    console.log(c.bold('Ready, but require an argument:'))
    for (const { recipe, params } of needsArgs) {
      const example = params.map(p => `--${p} <value>`).join(' ')
      console.log(`  ${c.bold('agentmesh run ' + recipe + ' ' + example)}`)
    }
  }

  if (blocked.length) {
    console.log()
    console.log(c.bold('Need MCP servers enabled:'))
    for (const { recipe, missing } of blocked) {
      console.log(`  ${('agentmesh run ' + recipe).padEnd(32)} ${c.dim('— needs ' + missing.join(', '))}`)
    }
  }

  // Single concrete recommendation based on current state.
  console.log()
  if (ready.length === 1 && ready[0] === 'hello') {
    console.log(c.bold('Recommended first run:'))
    console.log(`  ${c.bold('agentmesh run hello')}   ${c.dim('# zero-config smoke test')}`)
    console.log()
    console.log(c.dim('To unlock more recipes, edit ' + PATHS.gooseConfig + ':'))
    console.log(c.dim('  • Uncomment `linear:` (OAuth in browser, no env vars)  → unlocks linear-triage'))
    console.log(c.dim('  • Uncomment `notion:` (OAuth in browser, no env vars)'))
    console.log(c.dim('  • Gmail/Calendar/Slack/GitHub: see docs/byo-mcp.md'))
  } else if (blocked.length > 0) {
    console.log(c.bold('Verify first:'))
    console.log(`  ${c.bold('agentmesh doctor')}`)
    console.log()
    console.log(c.dim('To unlock the blocked recipes, uncomment more `extensions:` blocks in ' + PATHS.gooseConfig))
    console.log(c.dim('See: docs/byo-mcp.md'))
  } else {
    console.log(c.bold('Verify first:'))
    console.log(`  ${c.bold('agentmesh doctor')}`)
  }
}
