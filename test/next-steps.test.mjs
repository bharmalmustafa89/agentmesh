/**
 * Unit tests for lib/next-steps.mjs. Pure functions only.
 *
 * Semantics under test:
 *   "ready"   = all minimally-required MCP servers for the recipe are enabled
 *   "blocked" = at least one required MCP server is missing
 * Recipes that gracefully degrade (e.g. "(tool unavailable)" branches in their
 * instructions) should NOT have those soft tools listed in requirements — only
 * the integrations the recipe genuinely depends on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categorizeRecipes, RECIPE_REQUIREMENTS } from '../lib/next-steps.mjs'

const ALL_RECIPES = Object.keys(RECIPE_REQUIREMENTS)

test('categorizeRecipes: nothing enabled → only zero-config recipes are ready', () => {
  const { ready, blocked } = categorizeRecipes([])
  assert.ok(ready.includes('hello'), 'hello must be ready with no extensions')
  for (const b of blocked) {
    assert.ok(b.recipe, 'blocked entry has a recipe name')
    assert.ok(Array.isArray(b.missing) && b.missing.length > 0,
      `${b.recipe}: blocked entries should list missing extensions`)
  }
})

test('partition invariant: ready ∪ blocked = all known recipes; no duplicates', () => {
  const { ready, blocked } = categorizeRecipes([])
  const blockedNames = blocked.map(b => b.recipe)
  const all = [...ready, ...blockedNames].sort()
  assert.deepEqual(all, [...ALL_RECIPES].sort(),
    'every recipe in RECIPE_REQUIREMENTS must appear exactly once in ready or blocked')
  assert.equal(new Set(all).size, all.length, 'no duplicates between ready and blocked')
})

test('categorizeRecipes: only developer enabled → hello still ready, MCP-needing recipes still blocked', () => {
  // The `developer` builtin is implicit — recipe requirements are over MCP servers, not built-ins.
  const { ready, blocked } = categorizeRecipes(['developer'])
  assert.ok(ready.includes('hello'))
  const linearTriage = blocked.find(b => b.recipe === 'linear-triage')
  assert.ok(linearTriage, 'linear-triage must be blocked when only developer is enabled')
  assert.deepEqual(linearTriage.missing, ['linear'],
    `linear-triage should miss exactly ["linear"], got ${JSON.stringify(linearTriage.missing)}`)
})

test('categorizeRecipes: linear enabled → linear-triage joins ready with no missing', () => {
  const { ready, blocked } = categorizeRecipes(['developer', 'linear'])
  assert.ok(ready.includes('hello'))
  assert.ok(ready.includes('linear-triage'),
    `linear-triage should be ready when linear is enabled; ready=${JSON.stringify(ready)}`)
  const morning = blocked.find(b => b.recipe === 'morning-brief')
  assert.ok(morning, 'morning-brief should still be blocked (needs gsuite too)')
  assert.ok(!morning.missing.includes('linear'),
    'morning-brief should no longer list linear as missing')
})

test('categorizeRecipes: every required extension enabled → everything ready, nothing blocked', () => {
  // Union of all required extensions across recipes.
  const everything = ['developer', ...new Set(Object.values(RECIPE_REQUIREMENTS).flat())]
  const { ready, blocked } = categorizeRecipes(everything)
  assert.equal(blocked.length, 0,
    `nothing should be blocked when all required enabled, got: ${JSON.stringify(blocked)}`)
  for (const r of ALL_RECIPES) {
    assert.ok(ready.includes(r), `${r} should be ready; ready=${JSON.stringify(ready)}`)
  }
})

test('every bundled recipe in /recipes is documented in RECIPE_REQUIREMENTS (and vice versa)', async () => {
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
    `RECIPE_REQUIREMENTS map must match /recipes/ exactly. ` +
    `In recipes but not map: ${recipeNames.filter(n => !mapped.includes(n))}. ` +
    `In map but not recipes: ${mapped.filter(n => !recipeNames.includes(n))}.`)
})

test('hello has no requirements (zero-config invariant)', () => {
  assert.deepEqual(RECIPE_REQUIREMENTS.hello, [],
    'hello must have no requirements — that is its whole point')
})
