import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:process'
import YAML from 'yaml'
import { PATHS, loadDotEnv } from './env.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const checks = []
function pass(name, detail) {
  checks.push({ status: 'pass', name, detail })
  console.log(c.green('✓') + ' ' + name + (detail ? c.dim(' — ' + detail) : ''))
}
function warn(name, detail, fix) {
  checks.push({ status: 'warn', name, detail, fix })
  console.log(c.yellow('!') + ' ' + name + (detail ? c.dim(' — ' + detail) : ''))
  if (fix) console.log(c.dim('    fix: ' + fix))
}
function fail(name, detail, fix) {
  checks.push({ status: 'fail', name, detail, fix })
  console.log(c.red('✗') + ' ' + name + (detail ? c.dim(' — ' + detail) : ''))
  if (fix) console.log(c.dim('    fix: ' + fix))
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10)
  if (major >= 20) pass('Node.js', `v${process.versions.node}`)
  else fail('Node.js', `v${process.versions.node}`, 'Upgrade to Node 20+ (e.g. nvm install 20)')
}

function gooseInstallHint() {
  return platform === 'darwin'
    ? 'brew install block-goose-cli (macOS) — see https://block.github.io/goose/docs/getting-started/installation'
    : 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash (Linux)'
}

function checkGoose() {
  try {
    const version = execSync('goose --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    pass('Goose CLI', version)
    return true
  } catch {
    fail('Goose CLI', 'not installed or not on PATH', gooseInstallHint())
    return false
  }
}

function checkConfigDirs() {
  if (existsSync(PATHS.agentmeshDir)) pass('agentmesh config dir', PATHS.agentmeshDir)
  else fail('agentmesh config dir', 'missing', 'agentmesh init')

  if (existsSync(PATHS.agentmeshRecipes)) {
    pass('Recipes dir', PATHS.agentmeshRecipes)
  } else {
    fail('Recipes dir', 'missing', 'agentmesh init')
  }

  if (existsSync(PATHS.gooseConfig)) pass('Goose config', PATHS.gooseConfig)
  else warn('Goose config', 'missing at ' + PATHS.gooseConfig, 'agentmesh init  (or `goose configure`)')
}

async function checkRecipes() {
  if (!existsSync(PATHS.agentmeshRecipes)) return
  const files = (await readdir(PATHS.agentmeshRecipes)).filter(f => f.endsWith('.yaml'))
  if (files.length === 0) {
    fail('Recipes', '0 recipes found', 'agentmesh init')
  } else {
    pass('Recipes', `${files.length} installed (${files.map(f => f.replace('.yaml', '')).join(', ')})`)
  }
}

async function checkEnvPermissions() {
  if (!existsSync(PATHS.agentmeshEnv)) {
    warn('Env file', 'missing — providers will rely on shell env only', 'agentmesh init')
    return
  }
  try {
    const s = await stat(PATHS.agentmeshEnv)
    const mode = s.mode & 0o777
    if (mode <= 0o600) {
      pass('Env file permissions', `mode ${mode.toString(8).padStart(3, '0')}`)
    } else {
      warn('Env file permissions', `mode ${mode.toString(8).padStart(3, '0')} is too loose`, `chmod 600 ${PATHS.agentmeshEnv}`)
    }
  } catch (err) {
    warn('Env file permissions', `could not stat: ${err.message}`)
  }
}

async function checkProviders(env) {
  const providers = [
    { name: 'anthropic', envVar: 'ANTHROPIC_API_KEY' },
    { name: 'openai', envVar: 'OPENAI_API_KEY' },
    { name: 'google', envVar: 'GOOGLE_API_KEY' },
  ]

  let anyConfigured = false
  for (const p of providers) {
    const val = env[p.envVar]
    if (val && val.length > 8) {
      pass(`Provider: ${p.name}`, `${p.envVar} set (${val.slice(0, 6)}…)`)
      anyConfigured = true
    } else {
      warn(`Provider: ${p.name}`, `${p.envVar} not set`, `Optional. Set ${p.envVar} in ${PATHS.agentmeshEnv} if you want to use ${p.name}.`)
    }
  }

  // Local Ollama probe (counts toward "any provider" too)
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      pass('Provider: ollama (local)', 'reachable at localhost:11434')
      anyConfigured = true
    } else {
      warn('Provider: ollama (local)', `responded ${res.status}`, 'ollama serve')
    }
  } catch {
    warn('Provider: ollama (local)', 'not running', 'Optional. `brew install ollama && ollama serve` if you want local models.')
  }

  return anyConfigured
}

/**
 * Parse goose config.yaml safely. Returns the parsed object or null on error.
 */
async function parseGooseConfig() {
  if (!existsSync(PATHS.gooseConfig)) return null
  try {
    const text = await readFile(PATHS.gooseConfig, 'utf8')
    return YAML.parse(text) ?? {}
  } catch (err) {
    fail('Goose config parse', err.message, `Fix YAML syntax in ${PATHS.gooseConfig}`)
    return null
  }
}

/**
 * Validate a single MCP extension stanza against the manifest expectation.
 * Returns one of: 'ok' (configured, ready) | 'envmiss' | 'malformed' | 'disabled' | 'absent'.
 */
