import type { ConsolidationParcel, ConsolidationShipment, GroupBuyGroup } from '../../api/types'
import { isInGroupOps } from './groupLifecycle'
import { normalizeGroupStatus, type V50GroupStatus } from './v50Utils'

export function parcelKey(p: Pick<ConsolidationParcel, 'groupId' | 'costRowId'>) {
  return `${p.groupId}::${p.costRowId}`
}

export function listGroupInboundParcels(group: GroupBuyGroup): ConsolidationParcel[] {
  const name = group.name || '未命名團務'
  const rows = group.purchaseCosts?.length
    ? group.purchaseCosts
    : group.logisticsId?.trim()
      ? [
          {
            id: `${group.id}__legacy`,
            logisticsId: group.logisticsId,
            weight: group.weight,
          },
        ]
      : []
  const out: ConsolidationParcel[] = []
  for (const row of rows) {
    const logisticsId = String(row.logisticsId || '').trim()
    if (!logisticsId) continue
    out.push({
      groupId: group.id,
      costRowId: String(row.id || `${group.id}__legacy`),
      logisticsId,
      inboundWeight: row.weight != null && row.weight !== '' ? String(row.weight) : '',
      groupName: name,
    })
  }
  return out
}

function assignedKeys(shipments: ConsolidationShipment[], onlyConsolidating = false) {
  const keys = new Set<string>()
  for (const s of shipments) {
    if (onlyConsolidating && s.status !== 'consolidating') continue
    for (const p of s.parcels || []) keys.add(parcelKey(p))
  }
  return keys
}

/** 可集運：官方已發貨或已集運、有物流編號、尚未掛在進行中的集運單 */
export function listAvailableParcels(
  groups: GroupBuyGroup[],
  shipments: ConsolidationShipment[],
): ConsolidationParcel[] {
  const taken = assignedKeys(shipments, true)
  const out: ConsolidationParcel[] = []
  for (const g of groups) {
    if (!isInGroupOps(g)) continue
    const st = normalizeGroupStatus(g.status)
    if (st !== '官方已發貨' && st !== '已集運') continue
    for (const p of listGroupInboundParcels(g)) {
      if (taken.has(parcelKey(p))) continue
      out.push(p)
    }
  }
  return out
}

export function sumInboundWeight(parcels: ConsolidationParcel[]): number | null {
  let sum = 0
  let any = false
  for (const p of parcels) {
    const n = Number(p.inboundWeight)
    if (!Number.isFinite(n) || n <= 0) continue
    sum += n
    any = true
  }
  return any ? Math.round(sum * 1000) / 1000 : null
}

export function groupNamesOnShipment(ship: ConsolidationShipment): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const p of ship.parcels || []) {
    const n = (p.groupName || '').trim() || p.groupId
    if (seen.has(n)) continue
    seen.add(n)
    names.push(n)
  }
  return names
}

function groupHasConsolidatingParcel(groupId: string, shipments: ConsolidationShipment[]) {
  return shipments.some(
    (s) => s.status === 'consolidating' && (s.parcels || []).some((p) => p.groupId === groupId),
  )
}

function groupHasArrivedParcel(groupId: string, shipments: ConsolidationShipment[]) {
  return shipments.some(
    (s) => s.status === 'arrived' && (s.parcels || []).some((p) => p.groupId === groupId),
  )
}

export function shipmentGroupsAllEnded(
  ship: ConsolidationShipment,
  groups: GroupBuyGroup[],
): boolean {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const ids = [...new Set((ship.parcels || []).map((p) => p.groupId).filter(Boolean))]
  if (!ids.length) return false
  if (ids.some((id) => !byId.has(id))) return false
  return ids.every((id) => normalizeGroupStatus(byId.get(id)?.status) === '已結束')
}

export function syncShipmentsFromGroupStatuses(
  groups: GroupBuyGroup[],
  shipments: ConsolidationShipment[],
): ConsolidationShipment[] {
  let changed = false
  const next = shipments.map((s) => {
    const allEnded = shipmentGroupsAllEnded(s, groups)
    if (allEnded && s.status !== 'ended') {
      changed = true
      return { ...s, status: 'ended' as const, updatedAt: Date.now() }
    }
    if (!allEnded && s.status === 'ended') {
      const ids = [...new Set((s.parcels || []).map((p) => p.groupId).filter(Boolean))]
      const byId = new Map(groups.map((g) => [g.id, g]))
      if (!ids.length || ids.some((id) => !byId.has(id))) return s
      changed = true
      return {
        ...s,
        status: s.arrivedAt ? ('arrived' as const) : ('consolidating' as const),
        updatedAt: Date.now(),
      }
    }
    return s
  })
  return changed ? next : shipments
}

function nextStatusForGroup(
  group: GroupBuyGroup,
  shipments: ConsolidationShipment[],
): V50GroupStatus | null {
  const current = normalizeGroupStatus(group.status)
  if (current === '已結束' || current === '已登記' || current === '已下單') return null
  const consolidating = groupHasConsolidatingParcel(group.id, shipments)
  const arrived = groupHasArrivedParcel(group.id, shipments)
  if (consolidating) return '已集運'
  if (arrived) return '已抵台'
  if (current === '已集運' || current === '已抵台') return '官方已發貨'
  return null
}

export function syncGroupStatusesFromShipments(
  groups: GroupBuyGroup[],
  shipments: ConsolidationShipment[],
): GroupBuyGroup[] {
  return groups.map((g) => {
    const next = nextStatusForGroup(g, shipments)
    if (!next || next === normalizeGroupStatus(g.status)) return g
    return { ...g, status: next }
  })
}

export function newShipmentId() {
  return `cs_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
}

export function createConsolidationShipment(
  selected: ConsolidationParcel[],
  extra?: Partial<Pick<ConsolidationShipment, 'carrier' | 'note'>>,
): ConsolidationShipment {
  const now = Date.now()
  return {
    id: newShipmentId(),
    createdAt: now,
    updatedAt: now,
    status: 'consolidating',
    carrier: extra?.carrier?.trim() || '',
    note: extra?.note?.trim() || '',
    parcels: selected.map((p) => ({ ...p })),
    billedWeightKg: '',
    intlFeeTwd: '',
    intlTrackingNo: '',
  }
}

export function formatConsolDate(ms?: number) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Date(ms).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function formatWeightKg(value: string | number | null | undefined) {
  if (value == null || value === '') return '尚未填'
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return `${n} kg`
  const s = String(value).trim()
  return s ? `${s} kg` : '尚未填'
}

export function groupStatusesNeedSync(groups: GroupBuyGroup[], shipments: ConsolidationShipment[]) {
  const synced = syncGroupStatusesFromShipments(groups, shipments)
  const prev = new Map(groups.map((g) => [g.id, g.status]))
  return synced.some((g) => g.status !== prev.get(g.id)) ? synced : null
}

export const SHIPMENT_STATUS_LABEL: Record<ConsolidationShipment['status'], string> = {
  consolidating: '已集運',
  arrived: '已抵台',
  ended: '已結束',
}
