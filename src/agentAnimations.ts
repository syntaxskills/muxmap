export const AGENT_WORKING_SWEEP_MS = 1650

export function agentWorkingSweepPhase(nowMs: number, durationMs = AGENT_WORKING_SWEEP_MS) {
  if (!Number.isFinite(nowMs) || durationMs <= 0) return 0
  return nowMs % durationMs
}

export function agentWorkingSweepDelay(nowMs: number, durationMs = AGENT_WORKING_SWEEP_MS) {
  return `${-(agentWorkingSweepPhase(nowMs, durationMs) / 1000).toFixed(3)}s`
}

export function synchronizeAgentWorkingSweeps(root: ParentNode, nowMs: number) {
  const phase = agentWorkingSweepPhase(nowMs)
  const delay = agentWorkingSweepDelay(nowMs)
  let count = 0
  for (const element of root.querySelectorAll<HTMLElement>('.map-node.is-agent-working .node-select')) {
    count += 1
    element.style.setProperty('--agent-working-sweep-delay', delay)
    for (const animation of element.getAnimations({ subtree: true })) {
      if ((animation as CSSAnimation).animationName === 'agent-working-sweep') {
        animation.currentTime = phase
      }
    }
  }
  return count
}
