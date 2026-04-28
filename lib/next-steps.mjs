import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import YAML from 'yaml'
import { PATHS } from './env.mjs'

/**
 * Minimal MCP-server requirements per recipe.
 *
 * "Required" here means: without this extension, the recipe cannot produce a
 * meaningful result. Tools that the recipe degrades gracefully on (e.g.
 * "(tool unavailable)" branches, optional params) are NOT listed.
 *
 * The `developer` builtin is always available and is not listed.
 *
 * Keep this map in sync with /recipes/*.yaml — the tests enforce this.
 */
export const RECIPE_REQUIREMENTS = Object.freeze({
  hello: [],
  'morning-brief': ['gsuite', 'linear'],
  'meeting-prep': ['gsuite', 'linear'],
  'eod-wrap': ['linear', 'gsuite'],
  'pr-describe': ['linear'],
  'incident-context': [],
  'linear-triage': ['linear'],
})

/**
 * Recipes that have at least one `requirement: required` parameter.
 * Listed here so we can flag them as "needs args" rather than "ready" — a
 * recipe with required params can't be run as `agentmesh run <recipe>` with
 * no extra arguments.
 *
 * Keep in sync with /recipes/*.yaml. Tests verify this.
 */
export const REQUIRED_PARAMS = Object.freeze({
  hello: [],
  'morning-brief': [],
  'meeting-prep': ['event'],
  'eod-wrap': [],
  'pr-describe': [],
  'incident-context': ['alert'],
  'linear-triage': [],
})

/**
 * Pure: split recipes into three buckets.
 *   - ready      — all required MCPs enabled, no required params; runnable now.
 *   - needsArgs  — MCPs all enabled, but the recipe has required params.
 *   - blocked    — at least one required MCP not enabled.
 * `blocked` lists missing MCPs; `needsArgs` lists required param keys.
 */
export function categorizeRecipes(enabled) {
  const have = new Set(enabled)
  const ready = []
  const needsArgs = []
  const blocked = []
  for (const recipe of Object.keys(RECIPE_REQUIREMENTS)) {
    const requires = RECIPE_REQUIREMENTS[recipe]
    const missing = requires.filter(r => !have.has(r))
    if (missing.length > 0) {
      blocked.push({ recipe, missing })
      continue
    }
    const params = REQUIRED_PARAMS[recipe] || []
    if (params.length > 0) {
      needsArgs.push({ recipe, params })
      continue
    }
    ready.push(recipe)
  }
  return { ready, needsArgs, blocked }
}

/**
 * Read the user's Goose config and return the names of enabled extensions.
 * Returns [] on parse error or missing file (so the caller renders "nothing
 * enabled" rather than crashing).
 */
export async function loadEnabledExtensions(configPath = PATHS.gooseConfig) {
  if (!existsSync(configPath)) return []
  try {
    const text = await readFile(configPath, 'utf8')
    const parsed = YAML.parse(text) ?? {}
    const exts = parsed.extensions ?? {}
    return Object.entries(exts)
      .filter(([_, v]) => v && v.enabled !== false)
      .map(([k]) => k)
  } catch {
    return []
  }
}
