import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AgentActivity, AgentKind } from '../src/model.ts'

export type ProcessInfo = { pid: number; ppid: number; command: string }
export type AgentTranscriptFs = {
  readdirSync: (dir: string) => string[]
  statSync: (file: string) => { mtimeMs: number }
}

const realTranscriptFs: AgentTranscriptFs = { readdirSync, statSync }
const TEAMMATE_STALE_MS = 30 * 60 * 1000

export function readProcesses(): ProcessInfo[] {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return parseProcessList(result.stdout)
}

function spawnText(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', () => resolve({ status: 1, stdout, stderr }))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

export async function readProcessesAsync(): Promise<ProcessInfo[]> {
  const result = await spawnText('ps', ['-axo', 'pid=,ppid=,command='])
  if (result.status !== 0) return []
  return parseProcessList(result.stdout)
}

function parseProcessList(output: string): ProcessInfo[] {
  return output.split('\n').flatMap((line) => {
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

export function detectMuxMapHost(panePid: number, processes: ProcessInfo[]) {
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
  return processes.some((process) => {
    if (!descendants.has(process.pid)) return false
    const command = process.command.toLowerCase()
    return /\b(server\/index\.ts|server\/app\.ts|server\/index\.js|server\/app\.js|scripts\/dev\.mjs)\b/.test(command)
      || /\bmuxmap\b/.test(command) && /\b(vite|server\/index|server\/app|scripts\/dev)\b/.test(command)
  })
}

function asksForInput(message: unknown) {
  if (typeof message !== 'string') return false
  return /[?？]\s*$/.test(message.trim()) || /\b(need|requires?|waiting for) (your|user) (input|answer|approval|decision)\b/i.test(message)
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function arrayField(input: Record<string, unknown>, keys: string[]) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : undefined
  for (const key of keys) {
    const value = input[key]
    if (Array.isArray(value)) return value
  }
  if (payload) {
    for (const key of keys) {
      const value = payload[key]
      if (Array.isArray(value)) return value
    }
  }
  return []
}

function taskDescription(task: unknown) {
  if (!task || typeof task !== 'object') return undefined
  const record = task as Record<string, unknown>
  const value = record.description ?? record.task_subject ?? record.subject ?? record.name ?? record.id
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, 200) : undefined
}

function taskType(task: unknown) {
  if (!task || typeof task !== 'object') return undefined
  const value = (task as Record<string, unknown>).type
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
}

function isMonitorTask(task: unknown) {
  return taskType(task) === 'monitor'
}

function isTeammateTask(task: unknown) {
  const type = taskType(task)
  return !type || ['agent', 'background_task', 'subagent', 'task', 'teammate'].includes(type)
}

function transcriptPathFromEvent(input: Record<string, unknown>) {
  return eventField(input, ['transcript_path', 'transcriptPath', 'agent_transcript_path', 'agentTranscriptPath'])
}

function subagentTranscriptDir(transcriptPath: string) {
  const parsed = path.parse(transcriptPath)
  const sessionId = parsed.name
  if (!sessionId) return undefined
  return path.join(parsed.dir, sessionId, 'subagents')
}

function hasFreshSubagentTranscript(input: Record<string, unknown>, nowMs: number, fs: AgentTranscriptFs) {
  const transcriptPath = transcriptPathFromEvent(input)
  const dir = transcriptPath ? subagentTranscriptDir(transcriptPath) : undefined
  if (!dir) return undefined
  try {
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(dir, file))
        if (nowMs - stat.mtimeMs <= TEAMMATE_STALE_MS) return true
      } catch {
        // A transcript can disappear while Claude is rotating/writing files.
      }
    }
    return false
  } catch {
    return undefined
  }
}

