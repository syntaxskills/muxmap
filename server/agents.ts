import { spawnSync } from 'node:child_process'
import type { AgentActivity, AgentKind } from '../src/model.ts'

export type ProcessInfo = { pid: number; ppid: number; command: string }

export function readProcesses(): ProcessInfo[] {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
  })
}

export function detectAgentKind(panePid: number, processes: ProcessInfo[]): AgentKind | undefined {
  const descendants = new Set([panePid])
  let changed = true
  while (changed) {
    changed = false
    for (const process of processes) {
      if (descendants.has(process.ppid) && !descendants.has(process.pid)) {
        descendants.add(process.pid)
        changed = true
      }
    }
  }
  const targets = processes.filter((process) => descendants.has(process.pid)).flatMap((process) => {
    const tokens = process.command.trim().split(/\s+/)
    const executable = tokens[0]?.split('/').pop()?.toLowerCase()
    if (!executable) return []
    if (['node', 'bun', 'deno'].includes(executable)) {
      const script = tokens.slice(1).find((token) => !token.startsWith('-'))
      return script ? [executable, script.toLowerCase()] : [executable]
    }
    return [executable]
  })
  if (targets.some((target) => target.split('/').pop() === 'codex' || target.includes('@openai/codex'))) return 'codex'
  if (targets.some((target) => target.split('/').pop() === 'claude' || target.includes('@anthropic-ai/claude-code'))) return 'claude'
  if (targets.some((target) => target.split('/').pop() === 'pi' || target.includes('pi-coding-agent'))) return 'pi'
  if (targets.some((target) => target.split('/').pop() === 'ssh')) return 'ssh'
}

function asksForInput(message: unknown) {
  if (typeof message !== 'string') return false
  return /[?？]\s*$/.test(message.trim()) || /\b(need|requires?|waiting for) (your|user) (input|answer|approval|decision)\b/i.test(message)
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function hasActiveDelegatedWork(input: Record<string, unknown>) {
  if (hasItems(input.background_tasks) || hasItems(input.session_crons)) return true
  if (['SubagentStart', 'TaskCreated'].includes(eventField(input, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? '')) return true
  return false
}

function stringField(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

function eventField(input: Record<string, unknown>, keys: string[]) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : undefined
  return stringField(input, keys) ?? (payload ? stringField(payload, keys) : undefined)
}

export function agentSessionInfoFromEvent(input: Record<string, unknown>) {
  const muxmap = input.muxmap && typeof input.muxmap === 'object' ? input.muxmap as Record<string, unknown> : undefined
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : undefined
  const externalSessionId = stringField(input, ['session_id', 'sessionId', 'conversation_id'])
    ?? (muxmap ? stringField(muxmap, ['session_id', 'sessionId', 'codexSessionId', 'externalSessionId']) : undefined)
    ?? (payload ? stringField(payload, ['session_id', 'sessionId', 'id']) : undefined)
  const externalSessionPath = (muxmap ? stringField(muxmap, ['session_path', 'sessionPath', 'codexSessionPath', 'externalSessionPath']) : undefined)
    ?? stringField(input, ['session_path', 'sessionPath', 'transcript_path', 'agent_transcript_path'])
  const externalCwd = (muxmap ? stringField(muxmap, ['cwd', 'externalCwd']) : undefined)
    ?? stringField(input, ['cwd'])
  return {
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(externalSessionPath ? { externalSessionPath } : {}),
    ...(externalCwd ? { externalCwd } : {}),
  }
}

export function agentActivityFromEvent(kind: Exclude<AgentKind, 'ssh'>, input: Record<string, unknown>, now = new Date().toISOString()): AgentActivity | null {
  const event = eventField(input, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? ''
  const notification = eventField(input, ['notification_type', 'notificationType']) ?? ''
  let state: AgentActivity['state'] | undefined
  if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'before_agent_start' || event === 'agent_start' || event === 'SubagentStart' || event === 'TaskCreated') state = 'working'
  if (event === 'Stop' || event === 'StopFailure' || event === 'agent_end' || notification === 'agent_completed') state = 'completed'
  if (kind === 'claude' && event === 'Stop' && hasActiveDelegatedWork(input)) state = 'delegated'
  if (event === 'PermissionRequest' || (event === 'Notification' && /permission_prompt|agent_needs_input|elicitation_dialog|elicitation_url_dialog/.test(notification))) state = 'needs_input'
  if (event === 'Stop' && asksForInput(input.last_assistant_message)) state = 'needs_input'
  if (!state && event === 'SessionStart') state = 'read'
  if (!state) return null
  return { kind, state, since: now, ...agentSessionInfoFromEvent(input) }
}

export function shouldPreserveAgentState(current: AgentActivity | undefined, event: Record<string, unknown>, next: AgentActivity | null) {
  const eventName = eventField(event, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? ''
  if (!next) return true
  if (next.state !== 'working') return false
  if (!current || !['completed', 'read', 'needs_input', 'delegated'].includes(current.state)) return false
  return ['SubagentStop', 'TaskCompleted'].includes(eventName)
}

function mergeActivity(current: AgentActivity | undefined, next: AgentActivity) {
  return {
    ...current,
    ...next,
    externalSessionId: next.externalSessionId ?? current?.externalSessionId,
    externalSessionPath: next.externalSessionPath ?? current?.externalSessionPath,
    externalCwd: next.externalCwd ?? current?.externalCwd,
  }
}

export function agentActivityFromRecordedEvent(
  kind: Exclude<AgentKind, 'ssh'>,
  input: Record<string, unknown>,
  recordedState: AgentActivity['state'],
  createdAt: string,
  current?: AgentActivity,
) {
  const event = eventField(input, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? ''
  const manualState = event === 'manual_status' && ['working', 'completed', 'read', 'delegated'].includes(recordedState) ? recordedState : undefined
  const next = manualState
    ? { kind, state: manualState, since: manualState === 'read' ? current?.since ?? createdAt : createdAt, ...agentSessionInfoFromEvent(input) }
    : agentActivityFromEvent(kind, input, createdAt)
  if (shouldPreserveAgentState(current, input, next)) return current
  return next ? mergeActivity(current, next) : current
}

export function isMuxMapAgentHookCommand(command: unknown, kind: AgentKind) {
  return typeof command === 'string'
    && /(^|[/\\])agent-hook\.mjs["']?\s+/.test(command)
    && new RegExp(`\\b${kind}\\b`).test(command)
}

export function addCommandHooks(config: Record<string, unknown>, events: string[], command: string, kind?: AgentKind) {
  const next = structuredClone(config)
  const hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks as Record<string, unknown> : {}
  next.hooks = hooks
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : []
    const cleanGroups = kind ? groups.flatMap((group) => {
      if (!Array.isArray(group.hooks)) return [group]
      const cleanHooks = group.hooks.filter((hook) => (
        !hook || typeof hook !== 'object' || !isMuxMapAgentHookCommand((hook as Record<string, unknown>).command, kind)
      ))
      return cleanHooks.length > 0 ? [{ ...group, hooks: cleanHooks }] : []
    }) : groups
    const exists = cleanGroups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => (
      hook && typeof hook === 'object' && (hook as Record<string, unknown>).command === command
    )))
    if (!exists) cleanGroups.push({ hooks: [{ type: 'command', command, timeout: 3 }] })
    hooks[event] = cleanGroups
  }
  return next
}
