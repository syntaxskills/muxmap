import { useRef } from 'react'
import { nodeColorFamilies } from './nodeColors.ts'

type Props = {
  value: string
  onChange(value: string): void
}

export function NodeColorPicker({ value, onChange }: Props) {
  const details = useRef<HTMLDetailsElement>(null)
  const choose = (color: string) => {
    onChange(color)
    details.current?.removeAttribute('open')
  }

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
      <label className="node-color-custom"><span>Custom</span><code>{value.toUpperCase()}</code><input type="color" value={value} onChange={(event) => choose(event.target.value)} /></label>
    </div>
  </details>
}
