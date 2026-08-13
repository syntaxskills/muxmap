import { useEffect, useRef, useState } from 'react'
import { nodeColorFamilies } from './nodeColors.ts'
import { forgetRecentNodeColor, recentNodeColorsFromJson, recentNodeColorsStorageKey, rememberRecentNodeColor } from './recentNodeColors.ts'

type Props = {
  value: string
  onChange(value: string): void
}

function loadRecentColors() {
  try {
    return recentNodeColorsFromJson(window.localStorage.getItem(recentNodeColorsStorageKey))
  } catch {
    return []
  }
}

function storeRecentColors(colors: string[]) {
  try {
    window.localStorage.setItem(recentNodeColorsStorageKey, JSON.stringify(colors))
  } catch {
    // Recent colors are a convenience; the picker still works without storage.
  }
}

export function NodeColorPicker({ value, onChange }: Props) {
  const details = useRef<HTMLDetailsElement>(null)
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentColors)
  useEffect(() => {
    storeRecentColors(recentColors)
  }, [recentColors])

  const choose = (color: string) => {
    onChange(color)
    details.current?.removeAttribute('open')
  }
  const chooseCustom = (color: string) => {
    const next = rememberRecentNodeColor(recentColors, color)
    setRecentColors(next)
    choose(next[0] ?? color)
  }
  const removeRecent = (color: string) => setRecentColors((current) => forgetRecentNodeColor(current, color))
  const clearRecent = () => setRecentColors([])

  return <details className="node-color-picker" ref={details}>
    <summary><i style={{ backgroundColor: value }} /><code>{value.toUpperCase()}</code><span className="color-change">Change</span><span className="color-done">Done</span></summary>
    <div className="node-color-menu">
      <div className="node-color-presets" role="radiogroup" aria-label="Preset node colors">
        {nodeColorFamilies.map((family) => <div className="node-color-family" key={family.name}>
          <span>{family.name}</span>
          {family.colors.map((color, index) => <button
            className={`node-color-swatch ${value.toLowerCase() === color ? 'is-selected' : ''}`}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={`${family.name} shade ${index + 1}`}
            title={`${family.name} shade ${index + 1}`}
            style={{ backgroundColor: color }}
            onClick={() => choose(color)}
            key={color}
          />)}
        </div>)}
      </div>
      <section className="node-color-recents" aria-label="Recent custom node colors">
        <header><span>Recent custom</span>{recentColors.length > 0 && <button type="button" onClick={clearRecent}>Clear</button>}</header>
        {recentColors.length > 0 ? <div className="node-color-recent-list">
          {recentColors.map((color) => <span className="node-color-recent" key={color}>
            <button
              className={`node-color-swatch ${value.toLowerCase() === color ? 'is-selected' : ''}`}
              type="button"
              aria-label={`Use recent custom color ${color.toUpperCase()}`}
              title={`Use ${color.toUpperCase()}`}
              style={{ backgroundColor: color }}
              onClick={() => chooseCustom(color)}
            />
            <button className="node-color-remove" type="button" aria-label={`Remove recent custom color ${color.toUpperCase()}`} title="Remove recent color" onClick={() => removeRecent(color)}>×</button>
          </span>)}
        </div> : <p>No custom colors yet.</p>}
      </section>
      <label className="node-color-custom"><span>Custom</span><code>{value.toUpperCase()}</code><input type="color" value={value} onChange={(event) => chooseCustom(event.target.value)} /></label>
    </div>
  </details>
}
