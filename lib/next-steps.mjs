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
  // morning-brief needs email (gsuite) for inbox triage and Linear for issue lookups.
  // PRs awaiting review can use the `gh` CLI via the developer extension; github MCP optional.
  'morning-brief': ['gsuite', 'linear'],
  // meeting-prep needs calendar (gsuite) and Linear; Slack threads + Notion docs are bonuses.
  'meeting-prep': ['gsuite', 'linear'],
  // eod-wrap needs Linear status changes + calendar (gsuite). Git via developer; gh via shell.
  'eod-wrap': ['linear', 'gsuite'],
  // pr-describe uses `gh pr diff` (shell) and Linear for the issue link.
  'pr-describe': ['linear'],
  // incident-context is intentionally tool-agnostic — degrades to git+shell signals.
  'incident-context': [],
  // linear-triage is single-purpose.
  'linear-triage': ['linear'],
})

/**
 * Pure: split recipes into "ready" (all requirements satisfied by `enabled`)
 * and "blocked" (with the missing extensions named).
 */
export function categorizeRecipes(enabled) {
  const have = new Set(enabled)
  const ready = []
  const blocked = []
  for (const [recipe, requires] of Object.entries(RECIPE_REQUIREMENTS)) {
    const missing = requires.filter(r => !have.has(r))
    if (missing.length === 0) ready.push(recipe)
    else blocked.push({ recipe, missing })
  }
  return { ready, blocked }
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
