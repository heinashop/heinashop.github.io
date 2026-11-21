import type { UnifiedClient } from '../api/client'
import type { GroupBuyAppData, UnifiedRequest } from '../api/types'
import { attachAdminToken } from '../auth/attachAdminToken'
import { gasWebAppUrl, hasRemoteGas } from '../config/gasEndpoint'
import { noteAppliedRevision } from '../sync/sheetSync'

export { hasRemoteGas }

type GasEnvelope<T> = {
  ok?: boolean
  result?: T
  error?: string
}

function unwrap<T>(data: unknown): T {
  if (!data || typeof data !== 'object') {
    throw new Error('Apps Script 回應無效')
  }
  const env = data as GasEnvelope<T>
  if (env.ok === false) throw new Error(env.error || 'Apps Script 錯誤')
  if (env.ok === true && 'result' in env) return env.result as T
  return data as T
}

function parseEnvelope<T>(text: string): T {
  const trimmed = text.replace(/^\)\]\}',?\s*/, '').trim()
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error('Apps Script 回傳了網頁而不是資料。請確認 Web App 已重新部署，且存取權為「任何人」。')
  }
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    throw new Error('Apps Script 回應不是 JSON')
  }
  return unwrap<T>(data)
}

async function postCall<T>(url: string, req: UnifiedRequest): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(req),
    redirect: 'follow',
    credentials: 'omit',
  })
  const text = await res.text()
  return parseEnvelope<T>(text)
}

