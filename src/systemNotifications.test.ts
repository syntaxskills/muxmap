import assert from 'node:assert/strict'
import test from 'node:test'
import { sendTestSystemNotification } from './systemNotifications.ts'

test('the settings notification test requests permission and sends an OS-level browser notification', async () => {
  const sent: Array<{ title: string; options?: NotificationOptions }> = []
  class FakeNotification {
    static permission: NotificationPermission = 'default'
    static async requestPermission() {
      FakeNotification.permission = 'granted'
      return FakeNotification.permission
    }
    onclick: ((event: Event) => void) | null = null
    close() {}
    constructor(title: string, options?: NotificationOptions) {
      sent.push({ title, options })
    }
  }

  assert.equal(await sendTestSystemNotification(FakeNotification), 'sent')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.title, 'MuxMap system notification')
  assert.match(sent[0]?.options?.body ?? '', /notifications are working/i)
  assert.equal(sent[0]?.options?.tag, 'muxmap-notification-test')
})

test('the settings notification test explains blocked and unsupported notification APIs', async () => {
  class BlockedNotification {
    static permission: NotificationPermission = 'denied'
    static async requestPermission() { return BlockedNotification.permission }
    onclick: ((event: Event) => void) | null = null
    close() {}
    constructor() { throw new Error('must not construct') }
  }

  assert.equal(await sendTestSystemNotification(BlockedNotification), 'permission-denied')
  assert.equal(await sendTestSystemNotification(undefined), 'unsupported')
})
