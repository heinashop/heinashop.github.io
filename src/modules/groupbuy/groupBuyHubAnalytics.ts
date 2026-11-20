import type { GroupBuyChannel, GroupBuyGroup, GroupBuyOrder } from '../../api/types'
import type { Group, Order, Shipment } from '../../daigou/types'
import {
  daysUntil,
  formatYmd,
  listPendingShipmentIds,
  localTodayIso,
  normalizeGroupStatus,
  V50_GROUP_STATUSES,
  type V50GroupStatus,
} from './v50Utils'

export const HUB_IMMINENT_DAYS = 7

export type HubChannelFilter = '全部' | GroupBuyChannel

export function normalizeGroupChannel(channel?: string | null): GroupBuyChannel | '' {
  if (channel === '通販') return '通販'
  if (channel === '場販' || channel === '市場飯') return '場販'
  return ''
}

export function matchesHubChannelFilter(
  group: Pick<GroupBuyGroup, 'channel'>,
  filter: HubChannelFilter,
): boolean {
  if (filter === '全部') return true
  return normalizeGroupChannel(group.channel) === filter
}

export type GroupBuyHubStats = {
  totalGroups: number
  activeGroups: number
  totalOrders: number
  statusCounts: Record<V50GroupStatus, number>
  unpaidOrderCount: number
  pendingBalanceTotal: number
  pendingBalanceOrderCount: number
  pendingBalanceCustomerCount: number
}

export type ImminentClosingRow = {
  id: string
  name: string
  status: V50GroupStatus
  closingDate: string
  saleEndDate: string
  daysToClosing: number | null
  daysToSaleEnd: number | null
  orderCount: number
}

export type ImminentShippingRow = {
  id: string
  name: string
  status: V50GroupStatus
  channel: GroupBuyChannel | ''
  pendingShip: number
  orderCount: number
  shipmentIds: string[]
}

export function computeGroupBuyHubStats(groups: GroupBuyGroup[]): GroupBuyHubStats {
  const statusCounts: Record<V50GroupStatus, number> = {
    已登記: 0,
    已下單: 0,
    官方已發貨: 0,
    已集運: 0,
    已抵台: 0,
    已結束: 0,
  }
  let totalOrders = 0
  let unpaidOrderCount = 0
  let pendingBalanceTotal = 0
  let pendingBalanceOrderCount = 0
  const pendingCustomers = new Set<string>()

  for (const g of groups) {
    const st = normalizeGroupStatus(g.status)
    statusCounts[st] += 1
    if (st === '已結束') continue
    for (const o of g.orders || []) {
      totalOrders += 1
      if (o.paymentStatus === '未付款') unpaidOrderCount += 1
      // 與營運總覽一致：僅「已付訂金」計入待收尾款；貨到付款亦不計未付訂金
      const bal = Number(o.balance) || 0
      if (bal > 0 && o.paymentStatus === '已付訂金') {
        pendingBalanceTotal += bal
        pendingBalanceOrderCount += 1
        const name = String(o.customerName || '').trim()
        if (name) pendingCustomers.add(name)
      }
    }
  }

  const activeGroups = groups.filter((g) => normalizeGroupStatus(g.status) !== '已結束').length

  return {
    totalGroups: groups.length,
    activeGroups,
    totalOrders,
    statusCounts,
    unpaidOrderCount,
    pendingBalanceTotal,
    pendingBalanceOrderCount,
    pendingBalanceCustomerCount: pendingCustomers.size,
  }
}

export function listImminentClosingGroups(
  groups: GroupBuyGroup[],
  withinDays = HUB_IMMINENT_DAYS,
  today = localTodayIso(),
): ImminentClosingRow[] {
  const rows: ImminentClosingRow[] = []
  for (const g of groups) {
    const status = normalizeGroupStatus(g.status)
    if (status === '已結束') continue
    const closingDate = formatYmd(g.closingDate)
    const saleEndDate = formatYmd(g.saleEndDate)
    const daysToClosing = closingDate ? daysUntil(closingDate, today) : null
    const daysToSaleEnd = saleEndDate ? daysUntil(saleEndDate, today) : null
    const hitClosing =
      daysToClosing !== null && daysToClosing >= 0 && daysToClosing <= withinDays
    const hitSaleEnd = daysToSaleEnd !== null && daysToSaleEnd >= 0 && daysToSaleEnd <= withinDays
    if (!hitClosing && !hitSaleEnd) continue
    rows.push({
      id: g.id,
      name: String(g.name || '').trim() || '未命名團務',
      status,
      closingDate,
      saleEndDate,
      daysToClosing,
      daysToSaleEnd,
      orderCount: (g.orders || []).length,
    })
  }
  return rows.sort((a, b) => {
    const ak = Math.min(
      a.daysToClosing ?? 999,
      a.daysToSaleEnd ?? 999,
    )
    const bk = Math.min(
      b.daysToClosing ?? 999,
      b.daysToSaleEnd ?? 999,
    )
    return ak - bk
  })
}

export function listImminentShippingGroups(
  groups: GroupBuyGroup[],
  shipments: Shipment[],
  orders: Order[],
  daigouGroups: Group[],
): ImminentShippingRow[] {
  const rows: ImminentShippingRow[] = []
  for (const g of groups) {
    const status = normalizeGroupStatus(g.status)
    if (status !== '已抵台') continue
    const shipmentIds = listPendingShipmentIds(shipments, orders, daigouGroups, {
      v50GroupId: g.id,
    })
    const pendingShip = shipmentIds.length
    if (pendingShip <= 0) continue
    rows.push({
      id: g.id,
      name: String(g.name || '').trim() || '未命名團務',
      status,
      channel: normalizeGroupChannel(g.channel),
      pendingShip,
      orderCount: (g.orders || []).length,
      shipmentIds,
    })
  }
  return rows.sort((a, b) => b.pendingShip - a.pendingShip)
}

export function flattenAllOrders(groups: GroupBuyGroup[]): Array<GroupBuyOrder & { groupId: string; groupName: string }> {
  const out: Array<GroupBuyOrder & { groupId: string; groupName: string }> = []
  for (const g of groups) {
    for (const o of g.orders || []) {
      out.push({ ...o, groupId: g.id, groupName: g.name })
    }
  }
  return out
}

export const HUB_STATUS_LABELS: Record<V50GroupStatus, string> = {
  已登記: '已登記',
  已下單: '已下單',
  官方已發貨: '官方已發貨',
  已集運: '已集運',
  已抵台: '已抵台',
  已結束: '已結束',
}

export const HUB_SELECTABLE_STATUSES = V50_GROUP_STATUSES
