export type SystemNotificationResult = 'sent' | 'permission-denied' | 'unsupported' | 'failed'

export type SystemNotificationClient = {
  readonly permission: NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  new(title: string, options?: NotificationOptions): {
    onclick: ((event: Event) => void) | null
    close(): void
  }
}

export async function sendTestSystemNotification(client: SystemNotificationClient | undefined, onClick?: () => void): Promise<SystemNotificationResult> {
  if (!client) return 'unsupported'

  try {
    const permission = client.permission === 'default' ? await client.requestPermission() : client.permission
    if (permission !== 'granted') return 'permission-denied'

    const notification = new client('MuxMap system notification', {
      body: 'System notifications are working. Agent alerts will appear here.',
      icon: '/favicon.svg',
      tag: 'muxmap-notification-test',
    })
    notification.onclick = () => {
      onClick?.()
      notification.close()
    }
    return 'sent'
  } catch {
    return 'failed'
  }
}

export function systemNotificationResultText(result: SystemNotificationResult) {
  if (result === 'sent') return 'Test sent — check your system notification center.'
  if (result === 'permission-denied') return 'Notifications are blocked. Allow them in your browser site settings.'
  if (result === 'unsupported') return 'System notifications are unavailable in this browser.'
  return 'The browser could not send the test notification.'
}
