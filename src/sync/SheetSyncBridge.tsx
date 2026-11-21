import { useEffect, useRef, useState } from 'react'
import { useApi } from '../context/useApi'
import { isAdminSessionValid } from '../auth/adminSession'
import { mergeCachedSlice } from '../adapters/gasHttp'
import { syncV50GroupOrdersToDaigou } from '../modules/groupbuy/v50DaigouSync'
import type { GroupBuyGroup } from '../api/types'
import {
  appliedRevisionNumber,
  isLatestTicket,
  isSheetEditing,
  nextSyncTicket,
  publishSheetChange,
  subscribeSheetChange,
  type SheetChange,
  type SheetSlice,
  type SyncState,
} from './sheetSync'

function describe(state: SyncState, message: string) {
  if (state === 'syncing') return '同步中'
  if (state === 'error') return message || '同步失敗'
  if (state === 'conflict') return message || '版本衝突，請先處理這頁尚未儲存的修改'
  if (state === 'paused') return message || '有未儲存的修改，暫停背景同步'
  return ''
}

export function useRemoteSlice(apply: (slice: SheetSlice) => void) {
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => subscribeSheetChange((slice) => applyRef.current(slice)), [])
}

export function SheetSyncBridge() {
  const api = useApi()
  const [state, setState] = useState<SyncState>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ state: SyncState; message?: string }>).detail
      if (!detail) return
      setState(detail.state)
      setMessage(detail.message || '')
    }
    window.addEventListener('heina-sync-status', onStatus)
    return () => window.removeEventListener('heina-sync-status', onStatus)
  }, [])

  useEffect(() => {
    const stop = subscribeSheetChange((slice) => {
      if (Number(slice.dataRevision) < appliedRevisionNumber()) return
      if (isSheetEditing()) {
        setState('conflict')
        setMessage('有未儲存的修改，沒有覆蓋')
        return
      }
      mergeCachedSlice(slice)
      for (const group of slice.groups || []) syncV50GroupOrdersToDaigou(group as GroupBuyGroup)
      setState('idle')
      setMessage('')
    })
    return stop
  }, [])

  useEffect(() => {
    let timer = 0
    const poll = async () => {
      if (!isAdminSessionValid()) return
      if (isSheetEditing()) {
        const mineEditing = nextSyncTicket()
        try {
          const peek = await api.call<{ dataRevision: string; changes: SheetChange[] }>({
            module: 'groupbuy',
            action: 'peekRevision',
          })
          if (!isLatestTicket(mineEditing)) return
          if (Number(peek.dataRevision) > appliedRevisionNumber()) {
            setState('conflict')
            setMessage('另一個畫面已更新資料；本頁有未儲存的修改，背景同步已暫停，沒有覆蓋編輯')
          } else {
            setState('paused')
            setMessage('有未儲存的修改，暫停背景同步')
          }
        } catch (error) {
          if (isLatestTicket(mineEditing)) {
            setState('paused')
            setMessage('有未儲存的修改，暫時無法確認遠端版本')
          }
        }
        return
      }
      const mine = nextSyncTicket()
      const started = Date.now()
      setState('syncing')
      try {
        const peek = await api.call<{ dataRevision: string; changes: SheetChange[] }>({
          module: 'groupbuy',
          action: 'peekRevision',
        })
        if (!isLatestTicket(mine)) return
        if (Number(peek.dataRevision) <= appliedRevisionNumber()) {
          setState('idle')
          setMessage('')
          return
        }
        const newer = (peek.changes || []).filter((change) => Number(change.rev) > appliedRevisionNumber())
        const groupIds = [...new Set(newer.flatMap((change) => change.groupIds || []))]
        const orderIds = [...new Set(newer.flatMap((change) => change.orderIds || []))]
        const slice = await api.call<SheetSlice>({
          module: 'groupbuy',
          action: 'fetchSlice',
          payload: { groupIds, orderIds },
        })
        if (!isLatestTicket(mine) || Number(slice.dataRevision) < appliedRevisionNumber()) return
        publishSheetChange(slice)
        setState('idle')
        setMessage(`已同步版本 ${slice.dataRevision}，${Date.now() - started} 毫秒`)
      } catch (error) {
        if (!isLatestTicket(mine)) return
        setState('error')
        setMessage(error instanceof Error ? error.message : '同步失敗')
      }
    }
    timer = window.setInterval(() => void poll(), 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [api])

  const text = describe(state, message)
  if (!text) return null
  return (
    <div role="status" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 40, background: '#fff', border: '1px solid #d6d3d1', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
      {text}
    </div>
  )
}
