import { useState } from 'react'
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, useClick, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react'
import { ClipboardIcon, Cross2Icon, KeyboardIcon } from '@radix-ui/react-icons'

const shortcuts = [
  ['Esc', '\x1b', 'Escape'],
  ['Tab', '\t', 'Tab'],
  ['Enter', '\r', 'Enter'],
  ['Ctrl+C', '\x03', 'Interrupt'],
  ['Ctrl+V', '\x16', 'Send Ctrl+V to the terminal app'],
  ['Ctrl+Z', '\x1a', 'Suspend'],
  ['Ctrl+D', '\x04', 'End input'],
  ['Ctrl+L', '\x0c', 'Clear screen'],
  ['Shift+Tab', '\x1b[Z', 'Back tab'],
] as const

export function TerminalShortcuts({ disabled, onSend, onPaste }: { disabled: boolean; onSend(data: string): void; onPaste(): Promise<void> }) {
  const [open, setOpen] = useState(false)
  const { context, floatingStyles, refs } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    strategy: 'fixed',
    middleware: [offset(8), flip(), shift({ padding: 8, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  })
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  return <>
    <button {...getReferenceProps({ type: 'button', className: 'terminal-shortcuts-trigger', 'aria-label': 'Terminal shortcuts', title: 'Terminal shortcuts', disabled })} ref={refs.setReference}>
      <KeyboardIcon aria-hidden="true" />
    </button>
    {open && <FloatingPortal>
      <FloatingFocusManager context={context} modal={false}>
        <div {...getFloatingProps({ className: 'terminal-shortcuts-panel', 'aria-label': 'Terminal shortcuts', style: floatingStyles, onKeyDown: (event) => event.stopPropagation() })} ref={refs.setFloating}>
          <div className="terminal-shortcuts-heading">
            <strong>Terminal keys</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close terminal shortcuts"><Cross2Icon aria-hidden="true" /></button>
          </div>
          <p>Send keys directly to the terminal.</p>
          <div className="terminal-shortcuts-grid">
            {shortcuts.map(([label, data, description]) => <button key={label} type="button" disabled={disabled} title={description} onClick={() => onSend(data)}>{label}</button>)}
          </div>
          <button className="terminal-shortcuts-paste" type="button" disabled={disabled} onClick={() => { void onPaste().then(() => setOpen(false)) }}><ClipboardIcon aria-hidden="true" />Paste into input</button>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>}
  </>
}
