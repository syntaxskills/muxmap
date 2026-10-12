export const repositoryUrl = 'https://github.com/syntaxskills/muxmap'

export type UpdateCheck = { status: 'current' | 'available' | 'ahead' | 'diverged'; message: string; url: string }

export async function checkForUpdates(commit: string | null): Promise<UpdateCheck> {
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('This build has no Git commit information. Check GitHub for the latest code.')
  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/syntaxskills/muxmap/compare/${commit}...main?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('Unable to reach GitHub. Check your connection and try again.')
  }
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests. Try again later or check GitHub directly.')
  if (response.status === 404) throw new Error('This build’s commit is not available on GitHub. Open the repository to check for updates.')
  if (!response.ok) throw new Error(`GitHub update check failed (${response.status}). Try again.`)
  const result = await response.json()
  const url = `${repositoryUrl}/compare/${commit}...main`
  switch (result?.status) {
    case 'identical': return { status: 'current', message: 'You’re up to date with main on GitHub.', url }
    case 'ahead': return { status: 'available', message: 'An update is available on GitHub.', url }
    case 'behind': return { status: 'ahead', message: 'This build is ahead of main on GitHub.', url }
    case 'diverged': return { status: 'diverged', message: 'This build and main have different changes. Review them on GitHub.', url }
    default: throw new Error('GitHub returned an unexpected response. Try again.')
  }
}
