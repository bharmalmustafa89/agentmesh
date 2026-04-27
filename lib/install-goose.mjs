import { execSync, spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const CANONICAL_INSTALL_URL = 'https://github.com/block/goose/releases/download/stable/download_cli.sh'

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

/**
 * Default `hasCommand` probe — checks PATH via the shell's `command -v`.
 * Tests inject their own stub.
 */
function defaultHasCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

/**
 * Pure function: decide how to install Goose on this platform.
 * Returns { available, cmd, args, description } where:
 *   - available=true means we have a usable installer command to run;
 *   - cmd/args are the spawn arguments (cmd is the executable name);
 *   - description is a human-readable label for prompts/logs (always non-empty).
 *
 * Available is true only when the platform is supported AND the required
 * installer tool (brew on darwin, curl on linux) is on PATH. We do not probe
 * `sh` — it's universal on POSIX.
 */
export function detectInstallStrategy({ platform = process.platform, hasCommand = defaultHasCommand } = {}) {
  if (platform === 'darwin') {
    if (!hasCommand('brew')) {
      return {
        available: false,
        cmd: null,
        args: null,
        description: 'Goose install requires Homebrew. Install brew (https://brew.sh) and re-run, or install Goose manually: brew install block-goose.',
      }
    }
    return {
      available: true,
      cmd: 'brew',
      args: ['install', 'block-goose'],
      description: 'brew install block-goose',
    }
  }

  if (platform === 'linux') {
    if (!hasCommand('curl')) {
      return {
        available: false,
        cmd: null,
        args: null,
        description: `Goose install requires curl. Install curl and re-run, or install Goose manually:\n  curl -fsSL ${CANONICAL_INSTALL_URL} | bash`,
      }
    }
    // Download to a temp file and chain with `&&` so a curl failure (404, DNS,
    // partial download) is NOT masked by bash exiting 0 on empty stdin. The
    // last `; rc=$?; rm -f ...; exit $rc` block guarantees we surface the
    // installer's exit code regardless of cleanup.
    const tmp = '/tmp/agentmesh-goose-install-$$.sh'
    const inner = `curl -fsSL ${CANONICAL_INSTALL_URL} -o ${tmp} && bash ${tmp}; rc=$?; rm -f ${tmp}; exit $rc`
    return {
      available: true,
      cmd: 'sh',
      args: ['-c', inner],
      description: `curl ${CANONICAL_INSTALL_URL} | bash`,
    }
  }

  // Unsupported platforms (win32, openbsd, aix, ...) — no auto-install.
  return {
    available: false,
    cmd: null,
    args: null,
    description: `Auto-install of Goose is unsupported on platform "${platform}". Install Goose manually: see https://block.github.io/goose/docs/getting-started/installation`,
  }
}

/**
 * Run the install command, streaming output to the user.
 * Resolves to { code, signal }. Note: a null `code` means the process was
 * killed by a signal (e.g. SIGTERM/SIGINT). The orchestrator treats
 * signal-termination as failure, NOT success.
 * Side-effectful — call only after explicit consent.
 */
export function runInstall({ cmd, args }) {
  return new Promise((resolve, reject) => {
    if (!cmd) return reject(new Error('runInstall called with null cmd'))
    const proc = spawn(cmd, args, { stdio: 'inherit' })
    proc.on('exit', (code, signal) => resolve({ code, signal }))
    proc.on('error', (err) => reject(err))
  })
}

/**
 * Orchestrate: detect strategy, prompt user (if interactive), run installer.
 * Returns { attempted: bool, success: bool, strategy }.
 *
 * Behavior:
 *   - Non-TTY: never prompts; returns attempted=false. Caller prints manual hint.
 *   - Unavailable strategy: returns attempted=false with the strategy's hint.
 *   - User declines: returns attempted=false.
 *   - User accepts: runs installer; success = (exit code 0).
 */
export async function tryInstallGoose({ interactive = false, hasCommand = defaultHasCommand } = {}) {
  const strategy = detectInstallStrategy({ hasCommand })

  if (!strategy.available) {
    return { attempted: false, success: false, strategy }
  }

  if (!interactive) {
    return { attempted: false, success: false, strategy }
  }

  const rl = readline.createInterface({ input, output })
  let answer
  try {
    answer = await rl.question(`Install Goose now via \`${strategy.description}\`? [y/N] `)
  } finally {
    rl.close()
  }
  if (!/^y(es)?$/i.test(answer.trim())) {
    return { attempted: false, success: false, strategy }
  }

  console.log(c.dim(`Running: ${strategy.cmd} ${strategy.args.join(' ')}`))
  try {
    const { code, signal } = await runInstall(strategy)
    // Only treat exit code 0 as success. A null code means the process was
    // killed by a signal — never call that success.
    const success = code === 0
    if (!success && signal) {
      console.error(c.red('!') + ` Install was terminated by signal ${signal}.`)
    }
    return { attempted: true, success, strategy, exitCode: code, signal }
  } catch (err) {
    console.error(c.red('!') + ' Install failed: ' + err.message)
    return { attempted: true, success: false, strategy, error: err }
  }
}
