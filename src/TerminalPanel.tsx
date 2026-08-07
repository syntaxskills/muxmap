import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { NodeType, TerminalSession, TerminalStatus, WorkNode } from './model.ts'
import { NodeColorPicker } from './NodeColorPicker.tsx'
import { dragOffset, isTerminalMouseTracking, shouldCopyTerminalSelection, stopSessionIntent, terminalShortcutData } from './terminalInteraction.ts'
import { createTerminalLifecycle } from './terminalLifecycle.ts'
import { agentStatusText } from './agentStatus.ts'
import { AgentIcon } from './AgentIcon.tsx'
import {
  ChevronDownIcon,
  DrawingPinIcon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  Link2Icon,
  MinusIcon,
  OpenInNewWindowIcon,
  StopIcon,
} from '@radix-ui/react-icons'

type Props = {
  session: TerminalSession
  node: WorkNode
  opacity: number
  floating: boolean
  disabled: boolean
  onClose(): void
  onStop(): void
  onToggleFloating(): void
  onStatus(id: string, status: TerminalStatus): void
  onUpdate(changes: Partial<WorkNode>): void
}

const nodeTypes: Array<[NodeType, string]> = [
  ['workspace', 'Workspace'], ['repo', 'Repository'], ['feature', 'Feature'], ['ticket', 'Jira ticket'],
  ['note', 'Note'], ['todo', 'Todo'], ['terminal', 'Terminal task'],
]

