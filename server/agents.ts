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

function stringField(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

export function agentSessionInfoFromEvent(input: Record<string, unknown>) {
  const muxmap = input.muxmap && typeof input.muxmap === 'object' ? input.muxmap as Record<string, unknown> : undefined
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : undefined
  const externalSessionId = stringField(input, ['session_id', 'sessionId', 'conversation_id'])
    ?? (muxmap ? stringField(muxmap, ['session_id', 'sessionId', 'codexSessionId', 'externalSessionId']) : undefined)
    ?? (payload ? stringField(payload, ['session_id', 'sessionId', 'id']) : undefined)
  const externalSessionPath = (muxmap ? stringField(muxmap, ['session_path', 'sessionPath', 'codexSessionPath', 'externalSessionPath']) : undefined)
    ?? stringField(input, ['session_path', 'sessionPath'])
  const externalCwd = (muxmap ? stringField(muxmap, ['cwd', 'externalCwd']) : undefined)
    ?? stringField(input, ['cwd'])
  return {
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(externalSessionPath ? { externalSessionPath } : {}),
    ...(externalCwd ? { externalCwd } : {}),
  }
}

export function agentActivityFromEvent(kind: Exclude<AgentKind, 'ssh'>, input: Record<string, unknown>, now = new Date().toISOString()): AgentActivity {
  const event = String(input.hook_event_name ?? input.type ?? '')
  const notification = String(input.notification_type ?? '')
  let state: AgentActivity['state'] = 'read'
  if (event === 'UserPromptSubmit' || event === 'before_agent_start' || event === 'agent_start') state = 'working'
  if (event === 'Stop' || event === 'agent_end') state = 'completed'
  if (event === 'PermissionRequest' || (event === 'Notification' && /permission_prompt|idle_prompt|agent_needs_input/.test(notification))) state = 'needs_input'
  if (event === 'Stop' && asksForInput(input.last_assistant_message)) state = 'needs_input'
  return { kind, state, since: now, ...agentSessionInfoFromEvent(input) }
}

export function addCommandHooks(config: Record<string, unknown>, events: string[], command: string) {
  const next = structuredClone(config)
  const hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks as Record<string, unknown> : {}
  next.hooks = hooks
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : []
    const exists = groups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => (
      hook && typeof hook === 'object' && (hook as Record<string, unknown>).command === command
    )))
    if (!exists) groups.push({ hooks: [{ type: 'command', command, timeout: 3 }] })
    hooks[event] = groups
  }
  return next
}
