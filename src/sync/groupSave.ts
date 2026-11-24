import type { GroupBuyGroup, GroupBuyOrder, GroupBuySavePayload } from '../api/types'
import { normalizeGroupStatus } from '../modules/groupbuy/v50Utils'

export const SHARED_GROUP_FIELDS = [
  'officialShipDate',
  'name',
  'status',
  'closingDate',
  'saleEndDate',
  'purchaseDate',
  'jpyAmount',
  'orderId',
  'logisticsId',
  'purchaseLink',
] as const

const SHARED = new Set<string>(SHARED_GROUP_FIELDS)
const GROUP_META = new Set(['orders', 'orderRevision', 'groupRevision'])

export type OrderMutation =
  | { op: 'upsertOrder'; groupId: string; group?: GroupBuyGroup; order: GroupBuyOrder }
  | { op: 'deleteOrder'; orderId: string }
  | { op: 'patchGroup'; groupId: string; fields: Record<string, unknown> }

export type GroupDiff = {
  mutations: OrderMutation[]
  orderRevisions: Record<string, string>
  groupRevisions: Record<string, string>
}

export type SaveResult = {
  dataRevision?: string
  orderRevisions?: Record<string, string>
  groupRevisions?: Record<string, string>
  writes?: Array<{ orderId?: string; groupId?: string; mode?: string; rows?: number }>
  rollups?: Array<{ groupId: string; orderCount?: number; totalTwd?: number }>
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b)
}

function orderValue(order: GroupBuyOrder) {
  const copy = { ...order } as Record<string, unknown>
  delete copy.orderRevision
  return copy
}

/**
 * Builds an order-level save from the last server snapshot and the edited list.
 * Returns null when the change touches fields that are not supported by the
 * mutation path (new/removed group, portal data, images, costs...). Callers
 * then fall back to the guarded full save instead of losing that data.
 */
export function diffGroups(baseGroups: GroupBuyGroup[], nextGroups: GroupBuyGroup[]): GroupDiff | null {
  const base = new Map(baseGroups.map((group) => [group.id, group]))
  const next = new Map(nextGroups.map((group) => [group.id, group]))
  if (base.size !== next.size) return null
  for (const id of base.keys()) if (!next.has(id)) return null

  const mutations: OrderMutation[] = []
  const orderRevisions: Record<string, string> = {}
  const groupRevisions: Record<string, string> = {}
  const baseOrderRevisions = new Map<string, string>()
  for (const group of baseGroups) {
    for (const order of group.orders || []) {
      baseOrderRevisions.set(order.id, String(order.orderRevision ?? '0'))
    }
  }

  for (const [groupId, nextGroup] of next) {
    const baseGroup = base.get(groupId)
    if (!baseGroup) return null

    const fields: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(baseGroup), ...Object.keys(nextGroup)])
    for (const key of keys) {
      if (GROUP_META.has(key)) continue
      const before = (baseGroup as Record<string, unknown>)[key]
      const after = (nextGroup as Record<string, unknown>)[key]
      if (same(before, after)) continue
      if (!SHARED.has(key)) return null
      fields[key] = after
    }
    if (Object.keys(fields).length) {
      mutations.push({ op: 'patchGroup', groupId, fields })
      groupRevisions[groupId] = String(baseGroup.groupRevision ?? '0')
    }

    const baseOrders = new Map((baseGroup.orders || []).map((order) => [order.id, order]))
    const nextOrders = new Map((nextGroup.orders || []).map((order) => [order.id, order]))

    for (const [orderId, baseOrder] of baseOrders) {
      if (nextOrders.has(orderId)) continue
      mutations.push({ op: 'deleteOrder', orderId })
      orderRevisions[orderId] = String(baseOrder.orderRevision ?? '0')
    }

    for (const [orderId, nextOrder] of nextOrders) {
      const baseOrder = baseOrders.get(orderId)
      if (baseOrder) {
        if (same(orderValue(baseOrder), orderValue(nextOrder))) continue
        orderRevisions[orderId] = String(baseOrder.orderRevision ?? '0')
      } else {
        orderRevisions[orderId] = baseOrderRevisions.get(orderId) ?? '0'
      }
      mutations.push({ op: 'upsertOrder', groupId, order: nextOrder })
    }
  }

  return { mutations, orderRevisions, groupRevisions }
}

function rebuild(
  payload: Record<string, unknown>,
  diff: GroupDiff | null,
  baseGroups: GroupBuyGroup[],
  nextGroups: GroupBuyGroup[],
): GroupBuySavePayload {
  const removedGroupIds = baseGroups
    .filter((group) => !nextGroups.some((item) => item.id === group.id))
    .map((group) => group.id)
  const base: Record<string, unknown> = { ...payload, removedGroupIds }
  delete base.groups
  delete base.mutations
  delete base.orderRevisions
  delete base.groupRevisions
  if (!diff) {
    return { ...base, groups: groupsForFullSave(baseGroups, nextGroups) } as GroupBuySavePayload
  }
  return {
    ...base,
    mutations: diff.mutations,
    orderRevisions: diff.orderRevisions,
    groupRevisions: diff.groupRevisions,
  } as GroupBuySavePayload
}

function groupsForFullSave(baseGroups: GroupBuyGroup[], nextGroups: GroupBuyGroup[]): GroupBuyGroup[] {
  const endedBase = new Map(
    baseGroups
      .filter((group) => normalizeGroupStatus(group.status) === '已結束')
      .map((group) => [group.id, JSON.stringify(group)]),
  )
  return nextGroups.filter((group) => {
    if (normalizeGroupStatus(group.status) !== '已結束') return true
    return endedBase.get(group.id) !== JSON.stringify(group)
  })
}

export function buildGroupSavePayload(
  baseGroups: GroupBuyGroup[],
  nextGroups: GroupBuyGroup[],
  payload: Record<string, unknown>,
): { payload: GroupBuySavePayload; mutationMode: boolean } {
  const diff = diffGroups(baseGroups, nextGroups)
  return { payload: rebuild(payload, diff, baseGroups, nextGroups), mutationMode: !!diff }
}

export function applySavedRevisions(groups: GroupBuyGroup[], result: SaveResult | null | undefined): GroupBuyGroup[] {
  if (!result) return groups
  const orderMap = result.orderRevisions || {}
  const groupMap = result.groupRevisions || {}
  return groups.map((group) => ({
    ...group,
    groupRevision: groupMap[group.id] != null ? String(groupMap[group.id]) : group.groupRevision,
    orders: (group.orders || []).map((order) => ({
      ...order,
      orderRevision: orderMap[order.id] != null ? String(orderMap[order.id]) : order.orderRevision,
    })),
  }))
}
