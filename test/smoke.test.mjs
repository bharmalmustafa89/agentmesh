/**
 * Smoke tests — fast, dependency-free, runs on every `npm test`.
 * Goal: catch obvious shipping breakage. Not exhaustive coverage.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BIN = join(ROOT, 'bin', 'agentmesh.mjs')

function run(...args) {
  return spawnSync('node', [BIN, ...args], { encoding: 'utf8', timeout: 10_000 })
}

test('--help exits 0 and prints usage', () => {
  const r = run('--help')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage:/)
  assert.match(r.stdout, /agentmesh init/)
  assert.match(r.stdout, /agentmesh doctor/)
})

test('--version matches package.json', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const r = run('--version')
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), pkg.version)
})

test('unknown command exits 2 and prints help', () => {
  const r = run('not-a-command')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Unknown command/)
})

test('run with no arg exits 2', () => {
  const r = run('run')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Usage/)
})

test('package.json is well-formed and lists required fields', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.name)
  assert.ok(pkg.version)
  assert.ok(pkg.bin?.agentmesh)
  assert.ok(pkg.engines?.node)
  assert.ok(Array.isArray(pkg.files))
  // Must ship at least the bundled documentation that README links to.
  // Either a `docs` entry (whole dir) or each linked file individually is fine.
  const hasDocs = pkg.files.includes('docs') ||
    pkg.files.some(f => f === 'docs/adding-recipes.md') ||
    pkg.files.some(f => f === 'docs/byo-mcp.md')
  assert.ok(hasDocs, 'package files must include the user-facing docs (README links to them)')
  assert.ok(pkg.dependencies?.yaml)
  // npm-trust fields — present after Codex review.
  assert.ok(pkg.author, 'package must declare author for npm trust')
  assert.ok(pkg.repository?.url, 'package must declare repository.url')
  assert.ok(pkg.bugs?.url, 'package must declare bugs.url')
})

test('bundled goose template parses as YAML', async () => {
  const text = await readFile(join(ROOT, 'goose', 'config.template.yaml'), 'utf8')
  const parsed = YAML.parse(text)
  assert.ok(parsed.providers)
  assert.ok(parsed.extensions)
  assert.equal(parsed.extensions.developer.type, 'builtin')
  assert.equal(parsed.extensions.developer.enabled, true)
})

test('extensions.json manifest is well-formed', async () => {
  const text = await readFile(join(ROOT, 'goose', 'extensions.json'), 'utf8')
  const m = JSON.parse(text)
  assert.ok(Array.isArray(m.expected) && m.expected.length > 0)
  for (const ext of m.expected) {
    assert.ok(ext.name, 'extension entry missing name')
    assert.ok(ext.kind, `extension ${ext.name} missing kind`)
    assert.ok(Array.isArray(ext.envs), `extension ${ext.name} missing envs array`)
  }
  // Manifest must reference a builtin developer
  const dev = m.expected.find(e => e.name === 'developer')
  assert.ok(dev && dev.kind === 'builtin' && dev.required === true)
})

test('every bundled recipe parses as YAML and has required fields', async () => {
  const dir = join(ROOT, 'recipes')
  const files = (await readdir(dir)).filter(f => f.endsWith('.yaml'))
  assert.ok(files.length >= 3, `expected at least 3 recipes, found ${files.length}`)
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8')
    const r = YAML.parse(text)
    assert.ok(r.title, `${file}: missing title`)
    assert.ok(r.description, `${file}: missing description`)
    assert.ok(r.instructions, `${file}: missing instructions`)
    assert.ok(r.prompt, `${file}: missing prompt`)
    assert.equal(r.title, file.replace('.yaml', ''), `${file}: title must match filename`)
  }
})

test('AGENTS.md and CLAUDE.md have identical content', async () => {
  const a = await readFile(join(ROOT, 'AGENTS.md'), 'utf8')
  const c = await readFile(join(ROOT, 'CLAUDE.md'), 'utf8')
  assert.equal(a, c, 'AGENTS.md and CLAUDE.md must be in sync (one is the canonical source)')
})

test('hello recipe is zero-config (no required params, no external MCP servers)', async () => {
  // The hello recipe must work for a brand-new user with NO MCP credentials.
  // Asserts: file exists, parses, has no required parameters, references only
  // built-in goose tools, and does NOT mention external services that would
  // require auth.
  const path = join(ROOT, 'recipes', 'hello.yaml')
  assert.ok(existsSync(path), 'recipes/hello.yaml must exist')
  const r = YAML.parse(await readFile(path, 'utf8'))

  assert.equal(r.title, 'hello')
  assert.ok(r.description, 'hello: missing description')
  assert.ok(r.instructions, 'hello: missing instructions')
  assert.ok(r.prompt, 'hello: missing prompt')

  // Zero-config: no required parameters. Optional params are fine; the recipe
  // must work with no args.
  if (r.parameters) {
    for (const p of r.parameters) {
      assert.notEqual(p.requirement, 'required',
        `hello: parameter ${p.key} is required, but hello must be zero-config`)
    }
  }

  // LOAD-BEARING: extensions must be explicitly pinned to the developer
  // builtin. This is what physically prevents goose from loading external
  // MCP servers at runtime — without it we'd be relying on the agent to
  // abstain at prompt level, which is not a guarantee.
  // Goose recipe schema requires each extension to be an object with `type`
  // and `name` (NOT a bare string — `goose recipe validate` rejects strings).
  assert.ok(Array.isArray(r.extensions),
    'hello: must declare `extensions:` as a YAML list of {type,name} objects')
  assert.equal(r.extensions.length, 1, `hello: must declare exactly 1 extension, got ${r.extensions.length}`)
  const ext = r.extensions[0]
  assert.equal(ext.type, 'builtin', `hello: extension type must be "builtin", got ${ext.type}`)
  assert.equal(ext.name, 'developer', `hello: extension name must be "developer", got ${ext.name}`)

  // Defense-in-depth: scan instructions+prompt for unambiguous external
  // service names. Generic English words (linear, calendar, drive, notion as
  // noun) are NOT in the blocklist because they produce too many false
  // positives. The extensions pin above is the actual guarantee; this scan
  // catches obvious authoring mistakes only.
  const haystack = `${r.instructions}\n${r.prompt}`.toLowerCase()
  const unambiguous = ['gmail', 'gcal', 'gsuite', 'pagerduty', 'datadog', 'new relic', 'sentry']
  for (const svc of unambiguous) {
    const escaped = svc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    const re = new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i')
    assert.ok(!re.test(haystack),
      `hello: text references external service "${svc}" — would require MCP auth, breaking zero-config`)
  }
})

test('every bundled recipe passes `goose recipe validate` (skipped if goose not installed)', async (t) => {
  // Integration check against the real goose binary, which catches schema
  // mismatches that pure YAML parsing misses (e.g. `extensions: - developer`
  // is valid YAML but rejected by goose). Skipped on machines without goose
  // so the test suite stays runnable; CI should ensure goose is installed.
  const goose = spawnSync('command', ['-v', 'goose'], { encoding: 'utf8' })
  if (goose.status !== 0) {
    t.skip('goose CLI not installed — skipping schema validation against the real binary')
    return
  }
  const dir = join(ROOT, 'recipes')
  const files = (await readdir(dir)).filter(f => f.endsWith('.yaml'))
  for (const file of files) {
    const result = spawnSync('goose', ['recipe', 'validate', join(dir, file)], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(result.status, 0,
      `goose recipe validate ${file} failed:\n  stdout: ${result.stdout}\n  stderr: ${result.stderr}`)
  }
})

test('all recipes referenced in README exist', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const recipeRefs = [...readme.matchAll(/agentmesh run (\w[\w-]+)/g)].map(m => m[1])
  const dir = join(ROOT, 'recipes')
  for (const name of recipeRefs) {
    if (name === '<recipe>' || name === 'name') continue
    assert.ok(existsSync(join(dir, `${name}.yaml`)), `README references nonexistent recipe: ${name}`)
  }
})
