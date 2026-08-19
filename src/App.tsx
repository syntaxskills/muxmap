import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { api } from './api.ts'
import { activeNodes, archivedDirectChildren, archivedNodeEntries, branchHasLiveSession, canRecoverCodexSession, effectiveArchivedNodeIds, expandedNodeHeight, liveSessionIdForNode, reorderSiblings, type ReorderPosition, visibleAgentForSession, visibleNodes } from './graph.ts'
import { centerPan, dragPan, gridBackground, isCanvasBlankTarget, layoutTree, wheelPan, zoomAtPoint } from './layout.ts'
import type { NodeType, TerminalBackend, TerminalSession, WorkNode, WorkspaceGraph } from './model.ts'
import { NodeColorPicker } from './NodeColorPicker.tsx'
import { normalizeTerminalOpacity, normalizeTerminalSplit } from './terminalInteraction.ts'
import { readViewState, writeViewState } from './viewState.ts'
import { agentStatusText } from './agentStatus.ts'
import { IN_PAGE_NOTIFICATION_LIFETIME_MS, mergeAgentNotifications, routeAgentNotifications, scanAgentNotifications, type AgentNotification } from './agentNotifications.ts'
import { dragIntent, dropPositionAt, pointerReleaseIntent } from './nodeReorderInteraction.ts'
import { contextMenuConfirmationText, contextMenuPosition, contextMenuStopSessionConfirmationText, duplicateNodeInput, type ContextMenuConfirmation } from './nodeContextMenu.ts'
import { AgentIcon } from './AgentIcon.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { ArchivePanel } from './ArchivePanel.tsx'
import { loadSettings, notificationDeliveryTargets, SETTINGS_VERSION, type AppSettings } from './settings.ts'
import { sendTestSystemNotification } from './systemNotifications.ts'
import { activityStaleness, formatActivityAge, sessionActivityTimestamp } from './activityTime.ts'
import { agentWorkingSweepDelay, synchronizeAgentWorkingSweeps } from './agentAnimations.ts'
import { agentSessionSummary } from './agentSessionDetails.ts'
import { imageFileFromClipboard, insertMarkdownAtSelection, uploadImageAttachment } from './imageAttachments.ts'
import { keyboardOwnerFromPointerTarget, mindmapDirectionFromKey, navigateMindmapNode, shouldMindmapHandleArrow, type KeyboardOwner } from './mindmapNavigation.ts'
import { NoteImagePreview } from './NoteImagePreview.tsx'
import { SessionBindingCard } from './SessionBindingCard.tsx'
import { AgentEventList } from './AgentEventList.tsx'
import { ArchiveIcon, BoxIcon, CheckboxIcon, CheckCircledIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CopyIcon, Cross2Icon, DesktopIcon, EyeOpenIcon, GearIcon, Pencil2Icon, PlayIcon, PlusIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import {
  closeTerminal,
  floatTerminal,
  openRightPanel,
  openTerminal as openTerminalSurface,
  selectNodeSurface,
  type WorkspaceSurface,
} from './workspaceSurface.ts'

const NODE_WIDTH = 184
const NODE_HEIGHT = 42
const WORKSPACE_POLL_MS = 5000
type NodePatch = Partial<Omit<WorkNode, 'doneAt'>> & { doneAt?: string | null }
const TerminalPanel = lazy(() => import('./TerminalPanel.tsx'))

const typeLabels: Record<NodeType, string> = {
  workspace: 'Workspace',
  repo: 'Repository',
  feature: 'Feature',
  ticket: 'Jira ticket',
  note: 'Note',
  todo: 'Todo',
  terminal: 'Terminal task',
}

function App() {
  const [clientPlatform] = useState(() => /Win/i.test(navigator.platform) ? 'win32' : /Mac/i.test(navigator.platform) ? 'darwin' : 'linux')
  const [initialView] = useState(() => readViewState(window.location.search))
  const [graph, setGraph] = useState<WorkspaceGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialView.selectedId ?? 'dev-1420')
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [query, setQuery] = useState('')
  const [scale, setScale] = useState(0.9)
  const [pan, setPan] = useState({ x: 24, y: 48 })
  const [isPanning, setPanning] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number; confirm?: ContextMenuConfirmation } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: ReorderPosition } | null>(null)
  const [surface, setSurface] = useState<WorkspaceSurface>(() => ({
    rightPanel: initialView.terminalSessionId && !initialView.terminalFloating ? null : 'details',
    terminalSessionId: initialView.terminalSessionId,
    terminalFloating: initialView.terminalFloating,
  }))
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = window.localStorage.getItem('muxmap:settings')
    const storedVersion = Number(window.localStorage.getItem('muxmap:settings-version') ?? 0)
    const loaded = loadSettings(stored, clientPlatform, storedVersion)
    if (!stored) {
      loaded['terminal.opacity'] = normalizeTerminalOpacity(window.localStorage.getItem('muxmap:terminal-opacity'))
      loaded['terminal.splitPercent'] = normalizeTerminalSplit(window.localStorage.getItem('muxmap:terminal-split'))
    }
    return loaded
  })
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported')
  const [agentAlerts, setAgentAlerts] = useState<AgentNotification[]>([])
  const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null)
  const [confirmStopSession, setConfirmStopSession] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const centeredOnce = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const nodeDragRef = useRef<string | null>(null)
  const nodePointerRef = useRef<{ pointerId: number; nodeId: string; parentId: string; x: number; y: number; dragging: boolean } | null>(null)
  const nodeDropRef = useRef<{ id: string; position: ReorderPosition } | null>(null)
  const suppressNodeClick = useRef(false)
  const notifiedAgentEvents = useRef(new Map<string, string>())
  const notificationBaselineReady = useRef(false)
  const agentAlertTimers = useRef(new Map<string, number>())
  const splitDragRef = useRef<number | null>(null)
  const settingsPlatformRef = useRef(clientPlatform)
  const keyboardOwnerRef = useRef<KeyboardOwner>('mindmap')
  const { rightPanel, terminalSessionId, terminalFloating } = surface
  const inPageNotificationsEnabled = notificationDeliveryTargets(settings['notifications.delivery']).inPage

  const loadWorkspace = useCallback(async () => {
    setError('')
    try {
      await api('/api/auth')
      setGraph(await api<WorkspaceGraph>('/api/workspaces/default'))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load workspace')
    }
  }, [])

  useEffect(() => { void loadWorkspace() }, [loadWorkspace])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void api<WorkspaceGraph>('/api/workspaces/default').then(setGraph).catch(() => {})
    }, WORKSPACE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => setDeleteNodeId((current) => current === selectedId ? current : null), [selectedId])
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.node-context-menu')) setContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null) }
    const dismissOnResize = () => setContextMenu(null)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('resize', dismissOnResize)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [contextMenu])
  useEffect(() => {
    window.localStorage.setItem('muxmap:settings', JSON.stringify(settings))
    window.localStorage.setItem('muxmap:settings-version', String(SETTINGS_VERSION))
  }, [settings])
  useEffect(() => {
    const platform = graph?.runtime?.platform
    if (!platform || platform === settingsPlatformRef.current) return
    settingsPlatformRef.current = platform
    setSettings(loadSettings(window.localStorage.getItem('muxmap:settings'), platform))
  }, [graph?.runtime?.platform])
  useEffect(() => {
    if (!graph) return
    const scanned = scanAgentNotifications(graph, notifiedAgentEvents.current, notificationBaselineReady.current)
    notifiedAgentEvents.current = scanned.notified
    if (!notificationBaselineReady.current) {
      notificationBaselineReady.current = true
      return
    }
    const routed = routeAgentNotifications(scanned.notifications, settings['notifications.delivery'], settings['notifications.completed'], settings['notifications.needsInput'])
    if (routed.inPage.length > 0) setAgentAlerts((current) => mergeAgentNotifications(current, routed.inPage))
    if (routed.system.length === 0 || !('Notification' in window) || Notification.permission !== 'granted') return
    for (const event of routed.system) {
      try {
        const notification = new Notification(event.title, {
          body: event.body,
          icon: '/favicon.svg',
          tag: `muxmap-${event.sessionId}-${event.key}`,
          requireInteraction: event.key.startsWith('needs_input:'),
        })
        notification.onclick = () => {
          window.focus()
          setSelectedId(event.nodeId)
          setSurface((current) => openTerminalSurface(current, event.sessionId))
          notification.close()
        }
      } catch {
        // Browser notification failures must not interrupt workspace polling.
      }
    }
  }, [graph, settings])
  useEffect(() => {
    if (!inPageNotificationsEnabled) setAgentAlerts([])
  }, [inPageNotificationsEnabled])
  useEffect(() => {
    const active = new Set(agentAlerts.map((alert) => `${alert.sessionId}:${alert.key}`))
    for (const alert of agentAlerts) {
      const key = `${alert.sessionId}:${alert.key}`
      if (agentAlertTimers.current.has(key)) continue
      const timer = window.setTimeout(() => {
        agentAlertTimers.current.delete(key)
        setAgentAlerts((current) => current.filter((item) => `${item.sessionId}:${item.key}` !== key))
      }, IN_PAGE_NOTIFICATION_LIFETIME_MS)
      agentAlertTimers.current.set(key, timer)
    }
    for (const [key, timer] of agentAlertTimers.current) {
      if (active.has(key)) continue
      window.clearTimeout(timer)
      agentAlertTimers.current.delete(key)
    }
  }, [agentAlerts])
  useEffect(() => () => {
    for (const timer of agentAlertTimers.current.values()) window.clearTimeout(timer)
    agentAlertTimers.current.clear()
  }, [])
  useEffect(() => {
    const search = writeViewState(window.location.search, { selectedId, terminalSessionId, terminalFloating })
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) window.history.replaceState(window.history.state, '', nextUrl)
  }, [selectedId, terminalFloating, terminalSessionId])
  useEffect(() => {
    if (!graph) return
    const archivedIds = effectiveArchivedNodeIds(graph.nodes)
    if (selectedId && (!graph.nodes.some((node) => node.id === selectedId) || archivedIds.has(selectedId))) setSelectedId(null)
    if (!terminalSessionId) return
    const restored = graph.sessions.find((item) => item.id === terminalSessionId && item.status !== 'stopped' && item.runtimeExists !== false)
    if (!restored || archivedIds.has(restored.nodeId)) {
      setSurface(closeTerminal)
      return
    }
    if (restored.nodeId !== selectedId) {
      setSelectedId(restored.nodeId)
    }
    if (restored.agent?.state === 'completed') {
      setGraph((current) => current ? {
        ...current,
        sessions: current.sessions.map((item) => item.id === restored.id && item.agent ? { ...item, agent: { ...item.agent, state: 'read' } } : item),
      } : current)
      void api(`/api/sessions/${restored.id}/agent/read`, { method: 'POST', body: '{}' }).catch(() => loadWorkspace())
    }
  }, [graph, loadWorkspace, selectedId, terminalSessionId])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pinchZoom = (event: WheelEvent) => {
      event.preventDefault()
      if (!event.ctrlKey) {
        setPan(wheelPan(pan, { x: event.deltaX * settings['canvas.panSensitivity'], y: event.deltaY * settings['canvas.panSensitivity'] }))
        return
      }
      const bounds = canvas.getBoundingClientRect()
      const nextScale = Math.max(0.45, Math.min(1.4, scale * Math.exp(-event.deltaY * settings['canvas.zoomSensitivity'])))
      setPan(zoomAtPoint(pan, scale, nextScale, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }))
      setScale(nextScale)
    }
    canvas.addEventListener('wheel', pinchZoom, { passive: false })
    return () => canvas.removeEventListener('wheel', pinchZoom)
  }, [graph, pan, scale, settings])

  const activeGraphNodes = useMemo(() => activeNodes(graph?.nodes ?? []), [graph?.nodes])
  const archivedIds = useMemo(() => effectiveArchivedNodeIds(graph?.nodes ?? []), [graph?.nodes])
  const archivedCount = useMemo(() => archivedNodeEntries(graph?.nodes ?? [], '').length, [graph?.nodes])
  const archivedChildCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of graph?.nodes ?? []) {
      if (!node.parentId || !archivedIds.has(node.id)) continue
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1)
    }
    return counts
  }, [archivedIds, graph?.nodes])
  const nodes = useMemo(
    () => visibleNodes(activeGraphNodes, collapsed, query),
    [activeGraphNodes, collapsed, query],
  )
  const sessionsByNode = useMemo(() => new Map(graph?.sessions.map((item) => [item.nodeId, item]) ?? []), [graph?.sessions])
  const visibleSessionActivityTimestamps = useMemo(() => nodes.map((node) => {
    const nodeSession = sessionsByNode.get(node.id)
    const visibleAgent = visibleAgentForSession(nodeSession)
    return nodeSession && !visibleAgent ? sessionActivityTimestamp(nodeSession) : undefined
  }), [nodes, sessionsByNode])
  const nodeHeights = useMemo(() => new Map(nodes
    .filter((node) => node.id === selectedId || node.id === hoveredId)
    .map((node) => {
      const nodeSession = sessionsByNode.get(node.id)
      return [node.id, expandedNodeHeight(node, Boolean(visibleAgentForSession(nodeSession)), archivedChildCounts.get(node.id) ?? 0, Boolean(nodeSession))]
    })), [archivedChildCounts, hoveredId, nodes, selectedId, sessionsByNode])
  const positions = useMemo(
    () => layoutTree(nodes, graph?.workspace.rootNodeId ?? 'workspace', settings['mindmap.columnGap'], settings['mindmap.rowGap'], nodeHeights),
    [graph?.workspace.rootNodeId, nodeHeights, nodes, settings],
  )
  const selected = selectedId ? activeGraphNodes.find((node) => node.id === selectedId) : undefined
  const selectedArchivedChildren = useMemo(() => archivedDirectChildren(graph?.nodes ?? [], selected?.id ?? ''), [graph?.nodes, selected?.id])
  const session = graph?.sessions.find((item) => item.nodeId === selected?.id)
  const activeTerminal = graph?.sessions.find((item) => item.id === terminalSessionId)
  const activeTerminalNode = activeGraphNodes.find((node) => node.id === activeTerminal?.nodeId)
  const orphans = graph?.orphans ?? []
  const agentCount = [...(graph?.sessions ?? []).filter((item) => visibleAgentForSession(item)), ...orphans.filter((item) => item.agent)].length
  const workingAgentNodeKey = nodes
    .map((node) => visibleAgentForSession(sessionsByNode.get(node.id))?.state === 'working' ? node.id : '')
    .filter(Boolean)
    .join('|')
  const activityNow = Date.now()
  const width = Math.max(0, ...[...positions.values()].map(({ x }) => x)) + NODE_WIDTH + 96
  const height = Math.max(0, ...nodes.map((node) => (positions.get(node.id)?.y ?? 0) + (nodeHeights.get(node.id) ?? NODE_HEIGHT))) + 96

  const fitView = useCallback(() => {
    const viewport = canvasRef.current
    if (!viewport) return
    const nextScale = Math.max(0.45, Math.min(1, (viewport.clientWidth - 64) / width, (viewport.clientHeight - 64) / height))
    setScale(nextScale)
    setPan(centerPan(viewport.clientWidth, viewport.clientHeight, width, height, nextScale))
  }, [height, width])

  const centerView = useCallback(() => {
    const viewport = canvasRef.current
    if (!viewport) return
    setPan(centerPan(viewport.clientWidth, viewport.clientHeight, width, height, scale))
  }, [height, scale, width])

  const focusSelectedOnMobile = useCallback(() => {
    const viewport = canvasRef.current
    const point = positions.get(selected?.id ?? graph?.workspace.rootNodeId ?? '')
    if (!viewport || !point || viewport.clientWidth > 640) return false
    const nextScale = 0.82
    const nodeHeight = nodeHeights.get(selected?.id ?? '') ?? NODE_HEIGHT
    setScale(nextScale)
    setPan({
      x: viewport.clientWidth / 2 - (point.x + 48 + NODE_WIDTH / 2) * nextScale,
      y: viewport.clientHeight / 2 - (point.y + 48 + nodeHeight / 2) * nextScale,
    })
    return true
  }, [graph?.workspace.rootNodeId, nodeHeights, positions, selected?.id])

  useEffect(() => {
    if (!graph || centeredOnce.current || !settings['canvas.autoFitOnLoad']) return
    centeredOnce.current = true
    requestAnimationFrame(() => { if (!focusSelectedOnMobile()) fitView() })
  }, [fitView, focusSelectedOnMobile, graph, settings])

  useEffect(() => {
    if (!workingAgentNodeKey || settings['workbench.reduceMotion']) return
    const frame = requestAnimationFrame(() => synchronizeAgentWorkingSweeps(document, performance.now()))
    return () => cancelAnimationFrame(frame)
  }, [settings, workingAgentNodeKey])

  function fitProject() {
    if (!selected) return
    const projectNodes = nodes.filter((node) => node.project === selected.project || node.id === selected.id)
    const points = projectNodes.map((node) => positions.get(node.id)).filter(Boolean) as Array<{ x: number; y: number }>
    const viewport = canvasRef.current
    if (!viewport || points.length === 0) return
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x)) + NODE_WIDTH
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...projectNodes.map((node) => (positions.get(node.id)?.y ?? 0) + (nodeHeights.get(node.id) ?? NODE_HEIGHT)))
    const nextScale = Math.max(0.55, Math.min(1.2, (viewport.clientWidth - 80) / (maxX - minX + 96), (viewport.clientHeight - 80) / (maxY - minY + 96)))
    setScale(nextScale)
    setPan({
      x: (viewport.clientWidth - (maxX - minX) * nextScale) / 2 - minX * nextScale,
      y: (viewport.clientHeight - (maxY - minY) * nextScale) / 2 - minY * nextScale,
    })
  }

  useEffect(() => {
    const updateKeyboardOwner = (event: PointerEvent) => {
      const owner = keyboardOwnerFromPointerTarget(event.target as HTMLElement | null)
      if (owner) keyboardOwnerRef.current = owner
    }
    window.addEventListener('pointerdown', updateKeyboardOwner, true)
    return () => window.removeEventListener('pointerdown', updateKeyboardOwner, true)
  }, [])
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      const direction = mindmapDirectionFromKey(event.key)
      if (direction && !event.altKey && !event.ctrlKey && !event.metaKey && shouldMindmapHandleArrow(target, keyboardOwnerRef.current)) {
        const nextId = navigateMindmapNode(nodes, positions, selectedId, direction)
        const next = nextId ? nodes.find((node) => node.id === nextId) : undefined
        if (next && next.id !== selectedId) {
          event.preventDefault()
          setContextMenu(null)
          setSelectedId(next.id)
          setSurface(selectNodeSurface(liveSessionIdForNode(graph?.sessions ?? [], next.id)))
        }
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLowerCase() === 'n' && !typing) {
        event.preventDefault()
        const parent = graph?.nodes.find((node) => node.id === selectedId)
        if (parent) void addChild(parent)
      } else if (event.key.toLowerCase() === 'f' && !typing) {
        event.preventDefault()
        fitView()
      } else if (event.key.toLowerCase() === 'c' && !typing) {
        event.preventDefault()
        centerView()
      } else if ((event.key === '+' || event.key === '=') && !typing) {
        setScale((value) => Math.min(1.4, value + 0.1))
      } else if (event.key === '-' && !typing) {
        setScale((value) => Math.max(0.45, value - 0.1))
      } else if (event.key === 'Escape' && !typing) {
        if (!contextMenu && terminalSessionId) setSurface(closeTerminal)
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [centerView, contextMenu, fitView, graph?.nodes, graph?.sessions, nodes, positions, selectedId, terminalSessionId])

  async function addChild(parent: WorkNode) {
    setBusy(true)
    setError('')
    try {
      const node = await api<WorkNode>(`/api/workspaces/${parent.workspaceId}/nodes`, {
        method: 'POST',
        body: JSON.stringify({
          parentId: parent.id,
          title: 'New node',
          type: 'note',
        }),
      })
      setGraph((current) => current ? { ...current, nodes: [...current.nodes, node] } : current)
      setSelectedId(node.id)
      setSurface(selectNodeSurface(null))
      setRenamingId(node.id)
      setRenameTitle(node.title)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add node')
    } finally {
      setBusy(false)
    }
  }

  async function duplicateNode(node: WorkNode) {
    const input = duplicateNodeInput(node)
    if (!input) return
    setBusy(true)
    setError('')
    try {
      const copy = await api<WorkNode>(`/api/workspaces/${node.workspaceId}/nodes`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
      setGraph((current) => current ? { ...current, nodes: [...current.nodes, copy] } : current)
      setSelectedId(copy.id)
      setSurface(selectNodeSurface(null))
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Unable to duplicate node')
    } finally {
      setBusy(false)
    }
  }

  async function saveNode(nodeId: string, changes: NodePatch) {
    setError('')
    try {
      const updated = await api<WorkNode>(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setGraph((current) => current ? {
        ...current,
        nodes: current.nodes.map((node) => node.id === updated.id ? updated : node),
      } : current)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update node')
      await loadWorkspace()
    }
  }

  async function markNodeTodo(node: WorkNode) {
    await saveNode(node.id, { type: 'todo', doneAt: null })
    setContextMenu(null)
  }

  async function markNodeDone(node: WorkNode) {
    await saveNode(node.id, { type: 'todo', doneAt: new Date().toISOString() })
    setContextMenu(null)
  }

  async function setAgentStatus(sessionId: string, state: 'working' | 'completed' | 'read') {
    setError('')
    try {
      const response = await api<{ activity: NonNullable<TerminalSession['agent']> }>(`/api/sessions/${sessionId}/agent/status`, {
        method: 'POST',
        body: JSON.stringify({ state }),
      })
      setGraph((current) => current ? {
        ...current,
        sessions: current.sessions.map((item) => item.id === sessionId ? { ...item, agent: response.activity } : item),
      } : current)
      setContextMenu(null)
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update agent status')
      await loadWorkspace()
    }
  }

  async function pasteNoteImage(event: ReactClipboardEvent<HTMLTextAreaElement>, node: WorkNode) {
    const file = imageFileFromClipboard(event.clipboardData)
    if (!file) return
    event.preventDefault()
    setError('')
    try {
      const uploaded = await uploadImageAttachment(file)
      const textarea = event.currentTarget
      const inserted = insertMarkdownAtSelection(textarea.value, uploaded.markdown, textarea.selectionStart, textarea.selectionEnd)
      textarea.value = inserted.value
      textarea.setSelectionRange(inserted.cursor, inserted.cursor)
      await saveNode(node.id, { note: inserted.value })
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : 'Unable to paste image')
    }
  }

  function startRename(node: WorkNode) {
    setSelectedId(node.id)
    setRenamingId(node.id)
    setRenameTitle(node.title)
  }

  function finishRename(node: WorkNode) {
    const nextTitle = renameTitle.trim()
    setRenamingId(null)
    if (nextTitle && nextTitle !== node.title) void saveNode(node.id, { title: nextTitle })
  }

  async function reorderNode(movedId: string, targetId: string, position: ReorderPosition) {
    setGraph((current) => current ? { ...current, nodes: reorderSiblings(current.nodes, movedId, targetId, position) } : current)
    try {
      const response = await api<{ nodes: WorkNode[] }>(`/api/nodes/${movedId}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ targetId, position }),
      })
      const updated = new Map(response.nodes.map((node) => [node.id, node]))
      setGraph((current) => current ? { ...current, nodes: current.nodes.map((node) => updated.get(node.id) ?? node) } : current)
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : 'Unable to reorder node')
      await loadWorkspace()
    }
  }

  function beginNodeReorder(event: ReactPointerEvent<HTMLElement>, node: WorkNode) {
    const target = event.target as HTMLElement
    if (event.button !== 0 || !node.parentId || renamingId === node.id || target.closest('input, .node-add-action')) return
    nodePointerRef.current = { pointerId: event.pointerId, nodeId: node.id, parentId: node.parentId, x: event.clientX, y: event.clientY, dragging: false }
    target.setPointerCapture(event.pointerId)
  }

  function moveNodeReorder(event: ReactPointerEvent<HTMLElement>) {
    const drag = nodePointerRef.current
    if (!drag || drag.pointerId !== event.pointerId || !graph) return
    if (!drag.dragging) {
      if (!dragIntent({ x: drag.x, y: drag.y }, { x: event.clientX, y: event.clientY })) return
      drag.dragging = true
      nodeDragRef.current = drag.nodeId
      suppressNodeClick.current = true
      setDraggedId(drag.nodeId)
    }
    event.preventDefault()
    const candidates = activeGraphNodes.filter((node) => node.parentId === drag.parentId && node.id !== drag.nodeId)
      .map((node) => {
        const element = canvasRef.current?.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
        const bounds = element?.getBoundingClientRect()
        return bounds ? { id: node.id, bounds, distance: Math.abs(event.clientY - (bounds.top + bounds.height / 2)) } : null
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((a, b) => a.distance - b.distance)
    const nearest = candidates[0]
    const next = nearest ? { id: nearest.id, position: dropPositionAt(event.clientY, nearest.bounds) } : null
    nodeDropRef.current = next
    setDropTarget(next)
  }

  function endNodeReorder(event: ReactPointerEvent<HTMLElement>) {
    const drag = nodePointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = nodeDropRef.current
    const intent = pointerReleaseIntent(drag.dragging, Boolean(target))
    if (intent === 'reorder' && target) void reorderNode(drag.nodeId, target.id, target.position)
    if (intent === 'activate') {
      const node = activeGraphNodes.find((item) => item.id === drag.nodeId)
      if (node) selectNode(node)
      suppressNodeClick.current = true
    }
    nodePointerRef.current = null
    nodeDragRef.current = null
    nodeDropRef.current = null
    setDraggedId(null)
    setDropTarget(null)
    setHoveredId(null)
    window.setTimeout(() => { suppressNodeClick.current = false }, 0)
  }

  function cancelNodeReorder(event: ReactPointerEvent<HTMLElement>) {
    if (nodePointerRef.current?.pointerId !== event.pointerId) return
    nodePointerRef.current = null
    nodeDragRef.current = null
    nodeDropRef.current = null
    setDraggedId(null)
    setDropTarget(null)
    setHoveredId(null)
    window.setTimeout(() => { suppressNodeClick.current = false }, 0)
  }

  function selectNode(node: WorkNode) {
    setContextMenu(null)
    setSelectedId(node.id)
    setSurface(selectNodeSurface(liveSessionIdForNode(graph?.sessions ?? [], node.id)))
  }

  function openAgentAlert(alert: AgentNotification) {
    setAgentAlerts((current) => current.filter((item) => item.sessionId !== alert.sessionId || item.key !== alert.key))
    setSelectedId(alert.nodeId)
    setSurface((current) => openTerminalSurface(current, alert.sessionId))
  }

  function openNodeContextMenu(event: React.MouseEvent<HTMLElement>, node: WorkNode) {
    event.preventDefault()
    event.stopPropagation()
    const position = contextMenuPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
    setSelectedId(node.id)
    setContextMenu({ nodeId: node.id, ...position })
  }

  function toggleNodeCollapsed(nodeId: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea, a')) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPanning(true)
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan(dragPan({ x: drag.panX, y: drag.panY }, { x: drag.x, y: drag.y }, { x: event.clientX, y: event.clientY }))
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return false
    const distance = Math.hypot(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y)
    dragRef.current = null
    setPanning(false)
    return distance < 4
  }

  function collapseMindmapSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const targetClassName = typeof target.className === 'string' ? target.className : ''
    if (!isCanvasBlankTarget(targetClassName, event.currentTarget.className)) return
    setHoveredId(null)
    setSelectedId(null)
    setContextMenu(null)
    setRenamingId(null)
    setDeleteNodeId(null)
    setSurface((current) => current.rightPanel === 'details' ? { ...current, rightPanel: null } : current)
  }

  function openTerminal(id: string) {
    setSurface((current) => settings['terminal.defaultPlacement'] === 'floating'
      ? { rightPanel: current.rightPanel ?? 'details', terminalSessionId: id, terminalFloating: true }
      : openTerminalSurface(current, id))
  }

  async function enableAgentNotifications() {
    if (!('Notification' in window)) return
    setNotificationPermission(await Notification.requestPermission())
  }

  async function testSystemNotification() {
    const result = await sendTestSystemNotification('Notification' in window ? Notification : undefined, () => window.focus())
    if ('Notification' in window) setNotificationPermission(Notification.permission)
    return result
  }

  function toggleSessionManager() {
    const opening = rightPanel !== 'sessions'
    setSurface((current) => openRightPanel(current, 'sessions'))
    if (opening) void loadWorkspace()
  }

  function beginTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    splitDragRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resizeTerminal(event: ReactPointerEvent<HTMLDivElement>) {
    if (splitDragRef.current !== event.pointerId || !workspaceRef.current) return
    const bounds = workspaceRef.current.getBoundingClientRect()
    setSettings((current) => ({ ...current, 'terminal.splitPercent': normalizeTerminalSplit(((event.clientX - bounds.left) / bounds.width) * 100) }))
  }

  function endTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (splitDragRef.current === event.pointerId) splitDragRef.current = null
  }

  async function attachTerminal(startFresh = false) {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const response = await api<{ session: TerminalSession }>(`/api/nodes/${selected.id}/session${startFresh ? '/new' : ''}`, {
        method: 'POST',
        body: JSON.stringify({ cwd: selected.repoPath, backend: settings['terminal.backend'] }),
      })
      await loadWorkspace()
      openTerminal(response.session.id)
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : 'Unable to attach terminal')
    } finally {
      setBusy(false)
    }
  }

  async function stopSession(sessionId = session?.id) {
    if (!sessionId) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' })
      setSurface(closeTerminal)
      await loadWorkspace()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to stop session')
    } finally {
      setBusy(false)
    }
  }

  async function recoverCodexSession(sessionId: string) {
    setBusy(true)
    setError('')
    try {
      const response = await api<{ session: TerminalSession }>(`/api/sessions/${sessionId}/recover-codex`, { method: 'POST', body: '{}' })
      await loadWorkspace()
      openTerminal(response.session.id)
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : 'Unable to recover Codex session')
    } finally {
      setBusy(false)
    }
  }

  async function stopOrphan(backend: TerminalBackend, runtimeName: string) {
    setBusy(true)
    setError('')
    try {
      await api('/api/sessions/stop-orphan', { method: 'POST', body: JSON.stringify({ backend, runtimeName }) })
      if (activeTerminal?.backend === backend && activeTerminal.runtimeName === runtimeName) setSurface(closeTerminal)
      setConfirmStopSession(null)
      await loadWorkspace()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to stop terminal session')
    } finally {
      setBusy(false)
    }
  }

  async function adoptOrphan(backend: TerminalBackend, runtimeName: string, createNode: boolean) {
    if (!graph || !selected) return
    setBusy(true)
    setError('')
    try {
      let target = selected
      if (createNode) {
        const root = graph.nodes.find((node) => node.id === graph.workspace.rootNodeId)
        if (!root) throw new Error('Workspace root not found')
        target = await api<WorkNode>(`/api/workspaces/${graph.workspace.id}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            parentId: root.id,
            title: runtimeName.replace(/^muxmap-?/, '') || 'Orphan terminal',
            type: 'terminal',
          }),
        })
      }
      const response = await api<{ session: TerminalSession }>('/api/sessions/adopt-orphan', {
        method: 'POST',
        body: JSON.stringify({ nodeId: target.id, backend, runtimeName }),
      })
      setSelectedId(target.id)
      openTerminal(response.session.id)
      await loadWorkspace()
    } catch (adoptError) {
      setError(adoptError instanceof Error ? adoptError.message : 'Unable to adopt terminal session')
    } finally {
      setBusy(false)
    }
  }

  async function deleteNode(nodeId: string, stopSessionWithNode: boolean) {
    if (!graph || nodeId === graph.workspace.rootNodeId) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/nodes/${nodeId}`, {
        method: 'DELETE',
        body: JSON.stringify({ stopSession: stopSessionWithNode }),
      })
      setSelectedId(graph.workspace.rootNodeId)
      setSurface(closeTerminal)
      setDeleteNodeId(null)
      setContextMenu(null)
      await loadWorkspace()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete node')
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected(stopSessionWithNode: boolean) {
    if (!selected) return
    await deleteNode(selected.id, stopSessionWithNode)
  }

  async function deleteArchivedNode(nodeId: string, stopSessionWithNode: boolean) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/nodes/${nodeId}`, {
        method: 'DELETE',
        body: JSON.stringify({ stopSession: stopSessionWithNode }),
      })
      await loadWorkspace()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete archived node')
    } finally {
      setBusy(false)
    }
  }

  async function archiveNode(nodeId: string) {
    if (!graph || nodeId === graph.workspace.rootNodeId) return
    const parentId = graph.nodes.find((node) => node.id === nodeId)?.parentId ?? graph.workspace.rootNodeId
    setBusy(true)
    setError('')
    try {
      await api(`/api/nodes/${nodeId}/archive`, { method: 'POST', body: '{}' })
      setSelectedId(parentId)
      setSurface({ rightPanel: 'details', terminalSessionId: null, terminalFloating: false })
      setContextMenu(null)
      await loadWorkspace()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Unable to archive node')
    } finally {
      setBusy(false)
    }
  }

  async function restoreNode(nodeId: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/nodes/${nodeId}/restore`, { method: 'POST', body: '{}' })
      await loadWorkspace()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Unable to restore node')
    } finally {
      setBusy(false)
    }
  }

  const updateSessionStatus = useCallback((id: string, status: TerminalSession['status']) => {
    setGraph((current) => current ? {
      ...current,
      sessions: current.sessions.map((item) => item.id === id ? { ...item, status } : item),
    } : current)
  }, [])

  function toggleCollapsed() {
    if (!selected) return
    toggleNodeCollapsed(selected.id)
  }

  if (!graph) {
    return (
      <main className="load-state">
        {error ? <><h1>Workspace unavailable</h1><p>{error}</p><button type="button" onClick={() => void loadWorkspace()}>Retry</button></> : <><span className="skeleton wide" /><span className="skeleton" /></>}
      </main>
    )
  }

  if (activeGraphNodes.length === 0) {
    return <main className="load-state"><h1>Workspace is empty</h1><p>Create a root node in the database to continue.</p></main>
  }

  const hasActiveChildren = selected ? activeGraphNodes.some((node) => node.parentId === selected.id) : false
  const hasChildren = selected ? graph.nodes.some((node) => node.parentId === selected.id) : false
  const branchHasSession = selected ? branchHasLiveSession(graph.nodes, graph.sessions, selected.id) : false
  const contextCount = selected ? [selected.project, selected.jiraKey, selected.repoPath, selected.note].filter(Boolean).length : 0
  const terminalPanel = activeTerminal && activeTerminalNode && activeTerminal.status !== 'stopped' && activeTerminal.runtimeExists !== false ? (
    <Suspense fallback={<section className={`terminal terminal-window terminal-loading ${terminalFloating ? 'is-floating' : 'is-docked'}`} aria-label="Loading terminal"><span /><span /></section>}>
      <TerminalPanel
        key={activeTerminal.id}
        session={activeTerminal}
        node={activeTerminalNode}
        opacity={settings['terminal.opacity']}
        fontSize={settings['terminal.fontSize']}
        cursorBlink={settings['terminal.cursorBlink']}
        scrollback={settings['terminal.scrollback']}
        wheelMode={settings['terminal.wheelMode']}
        precisionScrollMultiplier={settings['terminal.precisionScrollMultiplier']}
        discreteScrollMultiplier={settings['terminal.discreteScrollMultiplier']}
        dedupeRepeatedInput={settings['terminal.dedupeRepeatedInput']}
        floating={terminalFloating}
        onToggleFloating={() => setSurface(floatTerminal)}
        onStatus={updateSessionStatus}
        onStop={() => void stopSession(activeTerminal.id)}
        onClose={() => setSurface(closeTerminal)}
        onUpdate={(changes) => void saveNode(activeTerminalNode.id, changes)}
        disabled={busy}
      />
    </Suspense>
  ) : null
  const terminalDocked = Boolean(terminalPanel && !terminalFloating)
  const sidePanelOpen = Boolean(rightPanel && !terminalDocked)
  const background = gridBackground(pan, scale)
  const platform = graph.runtime?.platform ?? clientPlatform

  return (
    <main className={`app-shell density-${settings['workbench.density']} ${settings['workbench.reduceMotion'] ? 'reduce-motion' : ''}`}>
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="MuxMap workspace"><img className="brand-mark" src="/favicon.svg" alt="" /><span>MuxMap</span></a>
        <label className="search-box">
          <span>Search</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title or Jira key" />
          <kbd>/</kbd>
        </label>
        <div className="topbar-status" aria-label="Workspace status">
          <span>{activeGraphNodes.length} nodes</span>
          {agentCount > 0 && <span>{agentCount} agents</span>}
          <button type="button" onClick={() => setSurface((current) => openRightPanel(current, 'archive'))} aria-expanded={rightPanel === 'archive'} aria-label={`${archivedCount} archived nodes`} title="Archive"><ArchiveIcon /><span>{archivedCount} archived</span></button>
          <button type="button" onClick={toggleSessionManager} aria-expanded={rightPanel === 'sessions'} aria-label="Terminal sessions" title="Terminal sessions">
            <DesktopIcon /><span>{graph.sessions.filter((item) => item.status !== 'stopped' && item.runtimeExists !== false).length + orphans.length} sessions{orphans.length > 0 ? ` · ${orphans.length} orphan` : ''}</span>
          </button>
          <button className="settings-trigger" type="button" onClick={() => setSurface((current) => openRightPanel(current, 'settings'))} aria-expanded={rightPanel === 'settings'} aria-label="Settings" title="Settings"><GearIcon /><span>Settings</span></button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}

      {agentAlerts.length > 0 && (
        <div className="agent-alerts" aria-label="Agent notifications" aria-live="polite">
          {agentAlerts.map((alert) => (
            <article className={`agent-alert is-${alert.key.split(':')[0]}`} key={`${alert.sessionId}:${alert.key}`}>
              <button className="agent-alert-open" type="button" onClick={() => openAgentAlert(alert)}>
                <strong>{alert.title}</strong>
                <span>{alert.body}</span>
              </button>
              <button className="agent-alert-dismiss" type="button" onClick={() => setAgentAlerts((current) => current.filter((item) => item.sessionId !== alert.sessionId || item.key !== alert.key))} aria-label={`Dismiss ${alert.title}`} title="Dismiss"><Cross2Icon /></button>
            </article>
          ))}
        </div>
      )}

      <section className={`workspace ${terminalDocked ? 'has-docked-terminal' : ''} ${sidePanelOpen ? 'has-side-panel' : ''}`} id="workspace" ref={workspaceRef} style={{ '--terminal-split': `${settings['terminal.splitPercent']}%` } as CSSProperties}>
        <div
          className={`canvas ${isPanning ? 'is-panning' : ''}`}
          ref={canvasRef}
          aria-label="Workspace mindmap"
          style={{ backgroundPosition: background.position, backgroundSize: background.size, backgroundImage: settings['canvas.showGrid'] ? undefined : 'none' }}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={(event) => { if (endPan(event)) collapseMindmapSelection(event) }}
          onPointerCancel={endPan}
        >
          <div className="canvas-toolbar" aria-label="Canvas controls">
            <button type="button" onClick={() => setScale((value) => Math.max(0.45, value - 0.1))} aria-label="Zoom out">−</button>
            <output>{Math.round(scale * 100)}%</output>
            <button type="button" onClick={() => setScale((value) => Math.min(1.4, value + 0.1))} aria-label="Zoom in">+</button>
            <button className="fit-button" type="button" onClick={fitView}>Fit all</button>
            <button className="fit-button" type="button" onClick={centerView}>Center</button>
            <button className="fit-button" type="button" onClick={fitProject}>Fit project</button>
          </div>

          {nodes.length === 0 ? (
            <div className="empty-state"><strong>No matching nodes</strong><span>Clear the search to restore the full workspace.</span><button type="button" onClick={() => setQuery('')}>Clear search</button></div>
          ) : (
            <div className="stage-shell">
              <div className="graph-stage" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
                <svg className="edges" width={width} height={height} aria-hidden="true">
                  {nodes.map((node) => {
                    if (!node.parentId) return null
                    const from = positions.get(node.parentId)
                    const to = positions.get(node.id)
                    if (!from || !to) return null
                    const x1 = from.x + NODE_WIDTH + 48
                    const y1 = from.y + (nodeHeights.get(node.parentId) ?? NODE_HEIGHT) / 2 + 48
                    const x2 = to.x + 48
                    const y2 = to.y + (nodeHeights.get(node.id) ?? NODE_HEIGHT) / 2 + 48
                    const bend = (x1 + x2) / 2
                    return <path key={node.id} d={`M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`} />
                  })}
                </svg>

                {nodes.map((node) => {
                  const point = positions.get(node.id)
                  if (!point) return null
                  const nodeSession = sessionsByNode.get(node.id)
                  const visibleAgent = visibleAgentForSession(nodeSession)
                  const agentState = visibleAgent?.state
                  const activityTimestamp = nodeSession ? sessionActivityTimestamp(nodeSession) : undefined
                  const activityAge = formatActivityAge(activityTimestamp)
                  const activityFade = nodeSession && !visibleAgent ? activityStaleness(activityTimestamp, visibleSessionActivityTimestamps, activityNow, {
                    enabled: settings['mindmap.dimInactiveNodes'],
                    inactiveAfterHours: settings['mindmap.inactiveAfterHours'],
                    oldestPercent: settings['mindmap.inactiveOldestPercent'],
                  }) : 'fresh'
                  const childCount = activeGraphNodes.filter((child) => child.parentId === node.id).length
                  const archivedChildCount = archivedChildCounts.get(node.id) ?? 0
                  const expanded = node.id === selectedId || node.id === hoveredId
                  const isTodoNode = node.type === 'todo'
                  const hasOpenTodo = node.type === 'todo' && !node.doneAt
                  const style = {
                    left: point.x + 48,
                    top: point.y + 48,
                    height: nodeHeights.get(node.id) ?? NODE_HEIGHT,
                    '--node-color': node.color,
                    ...(agentState === 'working' ? { '--agent-working-sweep-delay': agentWorkingSweepDelay(performance.now()) } : {}),
                  } as CSSProperties
                  return (
                    <article
                      className={`map-node ${node.parentId ? 'is-reorderable' : ''} ${isTodoNode ? 'is-todo' : ''} ${hasOpenTodo ? 'is-todo-open' : ''} ${expanded ? 'is-expanded' : ''} ${selectedId === node.id ? 'is-selected' : ''} ${activeTerminalNode?.id === node.id ? 'is-terminal-active' : ''} ${agentState ? `is-agent-${agentState}` : ''} ${activityFade !== 'fresh' ? `is-activity-${activityFade}` : ''} ${draggedId === node.id ? 'is-dragging' : ''} ${dropTarget?.id === node.id ? `drop-${dropTarget.position}` : ''}`}
                      key={node.id}
                      style={style}
                      data-node-id={node.id}
                      onMouseEnter={() => { if (!nodeDragRef.current && settings['mindmap.expandOnHover']) setHoveredId(node.id) }}
                      onMouseLeave={() => { if (!nodeDragRef.current) setHoveredId((current) => current === node.id ? null : current) }}
                      onPointerDown={(event) => beginNodeReorder(event, node)}
                      onPointerMove={moveNodeReorder}
                      onPointerUp={endNodeReorder}
                      onPointerCancel={cancelNodeReorder}
                      onContextMenu={(event) => openNodeContextMenu(event, node)}
                    >
                      <button
                        className="node-select"
                        type="button"
                        onClick={() => { if (!suppressNodeClick.current) selectNode(node) }}
                        onDoubleClick={(event) => { event.preventDefault(); startRename(node) }}
                      >
                        <span className="node-color" />
                        <span className="node-copy">
                          {renamingId === node.id ? (
                            <input
                              className="node-rename"
                              value={renameTitle}
                              onChange={(event) => setRenameTitle(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onBlur={() => finishRename(node)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') { setRenameTitle(node.title); setRenamingId(null) }
                              }}
                              autoFocus
                            />
                          ) : <span className="node-title">{node.title}</span>}
                          {settings['mindmap.showNodeType'] && <span className="node-type">{typeLabels[node.type]}</span>}
                          {expanded && (
                            <span className="node-expanded-content">
                              {node.project && <span><b>Project</b>{node.project}</span>}
                              {node.jiraKey && <span><b>Ticket</b>{node.jiraKey}</span>}
                              {node.repoPath && <span><b>Path</b><code>{node.repoPath}</code></span>}
                              {node.note && <span><b>Note</b><em>{node.note}</em></span>}
                              {visibleAgent && <span><b>Agent</b>{agentStatusText(visibleAgent)}</span>}
                              {nodeSession && <span><b>Activity</b><time dateTime={activityTimestamp}>{activityAge === 'NOW' ? activityAge : `${activityAge} ago`}</time></span>}
                              {archivedChildCount > 0 && <span><b>Archived</b>{archivedChildCount} {archivedChildCount === 1 ? 'child' : 'children'}</span>}
                              <span><b>Terminal</b>{nodeSession ? `${nodeSession.status} · ${agentSessionSummary(nodeSession)}` : 'None'}</span>
                            </span>
                          )}
                        </span>
                        {childCount > 0 && <span className="child-count">{collapsed.has(node.id) ? '+' : childCount}</span>}
                        {hasOpenTodo && <span className="node-todo-marker" aria-label="Todo open" title="Todo" />}
                        {nodeSession && <span className="node-runtime" title={`Last activity ${new Date(activityTimestamp!).toLocaleString()}`}><time className="node-last-activity" dateTime={activityTimestamp}>{activityAge}</time><span className={`terminal-badge is-${nodeSession.status} ${visibleAgent ? `is-${visibleAgent.state}` : ''}`} title={visibleAgent ? agentStatusText(visibleAgent) : nodeSession.runtimeExists === false ? 'Terminal runtime missing' : `Terminal ${nodeSession.status}`}>{visibleAgent ? <AgentIcon kind={visibleAgent.kind} /> : '>_'}</span></span>}
                      </button>
                      {agentState === 'needs_input' && <span className="agent-needs-input-marker" role="img" aria-label={`Agent needs input for ${node.title}`} title="Agent needs input">?</span>}
                      <button className="node-add-action" type="button" onClick={() => void addChild(node)} aria-label={`Add child to ${node.title}`}>+</button>
                    </article>
                  )
                })}
              </div>
            </div>
          )}

          {contextMenu && (() => {
            const node = graph.nodes.find((candidate) => candidate.id === contextMenu.nodeId)
            if (!node) return null
            const childCount = activeGraphNodes.filter((child) => child.parentId === node.id).length
            const branchHasSession = branchHasLiveSession(activeGraphNodes, graph.sessions, node.id)
            const agentSession = graph.sessions.find((item) => item.nodeId === node.id && item.agent && item.agent.kind !== 'ssh')
            const submenuSide = contextMenu.x > window.innerWidth - 420 ? 'is-submenu-left' : 'is-submenu-right'
            const confirmingArchive = contextMenu.confirm === 'archive'
            const confirmingDelete = contextMenu.confirm === 'delete'
            return (
              <div className="node-context-menu" role="menu" aria-label={`Actions for ${node.title}`} style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
                <div className="node-context-menu-title"><span>{node.title}</span><small>{typeLabels[node.type]}</small></div>
                <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void addChild(node) }}><PlusIcon />Add child</button>
                <button type="button" role="menuitem" onClick={() => { setContextMenu(null); startRename(node) }}><Pencil2Icon />Rename</button>
                {node.parentId && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void duplicateNode(node) }}><CopyIcon />Duplicate</button>}
                {childCount > 0 && <button type="button" role="menuitem" onClick={() => { toggleNodeCollapsed(node.id); setContextMenu(null) }}>{collapsed.has(node.id) ? <ChevronDownIcon /> : <ChevronUpIcon />}{collapsed.has(node.id) ? 'Expand branch' : 'Collapse branch'}</button>}
                {node.parentId && (node.type !== 'todo' || node.doneAt) && <button type="button" role="menuitem" onClick={() => void markNodeTodo(node)}><BoxIcon />Mark todo</button>}
                {node.parentId && node.type === 'todo' && !node.doneAt && <button type="button" role="menuitem" onClick={() => void markNodeDone(node)}><CheckboxIcon />Mark done</button>}
                {agentSession && <div className={`node-context-submenu ${submenuSide}`}>
                  <button className="node-context-submenu-trigger" type="button" role="menuitem" aria-haspopup="menu"><DesktopIcon />Set agent status<ChevronRightIcon /></button>
                  <div className="node-context-submenu-panel" role="menu" aria-label={`Set agent status for ${node.title}`}>
                    <button type="button" role="menuitem" onClick={() => void setAgentStatus(agentSession.id, 'working')}><PlayIcon />Working</button>
                    <button type="button" role="menuitem" onClick={() => void setAgentStatus(agentSession.id, 'completed')}><CheckCircledIcon />Completed</button>
                    <button type="button" role="menuitem" onClick={() => void setAgentStatus(agentSession.id, 'read')}><EyeOpenIcon />Read</button>
                  </div>
                </div>}
                {node.parentId && <button className={confirmingArchive ? 'is-danger is-confirming' : ''} type="button" role="menuitem" aria-label={confirmingArchive ? `Confirm archive ${node.title}` : `Archive ${node.title}`} onClick={() => confirmingArchive ? void archiveNode(node.id) : setContextMenu((current) => current?.nodeId === node.id ? { ...current, confirm: 'archive' } : current)}><ArchiveIcon />{confirmingArchive ? contextMenuConfirmationText('archive', branchHasSession) : 'Archive'}</button>}
                {node.parentId && <button className={`is-danger ${confirmingDelete ? 'is-confirming' : ''}`} type="button" role="menuitem" aria-label={confirmingDelete ? `Confirm delete ${node.title}` : `Delete ${node.title}`} onClick={() => confirmingDelete ? void deleteNode(node.id, false) : setContextMenu((current) => current?.nodeId === node.id ? { ...current, confirm: 'delete' } : current)}><TrashIcon />{confirmingDelete ? contextMenuConfirmationText('delete', branchHasSession) : 'Delete'}</button>}
                {node.parentId && confirmingDelete && branchHasSession && <button className="is-danger is-confirming is-secondary-confirm" type="button" role="menuitem" onClick={() => void deleteNode(node.id, true)}><TrashIcon />{contextMenuStopSessionConfirmationText(branchHasSession)}</button>}
              </div>
            )
          })()}

          {settings['canvas.showLegend'] && <div className="canvas-legend"><span><i className="legend-line" /> relationship</span><span><b>&gt;_</b> terminal</span><span>drag to pan</span><span><kbd>↑↓←→</kbd> navigate</span><span><kbd>C</kbd> center</span><span><kbd>N</kbd> new node</span></div>}
        </div>

        {sidePanelOpen && rightPanel === 'details' && selected && <aside className="side-panel detail-panel" aria-label="Node details" aria-live="polite">
          <header className="side-panel-header">
            <div><span>{typeLabels[selected.type]}</span><h2>{selected.title}</h2></div>
            <div className="side-panel-actions">{hasActiveChildren && <button type="button" onClick={toggleCollapsed}>{collapsed.has(selected.id) ? 'Expand' : 'Collapse'}</button>}<button className="side-panel-close" type="button" onClick={() => setSurface((current) => ({ ...current, rightPanel: null }))} aria-label="Close node details" title="Close panel"><Cross2Icon /></button></div>
          </header>

          {deleteNodeId === selected.id && <div className="delete-choice is-prominent" role="alertdialog" aria-label={`Delete ${selected.title}`}>
            <strong>Delete this {hasChildren ? 'branch' : 'node'}?</strong>
            {branchHasSession ? <>
              <span>Choose what happens to its terminal sessions.</span>
              <button type="button" onClick={() => void deleteSelected(false)} disabled={busy}>Keep as orphan</button>
              <button className="danger-button" type="button" onClick={() => void deleteSelected(true)} disabled={busy}>Delete and stop session</button>
            </> : <>
              <span>This cannot be undone.</span>
              <button className="danger-button" type="button" onClick={() => void deleteSelected(false)} disabled={busy}>Delete {hasChildren ? 'branch' : 'node'}</button>
            </>}
            <button type="button" onClick={() => setDeleteNodeId(null)}>Cancel</button>
          </div>}

          <div className="node-editor" key={`${selected.id}-${selected.updatedAt}`}>
            <label>Title<input defaultValue={selected.title} onBlur={(event) => { if (event.target.value !== selected.title) void saveNode(selected.id, { title: event.target.value }) }} /></label>
            <label>Type<select value={selected.type} onChange={(event) => void saveNode(selected.id, { type: event.target.value as NodeType })}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <div className="node-color-field"><span>Color</span><NodeColorPicker value={selected.color} onChange={(color) => void saveNode(selected.id, { color })} /></div>
            <details className="node-context">
              <summary><span>Context</span><small>{contextCount ? `${contextCount} saved` : 'Optional'}</small></summary>
              <div className="node-context-fields">
                <label>Project<input defaultValue={selected.project ?? ''} placeholder="Optional" onBlur={(event) => { if (event.target.value !== (selected.project ?? '')) void saveNode(selected.id, { project: event.target.value }) }} /></label>
                <label>Ticket key<input defaultValue={selected.jiraKey ?? ''} placeholder="Optional" onBlur={(event) => { if (event.target.value !== (selected.jiraKey ?? '')) void saveNode(selected.id, { jiraKey: event.target.value }) }} /></label>
                <label>Repository path<input defaultValue={selected.repoPath ?? ''} placeholder="Uses allowed root" onBlur={(event) => { if (event.target.value !== (selected.repoPath ?? '')) void saveNode(selected.id, { repoPath: event.target.value }) }} /></label>
                <label>Note<textarea defaultValue={selected.note ?? ''} placeholder="Paste images or write optional context" rows={3} onPaste={(event) => void pasteNoteImage(event, selected)} onBlur={(event) => { if (event.target.value !== (selected.note ?? '')) void saveNode(selected.id, { note: event.target.value }) }} /></label>
                <NoteImagePreview note={selected.note} />
              </div>
            </details>
          </div>

          {session && (
            <>
              <SessionBindingCard session={session} />
              <AgentEventList events={session.agentEvents} />
            </>
          )}

          {selectedArchivedChildren.length > 0 && (
            <section className="node-archived-children" aria-label={`Archived children of ${selected.title}`}>
              <header><span>Archived children</span><small>{selectedArchivedChildren.length}</small></header>
              <div>
                {selectedArchivedChildren.map((child) => (
                  <article key={child.id} style={{ '--archive-color': child.color } as CSSProperties}>
                    <span aria-hidden="true" />
                    <div><strong>{child.title}</strong><small>{typeLabels[child.type]}</small></div>
                    <button type="button" onClick={() => void restoreNode(child.id)} disabled={busy}><ReloadIcon />Restore</button>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="node-commands">
            {session && session.status !== 'stopped' && session.runtimeExists !== false ? (
              <button className={`terminal-preview ${terminalSessionId === session.id ? 'is-active' : ''}`} type="button" onClick={() => openTerminal(session.id)} aria-label={`Expand terminal for ${selected.title}`} style={{ '--accent': selected.color, '--accent-soft': `color-mix(in srgb, ${selected.color} 20%, transparent)` } as CSSProperties}>
                <span className="terminal-preview-bar"><i /><i /><i /><strong>{session.agent ? agentStatusText(session.agent) : session.status} · {formatActivityAge(sessionActivityTimestamp(session))}</strong></span>
                <span className="terminal-preview-screen"><code>$ {session.backend} attach</code><code>{session.runtimeName}</code><i /></span>
                <span className="terminal-preview-footer"><strong>{selected.title}</strong><small>Click to expand ↗</small></span>
              </button>
            ) : session && canRecoverCodexSession(session) ? (
              <div className="recover-codex-card">
                <div className="recover-codex-actions">
                  <button className="attach-button recover-codex-button" type="button" onClick={() => void recoverCodexSession(session.id)} disabled={busy}>Resume Codex</button>
                  <button className="attach-button" type="button" onClick={() => void attachTerminal(true)} disabled={busy}>Start new terminal</button>
                </div>
                <small>{agentSessionSummary(session)} · {session.agent?.externalCwd ?? session.cwd}</small>
              </div>
            ) : (
              <button className="attach-button" type="button" onClick={() => void attachTerminal(Boolean(session))} disabled={busy}>{session ? 'Start new terminal' : 'Attach terminal'}</button>
            )}
            <button className="add-child-button" type="button" onClick={() => void addChild(selected)}>+ Add child node</button>
          </div>

          {selected.id !== graph.workspace.rootNodeId && (
            <details className="node-more-actions">
              <summary>More actions</summary>
              <div className="node-lifecycle-actions">
                <button type="button" onClick={() => void archiveNode(selected.id)} disabled={busy}><ArchiveIcon />Archive {hasChildren ? 'branch' : 'node'}</button>
                <button type="button" onClick={() => setDeleteNodeId(selected.id)}>Delete {hasChildren ? 'branch' : 'node'}</button>
              </div>
            </details>
          )}
        </aside>}

        {sidePanelOpen && rightPanel === 'settings' && <SettingsPanel settings={settings} platform={platform} notificationPermission={notificationPermission} onChange={setSettings} onEnableNotifications={() => void enableAgentNotifications()} onTestSystemNotification={testSystemNotification} onClose={() => setSurface((current) => ({ ...current, rightPanel: null }))} />}

        {sidePanelOpen && rightPanel === 'archive' && <ArchivePanel nodes={graph.nodes} sessions={graph.sessions} busy={busy} onRestore={(nodeId) => void restoreNode(nodeId)} onDelete={(nodeId, stopSession) => void deleteArchivedNode(nodeId, stopSession)} onClose={() => setSurface((current) => ({ ...current, rightPanel: null }))} />}

        {sidePanelOpen && rightPanel === 'sessions' && (
          <aside className="side-panel session-manager" aria-label="Terminal session manager">
            <header className="side-panel-header">
              <div><span>Runtime inventory</span><h2>MuxMap sessions</h2></div>
              <button className="side-panel-close" type="button" onClick={() => setSurface((current) => ({ ...current, rightPanel: null }))} aria-label="Close session manager" title="Close panel"><Cross2Icon /></button>
            </header>

            <section>
              <h3>Linked <span>{graph.sessions.length}</span></h3>
              {graph.sessions.length === 0 ? <p>No linked sessions.</p> : graph.sessions.map((item) => {
                const node = graph.nodes.find((candidate) => candidate.id === item.nodeId)
                const isArchived = archivedIds.has(item.nodeId)
                const visibleAgent = visibleAgentForSession(item)
                const statusText = item.runtimeExists === false
                  ? canRecoverCodexSession(item) ? 'tmux missing · Codex resume available' : 'tmux missing'
                  : visibleAgent ? agentStatusText(visibleAgent) : item.status
                return (
                  <article className={`session-row ${terminalSessionId === item.id || selected?.id === item.nodeId ? 'is-current' : ''}`} key={item.id}>
                    <div><strong>{node?.title ?? item.name}</strong><code>{item.runtimeName}</code><small className={visibleAgent ? `is-${visibleAgent.state}` : undefined}>{visibleAgent && <AgentIcon kind={visibleAgent.kind} />}{statusText}</small></div>
                    <div className="session-row-actions">
                      {isArchived ? <button type="button" onClick={() => setSurface((current) => openRightPanel(current, 'archive'))}>Archived</button> : item.status !== 'stopped' && item.runtimeExists !== false ? <button type="button" onClick={() => { setSelectedId(item.nodeId); openTerminal(item.id) }}>Open</button> : canRecoverCodexSession(item) ? <button type="button" onClick={() => { setSelectedId(item.nodeId); void recoverCodexSession(item.id) }} disabled={busy}>Resume Codex</button> : null}
                      {item.status !== 'stopped' && item.runtimeExists !== false && (confirmStopSession === `${item.backend}:${item.runtimeName}` ? (
                        <><button className="danger-button" type="button" onClick={() => void stopSession(item.id)} disabled={busy}>Confirm stop</button><button type="button" onClick={() => setConfirmStopSession(null)}>Cancel</button></>
                      ) : <button type="button" onClick={() => setConfirmStopSession(`${item.backend}:${item.runtimeName}`)}>Stop</button>)}
                    </div>
                  </article>
                )
              })}
            </section>

            <section>
              <h3>Orphan <span>{orphans.length}</span></h3>
              {orphans.length === 0 ? <p>No orphan sessions.</p> : orphans.map((orphan) => {
                const selectedHasSession = !selected || graph.sessions.some((item) => item.nodeId === selected.id && item.status !== 'stopped' && item.runtimeExists !== false)
                return (
                  <article className="session-row is-orphan" key={`${orphan.backend}:${orphan.runtimeName}`}>
                    <div><strong>{orphan.runtimeName}</strong><small className={orphan.agent ? `is-${orphan.agent.state}` : undefined}>{orphan.agent && <AgentIcon kind={orphan.agent.kind} />}{orphan.agent ? agentStatusText(orphan.agent) : `Live ${orphan.backend}`} · not linked to a node</small></div>
                    <div className="session-row-actions">
                      <button type="button" onClick={() => void adoptOrphan(orphan.backend, orphan.runtimeName, false)} disabled={busy || selectedHasSession}>Attach to selected</button>
                      <button type="button" onClick={() => void adoptOrphan(orphan.backend, orphan.runtimeName, true)} disabled={busy}>Create root node</button>
                      {confirmStopSession === `${orphan.backend}:${orphan.runtimeName}` ? (
                        <><button className="danger-button" type="button" onClick={() => void stopOrphan(orphan.backend, orphan.runtimeName)} disabled={busy}>Confirm stop</button><button type="button" onClick={() => setConfirmStopSession(null)}>Cancel</button></>
                      ) : <button type="button" onClick={() => setConfirmStopSession(`${orphan.backend}:${orphan.runtimeName}`)}>Close session</button>}
                    </div>
                  </article>
                )
              })}
            </section>
          </aside>
        )}

        {terminalDocked && <div className="terminal-splitter" role="separator" aria-label="Resize terminal" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={settings['terminal.splitPercent']} tabIndex={0} onPointerDown={beginTerminalResize} onPointerMove={resizeTerminal} onPointerUp={endTerminalResize} onPointerCancel={endTerminalResize} onDoubleClick={() => setSettings((current) => ({ ...current, 'terminal.splitPercent': 50 }))} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSettings((current) => ({ ...current, 'terminal.splitPercent': normalizeTerminalSplit(current['terminal.splitPercent'] - 2) })); if (event.key === 'ArrowRight') setSettings((current) => ({ ...current, 'terminal.splitPercent': normalizeTerminalSplit(current['terminal.splitPercent'] + 2) })) }}><span /></div>}
        {terminalDocked && terminalPanel}
      </section>

      {terminalFloating && terminalPanel}
    </main>
  )
}

export default App
