export async function readApiResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let body: unknown

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      if (!response.ok) throw new Error(`Request failed with ${response.status}`)
      throw new Error('Server returned invalid JSON')
    }
  }

  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : undefined
    throw new Error(error ?? `Request failed with ${response.status}`)
  }
  if (!text) throw new Error('Server returned an empty response')
  return body as T
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options?.body ? { 'content-type': 'application/json', ...options.headers } : options?.headers,
  })
  return readApiResponse<T>(response)
}

export async function apiText(path: string, options?: RequestInit): Promise<string> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options?.body ? { 'content-type': 'application/json', ...options.headers } : options?.headers,
  })
  const text = await response.text()
  if (!response.ok) {
    let message: string | undefined
    try {
      const body = text ? JSON.parse(text) as unknown : undefined
      message = body && typeof body === 'object' && 'error' in body ? String(body.error) : undefined
    } catch {
      message = undefined
    }
    throw new Error(message ?? `Request failed with ${response.status}`)
  }
  if (!text) throw new Error('Server returned an empty response')
  return text
}
