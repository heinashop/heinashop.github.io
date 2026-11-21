export type SyncState = 'idle' | 'syncing' | 'error' | 'conflict' | 'paused'

export type SheetChange = { rev: string; orderIds?: string[]; groupIds?: string[]; at?: number }

export type SheetSlice = {
  dataRevision: string
  groups?: Array<{ id: string; orders?: Array<{ id: string }> }>
  paymentReports?: unknown[]
  bankJournal?: unknown[]
}

export function mergeGroupList<T extends { id: string; orders?: Array<{ id: string }> }>(prev: T[], incoming: T[]): T[] {
  const map = new Map<string, T>(
    prev.map((group) => [group.id, { ...group, orders: [...(group.orders || [])] } as T]),
  )
  for (const group of incoming) {
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
    map.set(group.id, { ...current, ...group, orders } as T)
  }
  return [...map.values()]
}

let editing = false
let appliedRevision = 0
let ticket = 0

export function setSheetEditing(value: boolean) {
  editing = value
  window.dispatchEvent(new CustomEvent('heina-sync-status', { detail: { state: value ? 'paused' : 'idle', message: value ? '有未儲存的修改，暫停背景同步' : '' } }))
}

export function isSheetEditing() {
  return editing
}

export function noteAppliedRevision(revision: string | number | null | undefined) {
  const next = Number(revision)
  if (!Number.isFinite(next)) return
  if (next >= appliedRevision) appliedRevision = next
}

export function appliedRevisionNumber() {
  return appliedRevision
}

export function nextSyncTicket() {
  ticket += 1
  return ticket
}

export function isLatestTicket(value: number) {
  return value === ticket
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('heina-sheet-sync') : null

export function publishSheetChange(slice: SheetSlice) {
  noteAppliedRevision(slice.dataRevision)
  channel?.postMessage(slice)
  window.dispatchEvent(new CustomEvent('heina-remote-change', { detail: slice }))
}

export function subscribeSheetChange(listener: (slice: SheetSlice) => void) {
  const onWindow = (event: Event) => {
    const slice = (event as CustomEvent<SheetSlice>).detail
    if (!slice || Number(slice.dataRevision) < appliedRevisionNumber()) return
    listener(slice)
  }
  const onChannel = (event: MessageEvent<SheetSlice>) => {
    const slice = event.data
    if (!slice || Number(slice.dataRevision) < appliedRevisionNumber()) return
    listener(slice)
  }
  window.addEventListener('heina-remote-change', onWindow)
  channel?.addEventListener('message', onChannel)
  return () => {
    window.removeEventListener('heina-remote-change', onWindow)
    channel?.removeEventListener('message', onChannel)
  }
}
