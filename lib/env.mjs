import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export const HOME = homedir()
export const PLATFORM = platform()

export const PATHS = {
  agentmeshDir: join(HOME, '.config', 'agentmesh'),
  agentmeshRecipes: join(HOME, '.config', 'agentmesh', 'recipes'),
  agentmeshEnv: join(HOME, '.config', 'agentmesh', '.env'),
  gooseDir: join(HOME, '.config', 'goose'),
  gooseConfig: join(HOME, '.config', 'goose', 'config.yaml'),
}

export function loadDotEnv(path = PATHS.agentmeshEnv) {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

/**
 * Merge layers under a fixed precedence:
 *   shell env (process.env) > each layer in order, last layer winning.
 * In other words: process.env always wins (matches Goose's documented behaviour
 * where shell env has highest precedence). Layers are typically the loaded
 * dotenv file. This keeps shell overrides honored and makes .env a default-only
 * fallback.
 */
export function mergeEnv(...layers) {
  const merged = {}
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined && v !== '') merged[k] = v
    }
  }
  // Shell env wins last → highest precedence
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') merged[k] = v
  }
  return merged
}