function claudeStopBackgroundState(input: Record<string, unknown>, nowMs: number, fs: AgentTranscriptFs): Pick<AgentActivity, 'state' | 'standbyReason' | 'staleTeammate'> | undefined {
  const backgroundTasks = arrayField(input, ['background_tasks', 'backgroundTasks'])
  const sessionCrons = arrayField(input, ['session_crons', 'sessionCrons'])
  if (hasItems(sessionCrons)) return { state: 'delegated' }
  if (!hasItems(backgroundTasks)) return undefined
  const nonMonitorTasks = backgroundTasks.filter((task) => !isMonitorTask(task))
  if (nonMonitorTasks.length > 0 && nonMonitorTasks.every(isTeammateTask)) {
    const live = hasFreshSubagentTranscript(input, nowMs, fs)
    if (live === false) return { state: 'completed', staleTeammate: true }
    return { state: 'delegated' }
  }
  const onlyMonitors = nonMonitorTasks.length === 0
  if (!onlyMonitors) return { state: 'delegated' }
  return { state: 'standby', standbyReason: backgroundTasks.map(taskDescription).find(Boolean) }
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
  const messagingSocket = (muxmap ? stringField(muxmap, ['messaging_socket', 'messagingSocket']) : undefined)
    ?? stringField(input, ['messaging_socket', 'messagingSocket'])
  const messagingProtocol = messagingSocket ? 'claude-cross-session' as const : undefined
  return {
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(externalSessionPath ? { externalSessionPath } : {}),
    ...(externalCwd ? { externalCwd } : {}),
    ...(messagingProtocol ? { messagingProtocol } : {}),
    ...(messagingSocket ? { messagingSocket } : {}),
  }
}

export function agentActivityFromEvent(
  kind: Exclude<AgentKind, 'ssh'>,
  input: Record<string, unknown>,
  now = new Date().toISOString(),
  options: { fs?: AgentTranscriptFs } = {},
): AgentActivity | null {
  const event = eventField(input, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? ''
  const notification = eventField(input, ['notification_type', 'notificationType']) ?? ''
  let state: AgentActivity['state'] | undefined
  if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'before_agent_start' || event === 'agent_start' || event === 'SubagentStart' || event === 'TaskCreated') state = 'working'
  if (event === 'Stop' || event === 'StopFailure' || event === 'agent_end' || notification === 'agent_completed') state = 'completed'
  if (event === 'Notification' && notification === 'idle_prompt') state = 'completed'
  const claudeStopBackground = kind === 'claude' && event === 'Stop' ? claudeStopBackgroundState(input, Date.parse(now), options.fs ?? realTranscriptFs) : undefined
  if (claudeStopBackground) state = claudeStopBackground.state
  if (event === 'PermissionRequest' || (event === 'Notification' && /permission_prompt|agent_needs_input|elicitation_dialog|elicitation_url_dialog/.test(notification))) state = 'needs_input'
  if (event === 'Stop' && asksForInput(input.last_assistant_message)) state = 'needs_input'
  if (!state && event === 'SessionStart') state = 'read'
  if (!state) return null
  return { kind, state, since: now, ...(claudeStopBackground?.standbyReason ? { standbyReason: claudeStopBackground.standbyReason } : {}), ...(claudeStopBackground?.staleTeammate ? { staleTeammate: true } : {}), ...agentSessionInfoFromEvent(input) }
}

export function shouldPreserveAgentState(current: AgentActivity | undefined, event: Record<string, unknown>, next: AgentActivity | null) {
  const eventName = eventField(event, ['hook_event_name', 'hookEventName', 'event', 'type']) ?? ''
  const notification = eventField(event, ['notification_type', 'notificationType']) ?? ''
  if (!next) return true
  if (eventName === 'Notification' && notification === 'idle_prompt' && current && ['delegated', 'standby', 'needs_input', 'completed', 'read'].includes(current.state)) return true
  if (next.state !== 'working') return false
  if (!current || !['completed', 'read', 'needs_input', 'delegated', 'standby'].includes(current.state)) return false
  return ['SubagentStop', 'TaskCompleted'].includes(eventName)
}

function mergeActivity(current: AgentActivity | undefined, next: AgentActivity) {
  return {
    ...current,
    ...next,
    externalSessionId: next.externalSessionId ?? current?.externalSessionId,
    externalSessionPath: next.externalSessionPath ?? current?.externalSessionPath,
    externalCwd: next.externalCwd ?? current?.externalCwd,
    standbyReason: next.standbyReason ?? current?.standbyReason,
    staleTeammate: next.staleTeammate ? true : undefined,
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
  const manualState = event === 'manual_status' && ['working', 'completed', 'read', 'delegated', 'standby'].includes(recordedState) ? recordedState : undefined
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