export function TerminalPanel({ session, node, opacity, floating, disabled, onClose, onStop, onToggleFloating, onStatus, onUpdate }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; origin: { x: number; y: number }; start: { x: number; y: number } } | null>(null)
  const [status, setStatus] = useState<TerminalStatus>(session.status)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isFullscreen, setFullscreen] = useState(false)
  const [showNodeEditor, setShowNodeEditor] = useState(false)
  const [stopConfirming, setStopConfirming] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: { background: '#101311', foreground: '#d8ddd7', cursor: '#d49a4d', selectionBackground: '#4b3d29' },
    })
    const mouseTracking = terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, isTerminalMouseTracking)
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    fit.fit()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${session.id}/attach?cols=${terminal.cols}&rows=${terminal.rows}`)
    terminal.attachCustomKeyEventHandler((event) => {
      if (shouldCopyTerminalSelection(event, terminal.hasSelection())) {
        event.preventDefault()
        if (navigator.clipboard) void navigator.clipboard.writeText(terminal.getSelection()).catch(() => document.execCommand('copy'))
        else document.execCommand('copy')
        return false
      }
      const data = terminalShortcutData(event)
      if (!data) return true
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
      return false
    })
    const lifecycle = createTerminalLifecycle((nextStatus) => {
      setStatus(nextStatus)
      onStatus(session.id, nextStatus)
    })
    const sendResize = () => {
      try {
        fit.fit()
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      } catch {
        // The panel may be hidden during responsive layout changes.
      }
    }
    const resize = new ResizeObserver(sendResize)
    resize.observe(container.current)

    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    socket.addEventListener('open', () => {
      lifecycle.open()
      sendResize()
      terminal.focus()
    })
    socket.addEventListener('message', (event) => {
      if (lifecycle.disposed()) return
      const message = JSON.parse(String(event.data)) as { type: string; data?: string; status?: TerminalStatus; message?: string }
      if (message.type === 'output' && message.data) terminal.write(message.data)
      if (message.type === 'status' && message.status) {
        setStatus(message.status)
        onStatus(session.id, message.status)
      }
      if (message.type === 'error' && message.message) terminal.writeln(`\r\nMuxMap: ${message.message}`)
    })
    socket.addEventListener('close', () => lifecycle.close())
    socket.addEventListener('error', () => {
      if (!lifecycle.fail()) return
      terminal.writeln('\r\nMuxMap: session unavailable. Restart the terminal.')
    })

    return () => {
      lifecycle.dispose()
      resize.disconnect()
      input.dispose()
      mouseTracking.dispose()
      socket.close()
      terminal.dispose()
    }
  }, [onStatus, session.id])

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!floating || isFullscreen || event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea')) return
    drag.current = { pointerId: event.pointerId, origin: offset, start: { x: event.clientX, y: event.clientY } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    setOffset(dragOffset(drag.current.origin, drag.current.start, { x: event.clientX, y: event.clientY }))
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  function requestStop() {
    if (stopSessionIntent(stopConfirming) === 'confirm') return setStopConfirming(true)
    setStopConfirming(false)
    onStop()
  }

  const style = {
    '--terminal-drag-x': `${offset.x}px`,
    '--terminal-drag-y': `${offset.y}px`,
    '--accent': node.color,
    '--accent-soft': `color-mix(in srgb, ${node.color} 20%, transparent)`,
    opacity: opacity / 100,
  } as CSSProperties

  return (
    <section className={`terminal terminal-window ${floating ? 'is-floating' : 'is-docked'} ${isFullscreen ? 'is-fullscreen' : ''}`} role="dialog" aria-label={`Terminal for ${node.title}`} style={style}>
      <div className={`terminal-header ${showNodeEditor ? 'has-node-editor' : ''} ${stopConfirming ? 'has-stop-confirm' : ''}`} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <button className="terminal-title" type="button" onClick={() => setShowNodeEditor((value) => !value)} aria-expanded={showNodeEditor} title={[node.type, node.project, node.jiraKey, node.repoPath, node.note].filter(Boolean).join('\n')}><span className="terminal-node-link"><Link2Icon /> linked</span><strong>{node.title}</strong><span className="terminal-session-name">{session.tmuxName}</span><span className="terminal-details-hint">Details <ChevronDownIcon aria-hidden="true" /></span></button>
        <div className="terminal-actions">
          <span className={`runtime-state ${session.agent ? `is-${session.agent.state}` : `is-${status}`}`} title={session.agent ? 'Detected from this tmux pane' : `Terminal ${status}`}>{session.agent && <AgentIcon kind={session.agent.kind} />}{session.agent ? agentStatusText(session.agent) : status}</span>
          <span className="terminal-action-divider" aria-hidden="true" />
          <button className="terminal-icon-button is-danger" type="button" onClick={requestStop} disabled={disabled} aria-expanded={stopConfirming} aria-label="Stop tmux session" title="Stop tmux session"><StopIcon /></button>
          <button className="terminal-icon-button" type="button" onClick={onToggleFloating} aria-label={floating ? 'Dock terminal' : 'Float terminal'} title={floating ? 'Dock terminal' : 'Float terminal'}>{floating ? <DrawingPinIcon /> : <OpenInNewWindowIcon />}</button>
          <button className="terminal-icon-button" type="button" onClick={() => setFullscreen((value) => !value)} aria-pressed={isFullscreen} aria-label={isFullscreen ? 'Restore terminal window' : 'Make terminal full screen'} title={isFullscreen ? 'Restore window' : 'Full screen'}>{isFullscreen ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}</button>
          <button className="terminal-icon-button" type="button" onClick={onClose} aria-label="Minimize terminal; tmux keeps running" title="Minimize terminal; tmux keeps running"><MinusIcon /></button>
        </div>
        {stopConfirming && <div className="terminal-stop-confirm" role="alertdialog" aria-labelledby="terminal-stop-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setStopConfirming(false) } }}>
          <strong id="terminal-stop-title">Stop tmux session?</strong>
          <span>This terminates the session and its running processes.</span>
          <div><button type="button" onClick={() => setStopConfirming(false)} autoFocus>Cancel</button><button className="is-danger" type="button" onClick={requestStop} disabled={disabled}>Stop session</button></div>
        </div>}
        {showNodeEditor && <div className="terminal-node-editor">
          <label className="is-wide">Title<input defaultValue={node.title} onBlur={(event) => { if (event.target.value !== node.title) onUpdate({ title: event.target.value }) }} /></label>
          <label>Type<select value={node.type} onChange={(event) => onUpdate({ type: event.target.value as NodeType })}>{nodeTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="terminal-color-field is-wide"><span>Color</span><NodeColorPicker value={node.color} onChange={(color) => onUpdate({ color })} /></div>
          <label>Project<input defaultValue={node.project ?? ''} onBlur={(event) => { if (event.target.value !== (node.project ?? '')) onUpdate({ project: event.target.value }) }} /></label>
          <label>Ticket key<input defaultValue={node.jiraKey ?? ''} onBlur={(event) => { if (event.target.value !== (node.jiraKey ?? '')) onUpdate({ jiraKey: event.target.value }) }} /></label>
          <label>Repository path<input defaultValue={node.repoPath ?? ''} onBlur={(event) => { if (event.target.value !== (node.repoPath ?? '')) onUpdate({ repoPath: event.target.value }) }} /></label>
          <label className="is-wide">Note<textarea defaultValue={node.note ?? ''} rows={2} onBlur={(event) => { if (event.target.value !== (node.note ?? '')) onUpdate({ note: event.target.value }) }} /></label>
        </div>}
      </div>
      <div className="terminal-screen"><div className="terminal-mount" ref={container} /></div>
    </section>
  )
}

export default TerminalPanel
