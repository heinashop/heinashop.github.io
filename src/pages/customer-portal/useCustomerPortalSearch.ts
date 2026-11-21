import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { UnifiedClient } from '../../api/client'
import type {
  CustomerLookupMatch,
  CustomerLookupResult,
  PortalConfig,
  PortalLookupMembership,
  PreorderCustomerLookupResult,
  PreorderLookupMatch,
} from '../../api/types'
import { normalizeLookupPin, isValidLookupPin } from '../../daigou/portalLookupAuth'
import { isCustomerPaymentFormDirty } from './customerFormGuard'
import { normalizePortal } from './mergePortal'

const LOOKUP_PIN_SESSION_KEY = 'heina.lookup.pin'

function parsePortalMembership(raw: unknown): PortalLookupMembership | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const tierId = String(o.tierId ?? '').trim()
  const tierLabel = String(o.tierLabel ?? '').trim()
  const benefits = Array.isArray(o.benefits) ? o.benefits.map((x) => String(x).trim()).filter(Boolean) : []
  if (!tierLabel || benefits.length === 0) return null
  return {
    tierId: tierId || 'regular',
    tierLabel,
    benefits,
    tierLocked: Boolean(o.tierLocked),
  }
}

function readSavedLookupPin(): string {
  try {
    return normalizeLookupPin(sessionStorage.getItem(LOOKUP_PIN_SESSION_KEY) || '')
  } catch {
    return ''
  }
}

function saveLookupPin(pin: string) {
  try {
    const n = normalizeLookupPin(pin)
    if (isValidLookupPin(n)) sessionStorage.setItem(LOOKUP_PIN_SESSION_KEY, n)
  } catch {
    /* ignore */
  }
}