function jsonpCall<T>(url: string, req: UnifiedRequest): Promise<T> {
  const payload = JSON.stringify(req)
  const callback = `heina_cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const joiner = url.includes('?') ? '&' : '?'
  const src = `${url}${joiner}callback=${encodeURIComponent(callback)}&payload=${encodeURIComponent(payload)}`
  if (src.length > 7000) {
    return Promise.reject(
      new Error('跨網域要求過大，且 POST 被瀏覽器擋住。請確認 Apps Script 部署為「任何人」可存取後再試。'),
    )
  }
  return new Promise((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Apps Script 回應逾時'))
    }, 45000)
    function cleanup() {
      window.clearTimeout(timer)
      delete w[callback]
      script.remove()
    }
    w[callback] = (data: unknown) => {
      cleanup()
      try {
        resolve(unwrap<T>(data))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    script.onerror = () => {
      cleanup()
      reject(new Error('無法連線 Apps Script'))
    }
    script.src = src
    document.head.appendChild(script)
  })
}

function shouldTryJsonp(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /failed to fetch|network|cors|load failed/i.test(msg)
}

/**
 * JSONP puts the request into the URL. Only public, read-only actions are
 * allowed to fall back to it; credentials, PINs and payment data must use POST.
 */
export function canUseJsonp(req: UnifiedRequest): boolean {
  if (req.adminToken) return false
  if (req.module !== 'groupbuy') return false
  return (
    req.action === 'publicRevision' ||
    req.action === 'publicBootstrap' ||
    req.action === 'listPublicGroups'
  )
}

const APP_DATA_MUTATIONS = new Set([
  'saveAppData',
  'saveBankJournal',
  'deleteBankJournalRows',
  'restoreBankJournalRows',
  'syncPortalLookupCustomers',
  'confirmPaymentReport',
  'deletePaymentReport',
  'revertPaymentReport',
  'updatePaymentReportLineFlags',
  'supplementPaymentReport',
  'importDataPack',
  'changeLookupPin',
])

type AppDataCache = { revision: string; data: GroupBuyAppData }

let appDataCache: AppDataCache | null = null
let lastDataRevision: string | null = null
let appDataFlight: Promise<GroupBuyAppData> | null = null
let publicGroupsCache: { at: number; data: unknown } | null = null
let mutationFlight = false

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  return payload as Record<string, unknown>
}

export function mergeCachedSlice(slice: {
  dataRevision?: string
  groups?: Array<{ id: string; orders?: Array<{ id: string }> }>
  paymentReports?: unknown[]
  bankJournal?: unknown[]
}) {
  if (slice.dataRevision != null) {
    lastDataRevision = String(slice.dataRevision)
    noteAppliedRevision(lastDataRevision)
  }
  if (!appDataCache) return
  const data = appDataCache.data
  if (slice.groups) {
    const map = new Map((data.groups || []).map((group) => [group.id, { ...group, orders: [...(group.orders || [])] }]))
    for (const group of slice.groups as GroupBuyAppData['groups']) {
      const current = map.get(group.id)
      if (!current) {
        map.set(group.id, group)
        continue
      }
      const orders = [...(current.orders || [])]
      for (const order of group.orders || []) {
        const index = orders.findIndex((item) => item.id === order.id)
        if (index >= 0) orders[index] = { ...orders[index], ...order }
        else orders.push(order)
      }
      map.set(group.id, { ...current, ...group, orders })
    }
    data.groups = [...map.values()]
  }
  if (slice.paymentReports) data.paymentReports = slice.paymentReports as GroupBuyAppData['paymentReports']
  if (slice.bankJournal) data.bankJournal = slice.bankJournal as GroupBuyAppData['bankJournal']
  appDataCache = { revision: lastDataRevision || appDataCache.revision, data }
}

export function createGasHttpClient(): UnifiedClient {
  const url = gasWebAppUrl()
  return {
    async call<T>(req: UnifiedRequest): Promise<T> {
      if (!url) throw new Error('尚未設定 VITE_GAS_URL')
      const readApp = req.module === 'groupbuy' && req.action === 'getAppData'
      const fresh = Boolean(payloadRecord(req.payload)?.fresh)
      const publicList = req.module === 'groupbuy' && req.action === 'listPublicGroups'
      const mutate = req.module === 'groupbuy' && APP_DATA_MUTATIONS.has(req.action)

      if (readApp && !fresh && appDataCache) return appDataCache.data as T
      if (readApp && !fresh && appDataFlight) return appDataFlight as Promise<T>
      if (publicList && publicGroupsCache && Date.now() - publicGroupsCache.at < 60_000) {
        return publicGroupsCache.data as T
      }
      if (mutate && mutationFlight) {
        throw new Error('上一筆儲存還沒完成，請稍候再按')
      }

      let bodyReq = attachAdminToken(req)
      if (mutate) {
        const revision = lastDataRevision || appDataCache?.revision || ''
        if (!revision) throw new Error('缺少資料版本，請重新載入後再儲存')
        bodyReq = {
          ...bodyReq,
          payload: { ...(payloadRecord(bodyReq.payload) || {}), dataRevision: revision },
        }
      }
      if (mutate) mutationFlight = true

      const run = (async () => {
        try {
          let data: T
          try {
            data = await postCall<T>(url, bodyReq)
          } catch (err) {
            if (!canUseJsonp(bodyReq) || !shouldTryJsonp(err)) throw err
            data = await jsonpCall<T>(url, bodyReq)
          }
          if (readApp) {
            const packed = data as GroupBuyAppData
            const incomingRevision = String(packed.dataRevision ?? '0')
            const knownRevision = lastDataRevision
            const stale =
              knownRevision != null &&
              Number.isFinite(Number(incomingRevision)) &&
              Number.isFinite(Number(knownRevision)) &&
              Number(incomingRevision) < Number(knownRevision)
            if (stale) {
              if (appDataCache) return appDataCache.data as T
              const retry = await postCall<T>(url, bodyReq)
              const retryPacked = retry as GroupBuyAppData
              const retryRevision = String(retryPacked.dataRevision ?? '0')
              if (Number(retryRevision) < Number(knownRevision || '0')) {
                throw new Error('伺服器回傳的資料版本較舊，請重新載入')
              }
              lastDataRevision = retryRevision
              noteAppliedRevision(lastDataRevision)
              appDataCache = { revision: lastDataRevision, data: retryPacked }
              return retry
            }
            lastDataRevision = incomingRevision
            noteAppliedRevision(lastDataRevision)
            appDataCache = { revision: lastDataRevision, data: packed }
          }
          if (publicList) publicGroupsCache = { at: Date.now(), data }
          if (mutate) {
            const saved = data as { dataRevision?: string }
            if (saved && saved.dataRevision != null) {
              lastDataRevision = String(saved.dataRevision)
              noteAppliedRevision(lastDataRevision)
            }
            appDataCache = null
            appDataFlight = null
            publicGroupsCache = null
          }
          return data
        } finally {
          if (mutate) mutationFlight = false
          if (readApp) appDataFlight = null
        }
      })()

      if (readApp && !fresh) appDataFlight = run as Promise<GroupBuyAppData>
      return run
    },
  }
}
