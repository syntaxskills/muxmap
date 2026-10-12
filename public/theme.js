(() => {
  const system = matchMedia('(prefers-color-scheme: dark)')
  function applyTheme() {
    let preference = 'system'
    try {
      const settings = JSON.parse(localStorage.getItem('muxmap:settings') || '{}')
      preference = settings?.['workbench.theme'] ?? settings?.workbench?.theme
    } catch {
      // Unavailable storage or invalid settings follow the system.
    }
    const theme = preference === 'light' || preference === 'dark' ? preference : system.matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c201d' : '#f7f8f5')
  }
  applyTheme()
  system.addEventListener('change', applyTheme)
  window.addEventListener('muxmap:settings-changed', applyTheme)
  window.addEventListener('storage', (event) => {
    if (event.key === 'muxmap:settings' || event.key === null) applyTheme()
  })
})()
