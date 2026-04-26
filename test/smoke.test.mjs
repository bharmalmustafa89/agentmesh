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
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('docs'))
  assert.ok(pkg.dependencies?.yaml)
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

test('all recipes referenced in README exist', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const recipeRefs = [...readme.matchAll(/agentmesh run (\w[\w-]+)/g)].map(m => m[1])
  const dir = join(ROOT, 'recipes')
  for (const name of recipeRefs) {
    if (name === '<recipe>' || name === 'name') continue
    assert.ok(existsSync(join(dir, `${name}.yaml`)), `README references nonexistent recipe: ${name}`)
  }
})
