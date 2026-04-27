/**
 * Unit tests for lib/install-goose.mjs.
 * Pure function tests only — does not exercise the real `brew` or `curl`.
 *
 * Invariant under test: detectInstallStrategy returns available=true only when
 * the required *installer* tool (brew on darwin, curl on linux) is on PATH.
 * The returned `cmd` is the actual executable to spawn (`brew` or `sh`); we
 * do NOT separately probe `sh` — it's universal on POSIX.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectInstallStrategy } from '../lib/install-goose.mjs'

const hasAll = () => true
const hasNone = () => false
const hasOnly = (...names) => (cmd) => names.includes(cmd)

const CANONICAL_INSTALL_URL = 'https://github.com/block/goose/releases/download/stable/download_cli.sh'

test('darwin with brew available → strategy is `brew install block-goose-cli`', () => {
  const s = detectInstallStrategy({ platform: 'darwin', hasCommand: hasOnly('brew') })
  assert.equal(s.available, true)
  assert.equal(s.cmd, 'brew')
  assert.deepEqual(s.args, ['install', 'block-goose-cli'])
  assert.match(s.description, /brew install block-goose-cli/)
})

test('darwin without brew → unavailable; null cmd/args; manual hint in description', () => {
  const s = detectInstallStrategy({ platform: 'darwin', hasCommand: hasNone })
  assert.equal(s.available, false)
  assert.equal(s.cmd, null)
  assert.equal(s.args, null)
  assert.ok(s.description.length > 0, 'must include a fallback hint')
  assert.match(s.description, /brew/i, 'fallback hint should still mention how to install brew or goose')
})

test('linux with curl available → strategy uses canonical URL with failure-safe pattern', () => {
  const s = detectInstallStrategy({ platform: 'linux', hasCommand: hasOnly('curl') })
  assert.equal(s.available, true)
  assert.equal(s.cmd, 'sh')
  assert.ok(Array.isArray(s.args) && s.args.length === 2,
    'args should be ["-c", "<command>"]')
  assert.equal(s.args[0], '-c')

  const inner = s.args[1]
  // Pin the contract: canonical URL, safe curl flags.
  assert.ok(inner.includes(CANONICAL_INSTALL_URL),
    `command must use canonical block/goose URL: ${CANONICAL_INSTALL_URL}`)
  assert.match(inner, /curl\s+-fsSL/, 'must use safe curl flags (-fsSL: fail/silent/show-errors/follow)')
  // Failure-safety: must NOT be a raw `curl ... | bash` pipeline (which masks
  // curl failures because POSIX returns the last command's exit code). Must
  // download to a temp file first and chain with && so a curl failure is
  // surfaced.
  assert.ok(!/curl[^|]*\|\s*bash\b/.test(inner),
    'must NOT use raw `curl | bash` (masks curl failures); use temp-file + && instead')
  assert.match(inner, /-o\s+\/tmp\//, 'must download to a temp file before executing')
  assert.match(inner, /&&\s*bash\s+\/tmp\//, 'must chain `bash <tmpfile>` with && so curl failure aborts')
  assert.match(inner, /rm\s+-f\s+\/tmp\//, 'must clean up the temp file')
})

test('linux without curl → unavailable; null cmd/args/description hint', () => {
  const s = detectInstallStrategy({ platform: 'linux', hasCommand: hasNone })
  assert.equal(s.available, false)
  assert.equal(s.cmd, null)
  assert.equal(s.args, null)
  assert.ok(s.description.length > 0)
  assert.match(s.description, /curl|install/i)
})

test('unsupported platforms (win32/openbsd/aix) → unavailable, polite manual hint', () => {
  for (const platform of ['win32', 'openbsd', 'aix']) {
    const s = detectInstallStrategy({ platform, hasCommand: hasAll })
    assert.equal(s.available, false, `platform ${platform} should not auto-install`)
    assert.equal(s.cmd, null)
    assert.equal(s.args, null)
    assert.match(s.description, /unsupported|manual|install/i,
      `platform ${platform} hint should explain how to install manually`)
  }
})

test('strategy is deterministic given same inputs (pure function)', () => {
  const a = detectInstallStrategy({ platform: 'darwin', hasCommand: hasOnly('brew') })
  const b = detectInstallStrategy({ platform: 'darwin', hasCommand: hasOnly('brew') })
  assert.deepEqual(a, b)
})

test('available=true requires the *installer* tool on PATH (brew on darwin, curl on linux)', () => {
  // Not the wrong tool: darwin needs brew, not curl.
  const s1 = detectInstallStrategy({ platform: 'darwin', hasCommand: hasOnly('curl') })
  assert.equal(s1.available, false)
  assert.equal(s1.cmd, null)

  // Linux needs curl, not brew.
  const s2 = detectInstallStrategy({ platform: 'linux', hasCommand: hasOnly('brew') })
  assert.equal(s2.available, false)
  assert.equal(s2.cmd, null)
})
