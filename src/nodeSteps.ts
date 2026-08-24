import type { NodeLifecycleStep, NodeStepKey, NodeStepStatus } from './model.ts'

export const nodeLifecycleStepDefinitions: Array<{ key: NodeStepKey; label: string }> = [
  { key: 'initialized', label: 'Initialized' },
  { key: 'ticket_created', label: 'Jira created' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'mr_raised', label: 'MR raised' },
  { key: 'finalized', label: 'Finalized' },
]

export const nodeLifecycleStepKeys = nodeLifecycleStepDefinitions.map((step) => step.key)

export type NodeStepperItem = NodeLifecycleStep & {
  tone: 'done' | 'current' | 'pending'
}

function isStepKey(value: unknown): value is NodeStepKey {
  return typeof value === 'string' && nodeLifecycleStepKeys.includes(value as NodeStepKey)
}

function isStepStatus(value: unknown): value is NodeStepStatus {
  return value === 'pending' || value === 'done'
}

export function normalizedNodeSteps(rows: unknown): NodeLifecycleStep[] {
  const input = Array.isArray(rows) ? rows : []
  const byKey = new Map<NodeStepKey, Partial<NodeLifecycleStep>>()
  for (const row of input) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const item = row as Record<string, unknown>
    if (!isStepKey(item.key) || !isStepStatus(item.status)) continue
    byKey.set(item.key, {
      key: item.key,
      status: item.status,
      ref: typeof item.ref === 'string' && item.ref ? item.ref : undefined,
      url: typeof item.url === 'string' && item.url ? item.url : undefined,
      note: typeof item.note === 'string' && item.note ? item.note : undefined,
      updatedAt: typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : undefined,
      updatedBy: typeof item.updatedBy === 'string' && item.updatedBy ? item.updatedBy : undefined,
    })
  }
  const noRows = byKey.size === 0
  return nodeLifecycleStepDefinitions.map((definition) => {
    const row = byKey.get(definition.key)
    return {
      key: definition.key,
      label: definition.label,
      status: row?.status ?? (noRows && definition.key === 'initialized' ? 'done' : 'pending'),
      ref: row?.ref,
      url: row?.url,
      note: row?.note,
      updatedAt: row?.updatedAt,
      updatedBy: row?.updatedBy,
    }
  })
}

export function nodeStepperModel(rows: unknown): NodeStepperItem[] {
  const steps = normalizedNodeSteps(rows)
  const lastDoneIndex = steps.reduce((last, step, index) => step.status === 'done' ? index : last, -1)
  const currentIndex = steps.findIndex((step, index) => step.status === 'pending' && index > lastDoneIndex)
  const fallbackCurrentIndex = steps.findIndex((step) => step.status === 'pending')
  const highlightedIndex = currentIndex >= 0 ? currentIndex : fallbackCurrentIndex
  return steps.map((step, index) => ({
    ...step,
    tone: step.status === 'done' ? 'done' : index === highlightedIndex ? 'current' : 'pending',
  }))
}

export function nodeStepSummary(rows: unknown) {
  const steps = normalizedNodeSteps(rows)
  const model = nodeStepperModel(steps)
  const current = model.find((step) => step.tone === 'current') ?? model.at(-1)!
  return {
    dots: steps.map((step) => step.status === 'done' ? '●' : '○').join(''),
    label: current.label,
    completed: steps.filter((step) => step.status === 'done').length,
    total: steps.length,
  }
}
