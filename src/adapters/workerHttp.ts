import type { UnifiedRequest } from '../api/types'
import { createGasHttpClient } from './gasHttp'
import { backendApiUrl } from '../config/backendEndpoint'

export async function workerPost<T>(url: string, request: UnifiedRequest): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60000),
    })
  } catch {
    throw new Error('後端連線中斷或逾時。請重新載入確認儲存結果，再決定是否重試。')
  }
  let data: { ok?: boolean; result?: T; error?: string }
  try { data = await response.json() } catch { throw new Error('後端回應無效，請檢查 API 網址') }
  if (!response.ok || data.ok !== true || !('result' in data)) throw new Error(data.error || '後端操作失敗')
  return data.result as T
}

export function createWorkerHttpClient() {
  return createGasHttpClient({ url: backendApiUrl(), send: workerPost, allowJsonp: false })
}
