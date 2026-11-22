/** Prefer the replacement backend; leave unset during migration to keep the current live API. */
export function backendApiUrl(): string {
  const value = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  if (!value) return ''
  const url = new URL(value)
  const local = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/api') {
    throw new Error('VITE_API_URL 必須是 HTTPS 後端 /api 網址')
  }
  return url.href
}