function validateExtension(stanza, expected, env) {
  if (!stanza) return { state: 'absent' }
  if (stanza.enabled === false) return { state: 'disabled' }

  // Schema check: every extension needs a `type`.
  const type = stanza.type
  if (!type) return { state: 'malformed', reason: 'missing `type` field' }

  if (type === 'builtin') {
    if (!stanza.name) return { state: 'malformed', reason: 'builtin without `name`' }
    return { state: 'ok' }
  }

  if (type === 'stdio') {
    if (!stanza.cmd) return { state: 'malformed', reason: 'stdio without `cmd`' }
    if (!Array.isArray(stanza.args)) return { state: 'malformed', reason: 'stdio without `args` (must be a list)' }
    // Required env vars present?
    const missingEnv = (expected.envs || []).filter(v => !env[v] || env[v].length < 4)
    if (missingEnv.length) return { state: 'envmiss', missing: missingEnv }
    return { state: 'ok' }
  }

  if (type === 'sse' || type === 'streamable_http') {
    if (!stanza.url) return { state: 'malformed', reason: `${type} without \`url\`` }
    return { state: 'ok' }
  }

  return { state: 'malformed', reason: `unknown type \`${type}\`` }
}

async function checkMcpServers(env) {
  const manifestPath = join(PKG_ROOT, 'goose', 'extensions.json')
  if (!existsSync(manifestPath)) {
    warn('MCP manifest', 'missing — skipping per-server checks')
    return
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  const config = await parseGooseConfig()
  if (config === null) {
    warn('MCP server checks', 'goose config not parseable; skipped')
    return
  }
  const extensions = config.extensions ?? {}

  for (const ext of manifest.expected) {
    const stanza = extensions[ext.name]
    const result = validateExtension(stanza, ext, env)

    switch (result.state) {
      case 'absent':
        if (ext.required) {
          fail(`MCP: ${ext.name}`, 'not configured', `Add ${ext.name}: stanza in ${PATHS.gooseConfig}. See ${join(PKG_ROOT, 'goose', 'config.template.yaml')} for a reference.`)
        } else {
          warn(`MCP: ${ext.name}`, 'not configured (optional)', `Optional. To enable, copy the ${ext.name} stanza from ${join(PKG_ROOT, 'goose', 'config.template.yaml')} into ${PATHS.gooseConfig} and set ${(ext.envs || []).join(', ') || 'no env vars (OAuth)'}.`)
        }
        break

      case 'disabled':
        warn(`MCP: ${ext.name}`, 'present but `enabled: false`', `Set ${ext.name}.enabled: true in ${PATHS.gooseConfig}`)
        break

      case 'malformed':
        fail(`MCP: ${ext.name}`, result.reason, `Fix the ${ext.name} stanza in ${PATHS.gooseConfig}`)
        break

      case 'envmiss':
        fail(`MCP: ${ext.name}`, `configured but missing env: ${result.missing.join(', ')}`, `Set ${result.missing.join(', ')} in ${PATHS.agentmeshEnv}`)
        break

      case 'ok':
        // Schema + env validation passed. We deliberately do NOT attempt a
        // runtime liveness probe here: `goose mcp <SERVER>` *runs* a server
        // (long-lived stdio), not pings it, and there's no portable HTTP probe
        // for sse/streamable_http extensions either. Goose itself surfaces
        // runtime errors when a recipe actually tries to use the extension —
        // that's the right time to learn about auth/network failures, not now.
        // For an authoritative live check, run `goose doctor`.
        pass(`MCP: ${ext.name}`, 'configured (schema + env vars valid)')
        break
    }
  }
}

export async function runDoctor() {
  console.log(c.bold('agentmesh doctor') + '\n')

  checkNode()
  const gooseOk = checkGoose()
  checkConfigDirs()
  await checkRecipes()
  await checkEnvPermissions()

  // Env precedence: shell wins over .env (Codex review item #8). mergeEnv in env.mjs is now consistent.
  const dotenv = loadDotEnv()
  const env = { ...dotenv, ...process.env }

  const anyProvider = await checkProviders(env)

  if (gooseOk) await checkMcpServers(env)

  const fails = checks.filter(c => c.status === 'fail').length
  const warns = checks.filter(c => c.status === 'warn').length
  const passes = checks.filter(c => c.status === 'pass').length

  console.log()
  console.log(c.bold('Summary: ') +
    c.green(`${passes} pass`) + ', ' +
    c.yellow(`${warns} warn`) + ', ' +
    c.red(`${fails} fail`))

  if (fails > 0) {
    console.log()
    console.log(c.red(c.bold('Setup is not ready.')) + ' Address the failing checks above before running recipes.')
    process.exit(1)
  }

  if (!anyProvider) {
    console.log()
    console.log(c.red(c.bold('No provider key configured.')) + ' Recipes will fail until at least one of ANTHROPIC/OPENAI/GOOGLE is set, or Ollama is running locally.')
    process.exit(1)
  }

  console.log()
  console.log(c.green(c.bold('Setup is ready.')) + ' Try: ' + c.bold('agentmesh run morning-brief'))
  process.exit(0)
}