export function useCustomerPortalSearch(api: UnifiedClient) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q')?.trim() || ''
  const lastSyncedUrlQueryRef = useRef('')
  const resumeHandledRef = useRef(false)

  const [portal, setPortal] = useState<PortalConfig>(() => normalizePortal({}))
  const [query, setQuery] = useState(urlQuery)
  const [lookupPin, setLookupPin] = useState(() => readSavedLookupPin())
  const [matchesGroupbuy, setMatchesGroupbuy] = useState<CustomerLookupMatch[]>([])
  const [matchesPreorder, setMatchesPreorder] = useState<PreorderLookupMatch[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [membership, setMembership] = useState<PortalLookupMembership | null>(null)
  const [autoSync, setAutoSync] = useState<'idle' | 'checking' | 'updated' | 'error'>('idle')
  const revisionRef = useRef(0)
  const autoSyncBusyRef = useRef(false)

  const loadInitialPortal = useCallback(() => {
    void api
      .call<CustomerLookupResult>({
        module: 'groupbuy',
        action: 'customerLookup',
        payload: { customerName: '' },
      })
      .then((res) => setPortal(normalizePortal(res.portalConfig)))
      .catch(() => {})
  }, [api])

  useEffect(() => {
    loadInitialPortal()
  }, [loadInitialPortal])

  const performSearch = useCallback(
    async (q: string, pin: string, opts?: { expandOrderId?: string; silent?: boolean }) => {
      const silent = !!opts?.silent
      if (!silent) {
        setError('')
        setSearched(true)
        setLoading(true)
        setMatchesGroupbuy([])
        setMatchesPreorder([])
        setExpandedId(null)
        setMembership(null)
        setAutoSync('idle')
      }

      const pinNorm = normalizeLookupPin(pin)
      if (!isValidLookupPin(pinNorm)) {
        if (!silent) {
          setError('請輸入 4 位數查詢密碼')
          setLoading(false)
        }
        return
      }

      try {
        saveLookupPin(pinNorm)
        const lookupPayload = { customerName: q, lookupPin: pinNorm }
        const [gbRes, poRes] = await Promise.allSettled([
          api.call<CustomerLookupResult>({
            module: 'groupbuy',
            action: 'customerLookup',
            payload: lookupPayload,
          }),
          api.call<PreorderCustomerLookupResult>({
            module: 'preorder',
            action: 'customerLookup',
            payload: lookupPayload,
          }),
        ])

        let membershipNext: PortalLookupMembership | null = null
        let lookupErrors: string[] = []

        if (gbRes.status === 'fulfilled') {
          const gbVal = gbRes.value
          const revision = Number(gbVal.dataRevision || '0')
          if (Number.isFinite(revision) && revision > revisionRef.current) revisionRef.current = revision
          if (gbVal.lookupError) lookupErrors.push(gbVal.lookupError)
          else setMatchesGroupbuy(gbVal.matches || [])
          membershipNext = parsePortalMembership(gbVal.membership) ?? membershipNext
        } else {
          if (!silent) setMatchesGroupbuy([])
        }

        if (poRes.status === 'fulfilled') {
          const poVal = poRes.value
          if (poVal.lookupError) lookupErrors.push(poVal.lookupError)
          else setMatchesPreorder(poVal.matches || [])
          if (!membershipNext) {
            membershipNext = parsePortalMembership(poVal.membership)
          }
        } else {
          setMatchesPreorder([])
        }
        setMembership(membershipNext)

        setPortal((prev) => {
          let next = prev
          if (gbRes.status === 'fulfilled') {
            next = normalizePortal({ ...next, ...(gbRes.value.portalConfig as object) })
          }
          if (poRes.status === 'fulfilled') {
            next = normalizePortal({ ...next, ...(poRes.value.portalConfig as object) })
          }
          return next
        })

        const uniqueLookupErrors = [...new Set(lookupErrors)]
        if (uniqueLookupErrors.length === 2 || (uniqueLookupErrors.length === 1 && lookupErrors.length >= 1)) {
          setError(uniqueLookupErrors[0])
        }

        const errs: string[] = []
        if (gbRes.status === 'rejected') errs.push('團購查詢失敗')
        if (poRes.status === 'rejected') errs.push('預購查詢失敗')
        if (errs.length === 2 && !uniqueLookupErrors.length) {
          setError(
            gbRes.status === 'rejected' && gbRes.reason instanceof Error
              ? gbRes.reason.message
              : '查詢失敗，請稍後再試。',
          )
        } else if (errs.length === 1 && !uniqueLookupErrors.length) {
          setError(`${errs[0]}；另一管道仍可顯示。請稍後再試或聯絡客服。`)
        }

        const expandId = String(opts?.expandOrderId || '').trim()
        if (expandId && !uniqueLookupErrors.length) {
          setExpandedId(expandId)
        }
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : '查詢失敗，請稍後再試。')
      } finally {
        setLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    if (!searched) return
    const q = query.trim()
    if (!q) return
    let stopped = false
    const check = async (force = false) => {
      if (stopped || autoSyncBusyRef.current) return
      if (!force && document.visibilityState !== 'visible') return
      if (isCustomerPaymentFormDirty()) return
      autoSyncBusyRef.current = true
      try {
        const res = await api.call<{ dataRevision: string }>({
          module: 'groupbuy',
          action: 'publicRevision',
          payload: {},
        })
        const latest = Number(res.dataRevision || '0')
        if (!stopped && Number.isFinite(latest) && latest > revisionRef.current) {
          setAutoSync('checking')
          await performSearch(q, lookupPin, { silent: true })
        }
      } catch {
        if (!stopped) setAutoSync('error')
      } finally {
        autoSyncBusyRef.current = false
      }
    }
    const timer = window.setInterval(() => void check(), 20000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const onFocus = () => void check(true)
    window.addEventListener('focus', onFocus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, performSearch, query, lookupPin, searched])

  const syncQueryToUrl = useCallback(
    (q: string) => {
      lastSyncedUrlQueryRef.current = q
      if (q) {
        setSearchParams({ q }, { replace: true })
      } else {
        setSearchParams({}, { replace: true })
      }
    },
    [setSearchParams],
  )

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) {
      setError('請輸入查詢名稱')
      return
    }
    syncQueryToUrl(q)
    await performSearch(q, lookupPin)
  }, [query, lookupPin, performSearch, syncQueryToUrl])

  const resetToHome = useCallback(() => {
    setQuery('')
    setLookupPin(readSavedLookupPin())
    setMatchesGroupbuy([])
    setMatchesPreorder([])
    setExpandedId(null)
    setError('')
    setSearched(false)
    setMembership(null)
    setLoading(false)
    setAutoSync('idle')
    resumeHandledRef.current = false
    syncQueryToUrl('')
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [syncQueryToUrl])

  useEffect(() => {
    const q = searchParams.get('q')?.trim() || ''
    if (q === lastSyncedUrlQueryRef.current) return
    lastSyncedUrlQueryRef.current = q
    setQuery(q)
  }, [searchParams])

  /** 從開團詳情「返回」：還原查詢結果並展開原本的訂單小卡 */
  useEffect(() => {
    const q = searchParams.get('q')?.trim() || ''
    const resume = searchParams.get('resume') === '1'
    const orderId = searchParams.get('order')?.trim() || ''
    if (!q || !resume || resumeHandledRef.current) return
    resumeHandledRef.current = true

    const pin = readSavedLookupPin() || normalizeLookupPin(lookupPin)
    setQuery(q)
    if (isValidLookupPin(pin)) setLookupPin(pin)

    void (async () => {
      if (!isValidLookupPin(pin)) {
        setError('請輸入查單密碼後再查詢，即可回到訂單列表')
        setSearched(false)
        return
      }
      await performSearch(q, pin, { expandOrderId: orderId || undefined })
      const next = new URLSearchParams()
      next.set('q', q)
      if (orderId) next.set('order', orderId)
      lastSyncedUrlQueryRef.current = q
      setSearchParams(next, { replace: true })
      requestAnimationFrame(() => {
        document.getElementById('order-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })()
  }, [searchParams, lookupPin, performSearch, setSearchParams])

  const totalMatches = matchesGroupbuy.length + matchesPreorder.length

  return {
    portal,
    query,
    setQuery,
    lookupPin,
    setLookupPin,
    matchesGroupbuy,
    matchesPreorder,
    totalMatches,
    expandedId,
    setExpandedId,
    loading,
    error,
    searched,
    search,
    resetToHome,
    loadInitialPortal,
    membership,
    autoSync,
  }
}
