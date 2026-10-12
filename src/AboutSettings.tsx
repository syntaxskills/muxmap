import { useState } from 'react'
import { checkForUpdates, repositoryUrl, type UpdateCheck } from './updates.ts'

declare const __MUXMAP_BUILD__: { version: string; commit: string | null; dirty: boolean }

export function AboutSettings() {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheck | null>(null)
  const [error, setError] = useState('')
  const { version, commit, dirty } = __MUXMAP_BUILD__

  async function check() {
    setChecking(true)
    setResult(null)
    setError('')
    try {
      setResult(await checkForUpdates(commit))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to check for updates.')
    } finally {
      setChecking(false)
    }
  }

  return <section className="settings-about" aria-label="About MuxMap">
    <div><h3>MuxMap</h3><p>A mindmap workspace for your terminals and developer context.</p></div>
    <dl>
      <div><dt>Version</dt><dd>{version}</dd></div>
      <div><dt>Build</dt><dd>{commit ? <a href={`${repositoryUrl}/commit/${commit}`} target="_blank" rel="noreferrer">{commit.slice(0, 7)}</a> : 'Unknown'}{dirty && ' · local changes'}</dd></div>
    </dl>
    <a href={repositoryUrl} target="_blank" rel="noreferrer">View on GitHub ↗</a>
    <div className="settings-update">
      <strong>Updates</strong>
      <p>Compare this build with the latest code on GitHub (main).</p>
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? 'Checking GitHub…' : 'Check for updates'}</button>
      <p role="status" aria-live="polite">{checking ? 'Checking GitHub…' : error || result?.message}</p>
      {result && result.status !== 'current' && <a href={result.url} target="_blank" rel="noreferrer">Review changes on GitHub ↗</a>}
      {dirty && <p>Update checks compare the committed build; local changes are not included.</p>}
    </div>
  </section>
}
