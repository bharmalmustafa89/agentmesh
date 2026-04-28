/**
 * Unit tests for lib/next-steps.mjs. Pure functions only.
 *
 * Three categories:
 *   ready     — all required MCPs enabled, no required params
 *   needsArgs — MCPs all enabled, but recipe has required parameters
 *   blocked   — at least one required MCP missing
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categorizeRecipes, RECIPE_REQUIREMENTS, REQUIRED_PARAMS } from '../lib/next-steps.mjs'

const ALL_RECIPES = Object.keys(RECIPE_REQUIREMENTS)

test('categorizeRecipes: nothing enabled → hello in ready, incident-context in needsArgs', () => {
  const { ready, needsArgs, blocked } = categorizeRecipes([])
  assert.ok(ready.includes('hello'), 'hello must be ready with no extensions')
  // incident-context has no MCP requirements but DOES have a required `alert`
  // param — it should NOT be in ready (running without args would fail).
  assert.ok(!ready.includes('incident-context'),
    'incident-context must NOT be in ready (has required param)')
  assert.ok(needsArgs.find(n => n.recipe === 'incident-context'),
    'incident-context should be in needsArgs')
  for (const b of blocked) {
    assert.ok(Array.isArray(b.missing) && b.missing.length > 0,
      `${b.recipe}: blocked entries must list missing extensions`)
  }
})

test('partition invariant: ready ∪ needsArgs ∪ blocked = all recipes, no duplicates', () => {
  const { ready, needsArgs, blocked } = categorizeRecipes([])
  const all = [...ready, ...needsArgs.map(n => n.recipe), ...blocked.map(b => b.recipe)].sort()
  assert.deepEqual(all, [...ALL_RECIPES].sort(),
    'every recipe must appear exactly once across ready/needsArgs/blocked')
  assert.equal(new Set(all).size, all.length, 'no duplicates across categories')
})

test('categorizeRecipes: only developer enabled → MCP-needing recipes blocked', () => {
  const { ready, needsArgs, blocked } = categorizeRecipes(['developer'])
  assert.ok(ready.includes('hello'))
  assert.ok(needsArgs.find(n => n.recipe === 'incident-context'))
  const linearTriage = blocked.find(b => b.recipe === 'linear-triage')
  assert.ok(linearTriage, 'linear-triage must be blocked when only developer is enabled')
  assert.deepEqual(linearTriage.missing, ['linear'])
})

test('categorizeRecipes: linear enabled → linear-triage in ready, meeting-prep still blocked', () => {
  const { ready, blocked } = categorizeRecipes(['developer', 'linear'])
  assert.ok(ready.includes('linear-triage'))
  // meeting-prep needs gsuite + linear MCPs, so still blocked.
  const meetingPrep = blocked.find(b => b.recipe === 'meeting-prep')
  assert.ok(meetingPrep, 'meeting-prep still blocked (needs gsuite)')
  assert.deepEqual(meetingPrep.missing, ['gsuite'])
})

test('categorizeRecipes: every required MCP enabled → 0 blocked, meeting-prep + incident-context in needsArgs', () => {
  const everything = ['developer', ...new Set(Object.values(RECIPE_REQUIREMENTS).flat())]
  const { ready, needsArgs, blocked } = categorizeRecipes(everything)
  assert.equal(blocked.length, 0)
  assert.ok(needsArgs.find(n => n.recipe === 'meeting-prep'))
  assert.ok(needsArgs.find(n => n.recipe === 'incident-context'))
  for (const r of ['hello', 'morning-brief', 'eod-wrap', 'pr-describe', 'linear-triage']) {
    assert.ok(ready.includes(r), `${r} should be ready`)
  }
})

test('needsArgs entries list required param keys', () => {
  const { needsArgs } = categorizeRecipes([])
  const ic = needsArgs.find(n => n.recipe === 'incident-context')
  assert.deepEqual(ic.params, ['alert'])
})

test('every bundled recipe is documented in RECIPE_REQUIREMENTS (bidirectional)', async () => {
  const { readdir } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const recipesDir = join(__dirname, '..', 'recipes')
  const recipeNames = (await readdir(recipesDir))
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace('.yaml', ''))
    .sort()
  const mapped = [...ALL_RECIPES].sort()
  assert.deepEqual(mapped, recipeNames,
    `RECIPE_REQUIREMENTS must match /recipes/ exactly. ` +
    `In recipes but not map: ${recipeNames.filter(n => !mapped.includes(n))}. ` +
    `In map but not recipes: ${mapped.filter(n => !recipeNames.includes(n))}.`)
})

test('REQUIRED_PARAMS keys match RECIPE_REQUIREMENTS keys', () => {
  assert.deepEqual(
    Object.keys(REQUIRED_PARAMS).sort(),
    Object.keys(RECIPE_REQUIREMENTS).sort(),
    'REQUIRED_PARAMS map must list every recipe (use [] for none)',
  )
})

test('REQUIRED_PARAMS reflects actual recipe YAML required params (drift guard)', async () => {
  // If someone adds/removes a required param in a recipe and forgets the map,
  // categorizeRecipes silently lies. This test catches that.
  const { readFile, readdir } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const YAML = (await import('yaml')).default
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const recipesDir = join(__dirname, '..', 'recipes')
  const files = (await readdir(recipesDir)).filter(f => f.endsWith('.yaml'))
  for (const file of files) {
    const r = YAML.parse(await readFile(join(recipesDir, file), 'utf8'))
    const name = file.replace('.yaml', '')
    const actual = (r.parameters || [])
      .filter(p => p.requirement === 'required')
      .map(p => p.key)
      .sort()
    const declared = [...(REQUIRED_PARAMS[name] || [])].sort()
    assert.deepEqual(declared, actual,
      `${name}: REQUIRED_PARAMS=${JSON.stringify(declared)} but YAML has ${JSON.stringify(actual)}`)
  }
})

test('hello has zero requirements and zero required params', () => {
  assert.deepEqual(RECIPE_REQUIREMENTS.hello, [])
  assert.deepEqual(REQUIRED_PARAMS.hello, [])
})
