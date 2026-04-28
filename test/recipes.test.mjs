/**
 * Unit tests for lib/recipes.mjs argument translation. Pure function only —
 * the spawn/runRecipe is exercised by integration tests + the live CLI.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateRecipeArgs } from '../lib/recipes.mjs'

test('translateRecipeArgs: --key value form → --params key=value', () => {
  const out = translateRecipeArgs(['--pr', '803'])
  assert.deepEqual(out, ['--params', 'pr=803'])
})

test('translateRecipeArgs: --key=value form → --params key=value', () => {
  const out = translateRecipeArgs(['--pr=803'])
  assert.deepEqual(out, ['--params', 'pr=803'])
})

test('translateRecipeArgs: explicit --params is untouched', () => {
  const out = translateRecipeArgs(['--params', 'pr=803'])
  assert.deepEqual(out, ['--params', 'pr=803'])
})

test('translateRecipeArgs: multiple recipe params → multiple --params', () => {
  const out = translateRecipeArgs(['--pr', '803', '--repo=foo/bar', '--include_blocked', 'true'])
  assert.deepEqual(out, [
    '--params', 'pr=803',
    '--params', 'repo=foo/bar',
    '--params', 'include_blocked=true',
  ])
})

test('translateRecipeArgs: known goose flags pass through unchanged', () => {
  const out = translateRecipeArgs(['--explain'])
  assert.deepEqual(out, ['--explain'])

  const out2 = translateRecipeArgs(['--system', 'be terse', '--pr', '803'])
  // --system is a goose flag with value; --pr is a recipe param.
  assert.deepEqual(out2, ['--system', 'be terse', '--params', 'pr=803'])
})

test('translateRecipeArgs: bare flag without value passes through', () => {
  const out = translateRecipeArgs(['--explain', '--render-recipe'])
  assert.deepEqual(out, ['--explain', '--render-recipe'])
})

test('translateRecipeArgs: positional args pass through', () => {
  const out = translateRecipeArgs(['--pr', '803', 'extra-positional'])
  assert.deepEqual(out, ['--params', 'pr=803', 'extra-positional'])
})

test('translateRecipeArgs: empty input → empty output', () => {
  assert.deepEqual(translateRecipeArgs([]), [])
})

test('translateRecipeArgs: value containing equals sign is preserved', () => {
  const out = translateRecipeArgs(['--query=foo=bar=baz'])
  assert.deepEqual(out, ['--params', 'query=foo=bar=baz'])
})

test('translateRecipeArgs: numeric-looking value is preserved as string', () => {
  // Goose accepts the value; we shouldn't try to parse types.
  const out = translateRecipeArgs(['--hours', '12'])
  assert.deepEqual(out, ['--params', 'hours=12'])
})
