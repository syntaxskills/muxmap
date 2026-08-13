import { type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { NodeType, TerminalSession, TerminalStatus, WorkNode } from './model.ts'
import { NodeColorPicker } from './NodeColorPicker.tsx'
import { consumeTerminalWheel, dragOffset, forceTerminalTextSelection, shouldCopyTerminalSelection, stopSessionIntent, terminalShortcutData } from './terminalInteraction.ts'
import { createTerminalLifecycle } from './terminalLifecycle.ts'
import { agentStatusText } from './agentStatus.ts'
import { AgentIcon } from './AgentIcon.tsx'
import { createTerminalLinkProvider } from './terminalLinks.ts'
import { imageFileFromClipboard, insertMarkdownAtSelection, uploadImageAttachment } from './imageAttachments.ts'
import { NoteImagePreview } from './NoteImagePreview.tsx'
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
  fontSize: number
  cursorBlink: boolean
  scrollback: number
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

export function TerminalPanel({ session, node, opacity, fontSize, cursorBlink, scrollback, floating, disabled, onClose, onStop, onToggleFloating, onStatus, onUpdate }: Props) {
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
      cursorBlink,
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
      fontSize,
      scrollback,
      lineHeight: 1.25,
      macOptionClickForcesSelection: true,
      theme: { background: '#101311', foreground: '#d8ddd7', cursor: '#d49a4d', selectionBackground: '#4b3d29' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    const links = terminal.registerLinkProvider(createTerminalLinkProvider(terminal, session.cwd))
    const forceSelection = (event: MouseEvent) => forceTerminalTextSelection(event, terminal.element?.classList.contains('enable-mouse-events') ?? false)
    terminal.element?.addEventListener('mousedown', forceSelection, true)
    fit.fit()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${session.id}/attach?cols=${terminal.cols}&rows=${terminal.rows}`)
    let wheelRemainder = 0
    let pendingScroll = 0
    let scrollTimer: number | undefined
    const flushScroll = () => {
      scrollTimer = undefined
      if (pendingScroll && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'scroll', lines: pendingScroll }))
      pendingScroll = 0
    }
    const scroll = (event: WheelEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      const intent = consumeTerminalWheel(wheelRemainder, event.deltaY, event.deltaMode, terminal.rows)
      wheelRemainder = intent.remainder
      if (!intent.lines) return
      pendingScroll = Math.max(-200, Math.min(200, pendingScroll + intent.lines))
      scrollTimer ??= window.setTimeout(flushScroll, 32)
    }
    terminal.element?.addEventListener('wheel', scroll, { capture: true, passive: false })
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
      links.dispose()
      terminal.element?.removeEventListener('mousedown', forceSelection, true)
      terminal.element?.removeEventListener('wheel', scroll, true)
      if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
      socket.close()
      terminal.dispose()
    }
  }, [cursorBlink, fontSize, onStatus, scrollback, session.cwd, session.id])

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

  async function pasteNoteImage(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFileFromClipboard(event.clipboardData)
    if (!file) return
    event.preventDefault()
    try {
      const uploaded = await uploadImageAttachment(file)
      const textarea = event.currentTarget
      const inserted = insertMarkdownAtSelection(textarea.value, uploaded.markdown, textarea.selectionStart, textarea.selectionEnd)
      textarea.value = inserted.value
      textarea.setSelectionRange(inserted.cursor, inserted.cursor)
      onUpdate({ note: inserted.value })
    } catch {
      // Keep the terminal usable; the detail panel surfaces backend/API errors elsewhere.
    }
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
        <button className="terminal-title" type="button" onClick={() => setShowNodeEditor((value) => !value)} aria-expanded={showNodeEditor} title={[node.type, node.project, node.jiraKey, node.repoPath, node.note].filter(Boolean).join('\n')}><span className="terminal-node-link"><Link2Icon /> linked</span><strong>{node.title}</strong><span className="terminal-session-name">{session.runtimeName}</span><span className="terminal-details-hint">Details <ChevronDownIcon aria-hidden="true" /></span></button>
        <div className="terminal-actions">
          <span className={`runtime-state ${session.agent ? `is-${session.agent.state}` : `is-${status}`}`} title={session.agent ? `Detected from this ${session.backend} session` : `Terminal ${status}`}>{session.agent && <AgentIcon kind={session.agent.kind} />}{session.agent ? agentStatusText(session.agent) : status}</span>
          <span className="terminal-action-divider" aria-hidden="true" />
          <button className="terminal-icon-button is-danger" type="button" onClick={requestStop} disabled={disabled} aria-expanded={stopConfirming} aria-label="Stop terminal session" title="Stop terminal session"><StopIcon /></button>
          <button className="terminal-icon-button terminal-float-action" type="button" onClick={onToggleFloating} aria-label={floating ? 'Dock terminal' : 'Float terminal'} title={floating ? 'Dock terminal' : 'Float terminal'}>{floating ? <DrawingPinIcon /> : <OpenInNewWindowIcon />}</button>
          <button className="terminal-icon-button" type="button" onClick={() => setFullscreen((value) => !value)} aria-pressed={isFullscreen} aria-label={isFullscreen ? 'Restore terminal window' : 'Make terminal full screen'} title={isFullscreen ? 'Restore window' : 'Full screen'}>{isFullscreen ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}</button>
          <button className="terminal-icon-button" type="button" onClick={onClose} aria-label={`Minimize terminal; ${session.backend} keeps running`} title={`Minimize terminal; ${session.backend} keeps running`}><MinusIcon /></button>
        </div>
        {stopConfirming && <div className="terminal-stop-confirm" role="alertdialog" aria-labelledby="terminal-stop-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setStopConfirming(false) } }}>
          <strong id="terminal-stop-title">Stop terminal session?</strong>
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
          <label className="is-wide">Note<textarea defaultValue={node.note ?? ''} rows={2} placeholder="Paste images or write context" onPaste={(event) => void pasteNoteImage(event)} onBlur={(event) => { if (event.target.value !== (node.note ?? '')) onUpdate({ note: event.target.value }) }} /></label>
          <NoteImagePreview note={node.note} />
        </div>}
      </div>
      <div className="terminal-screen"><div className="terminal-mount" ref={container} /></div>
    </section>
  )
}

export default TerminalPanel
