import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { NodeStepDefinition } from '../src/model.ts'
import { defaultNodeStepDefinitions } from '../src/nodeSteps.ts'

export type MuxMapConfig = {
  nodeStepDefinitions: NodeStepDefinition[]
  source?: string
}

type ConfigEnv = {
  MUXMAP_CONFIG?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function configCandidates(env: ConfigEnv, cwd: string) {
  if (env.MUXMAP_CONFIG?.trim()) {
    const configured = env.MUXMAP_CONFIG.trim()
    return [isAbsolute(configured) ? configured : resolve(cwd, configured)]
  }
  return [
    resolve(cwd, 'muxmap.config.json'),
    resolve(cwd, 'config/muxmap.config.json'),
  ]
}

export function validateNodeStepDefinitions(value: unknown): { definitions?: NodeStepDefinition[]; errors: string[] } {
  if (value === undefined) return { definitions: defaultNodeStepDefinitions, errors: [] }
  if (!Array.isArray(value)) return { errors: ['nodeSteps must be an array.'] }
  if (value.length === 0) return { errors: ['nodeSteps must contain at least one step.'] }
  if (value.length > 8) return { errors: ['nodeSteps can contain at most 8 steps.'] }

  const seen = new Set<string>()
  const definitions: NodeStepDefinition[] = []
  const errors: string[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`nodeSteps[${index}] must be an object.`)
      continue
    }
    const unknown = Object.keys(item).filter((key) => !['key', 'label', 'description'].includes(key))
    if (unknown.length) errors.push(`nodeSteps[${index}] has unknown fields: ${unknown.join(', ')}.`)
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : undefined
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(key)) errors.push(`nodeSteps[${index}].key must be 1-64 letters, numbers, "_" or "-".`)
    if (seen.has(key)) errors.push(`nodeSteps[${index}].key duplicates ${key}.`)
    if (!label || label.length > 40) errors.push(`nodeSteps[${index}].label must be 1-40 characters.`)
    if (description && description.length > 160) errors.push(`nodeSteps[${index}].description must be 160 characters or fewer.`)
    if (key) seen.add(key)
    if (key && label) definitions.push({ key, label, ...(description ? { description } : {}) })
  }
  return errors.length ? { errors } : { definitions, errors: [] }
}

export function loadMuxMapConfig(env: ConfigEnv = process.env, cwd = process.cwd()): MuxMapConfig {
  for (const path of configCandidates(env, cwd)) {
    if (!existsSync(path)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`Invalid MuxMap config ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isRecord(parsed)) throw new Error(`Invalid MuxMap config ${path}: root must be an object.`)
    const nodeSteps = parsed.nodeSteps ?? parsed.lifecycleSteps
    const result = validateNodeStepDefinitions(nodeSteps)
    if (result.errors.length || !result.definitions) throw new Error(`Invalid MuxMap config ${path}: ${result.errors.join(' ')}`)
    return { nodeStepDefinitions: result.definitions, source: path }
  }
  return { nodeStepDefinitions: defaultNodeStepDefinitions }
}

export function defaultMuxMapConfigJson() {
  return `${JSON.stringify({ nodeSteps: defaultNodeStepDefinitions }, null, 2)}\n`
}
