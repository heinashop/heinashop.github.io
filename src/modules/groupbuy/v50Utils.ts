import type { GroupBuyGroup, GroupBuyItem, GroupBuyOrder, GroupBuyPurchaseCost } from '../../api/types'
import type { Group, Order, Shipment } from '../../daigou/types'
import { normalizeCustomerNameKey, resolveOrderCustomerDisplayName } from './customerNameKey'

export function calcItemsTotalTwd(items: GroupBuyItem[]): number {
  return items.reduce((s, it) => s + (Number(it.twd) || 0) * (Number(it.qty) || 1), 0)
}

export function calcItemsTotalJpy(items: GroupBuyItem[]): number {
  return items.reduce((s, it) => s + (Number(it.jpy) || 0) * (Number(it.qty) || 1), 0)
}

export function calcGroupOrdersTotalJpy(orders: GroupBuyOrder[]): number {
  return (orders || []).reduce((s, o) => s + calcItemsTotalJpy(o.items || []), 0)
}

export function calcGroupOrdersTotalTwd(orders: GroupBuyOrder[]): number {
  return (orders || []).reduce((s, o) => {
    const stored = Number(o.totalTwd) || 0
    return s + (stored > 0 ? stored : calcItemsTotalTwd(o.items || []))
  }, 0)
}

/** V50：總額 > 20 → 訂金 = 總額 - 20；否則訂金 = 總額 */
export function suggestDeposit(totalTwd: number): number {
  const t = Number(totalTwd) || 0
  return t > 20 ? t - 20 : t
}

/** 團務客訂：貨到付款＝不收訂金，全額於取貨／出貨時收取 */
export function isV50CodPayment(paymentStatus?: string | null): boolean {
  return String(paymentStatus || '').trim() === '貨到付款'
}

/** 依付款狀態決定訂金：貨到付款固定 0；未付款且訂金為 0／空 → 自動總額−20 */
export function resolveV50Deposit(paymentStatus: string | undefined, totalTwd: number, depositRaw?: number): number {
  if (isV50CodPayment(paymentStatus)) return 0
  const n = Number(depositRaw)
  const hasValue = depositRaw !== undefined && depositRaw !== null && String(depositRaw).trim() !== ''
  if (hasValue && Number.isFinite(n) && n > 0) return n
  // 未付款且未填／填 0：帶入建議訂金（總額−20）
  const unpaid =
    !paymentStatus ||
    paymentStatus === '未付款' ||
    paymentStatus === 'unpaid'
  if (unpaid) return suggestDeposit(totalTwd)
  if (hasValue && Number.isFinite(n) && n >= 0) return n
  return suggestDeposit(totalTwd)
}

export function calcOrderBalance(
  totalTwd: number,
  deposit: number,
  domesticShip = 0,
  intlShip = 0,
): number {
  return (
    (Number(totalTwd) || 0) -
    (Number(deposit) || 0) +
    (Number(domesticShip) || 0) +
    (Number(intlShip) || 0)
  )
}

export type DeadlineSummary = {
  closingGroups: string[]
  saleEndGroups: string[]
}

export function localTodayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 試算表日期常變成 2026-08-01T00:00:00.000Z。畫面與日期欄只留年月日；純文字原樣保留。 */
export function formatYmd(value: string | number | undefined | null): string {
  const s = String(value ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d)
    }
  }
  return s
}

export function daysUntil(iso: string, today = localTodayIso()): number | null {
  const day = formatYmd(iso)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const endMs = Date.parse(`${day}T00:00:00`)
  const startMs = Date.parse(`${today}T00:00:00`)
  if (Number.isNaN(endMs) || Number.isNaN(startMs)) return null
  return Math.round((endMs - startMs) / 86400000)
}

/** 未來 2 日內（不含今日）結單／結束販賣，僅回傳團務名稱 */
export function summarizeImminentDates(
  groups: GroupBuyGroup[],
  today = localTodayIso(),
): DeadlineSummary {
  const closing: string[] = []
  const saleEnd: string[] = []
  for (const g of groups) {
    const status = normalizeGroupStatus(g.status)
    if (status === '已結束' || status === '已下單' || status === '官方已發貨') continue
    const name = String(g.name || '').trim() || '未命名團務'
    const cd = String(g.closingDate || '').trim()
    const sd = String(g.saleEndDate || '').trim()
    const leftClose = cd ? daysUntil(cd, today) : null
    const leftSale = sd ? daysUntil(sd, today) : null
    if (leftClose !== null && leftClose >= 1 && leftClose <= 2) closing.push(name)
    if (leftSale !== null && leftSale >= 1 && leftSale <= 2) saleEnd.push(name)
  }
  const sortNames = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  return {
    closingGroups: sortNames(closing),
    saleEndGroups: sortNames(saleEnd),
  }
}

export type BillOrderRow = GroupBuyOrder & { groupId: string; groupName: string }

export function listUnpaidCustomers(groups: GroupBuyGroup[]): { name: string; orders: BillOrderRow[] }[] {
  const map = new Map<string, BillOrderRow[]>()
  for (const g of groups) {
    for (const o of g.orders || []) {
      if (o.paymentStatus !== '未付款') continue
      const name = String(o.customerName || '').trim()
      if (!name) continue
      const row: BillOrderRow = { ...o, groupId: g.id, groupName: g.name }
      const arr = map.get(name) || []
      arr.push(row)
      map.set(name, arr)
    }
  }
  return [...map.entries()]
    .map(([name, orders]) => ({ name, orders }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}

export function sumLiveDeposits(
  orders: BillOrderRow[],
  selectedOrderIds: Set<string>,
  editingAmounts: Record<string, number | string>,
): number {
  return orders.reduce((s, o) => {
    if (!selectedOrderIds.has(o.id)) return s
    const raw = editingAmounts[o.id] !== undefined ? editingAmounts[o.id] : o.deposit
    return s + (Number(raw) || 0)
  }, 0)
}

export function customerPendingTotal(orders: BillOrderRow[], editingAmounts: Record<string, number | string>): number {
  return orders.reduce((s, o) => {
    const raw = editingAmounts[o.id] !== undefined ? editingAmounts[o.id] : o.deposit
    return s + (Number(raw) || 0)
  }, 0)
}

/** 對帳彈窗開啟時，背景卡片與彈窗內合計同步即時待收 */
export function customerLivePending(
  customerName: string,
  orders: BillOrderRow[],
  billOpen: boolean,
  billCustomer: string,
  selectedOrderIds: Set<string>,
  editingAmounts: Record<string, number | string>,
): number {
  if (billOpen && billCustomer === customerName) {
    return sumLiveDeposits(orders, selectedOrderIds, editingAmounts)
  }
  return customerPendingTotal(orders, {})
}

/** V50 匯款通知格式 */
export function buildPaymentNotification(
  _customerName: string,
  orders: BillOrderRow[],
  selectedOrderIds: Set<string>,
  editingAmounts: Record<string, number | string>,
): string {
  const byGroup = new Map<string, BillOrderRow[]>()
  for (const o of orders) {
    if (!selectedOrderIds.has(o.id)) continue
    const arr = byGroup.get(o.groupName) || []
    arr.push(o)
    byGroup.set(o.groupName, arr)
  }

  const lines: string[] = []
  let totalDeposit = 0

  for (const [groupName, groupOrders] of byGroup) {
    lines.push(`🏮 ${groupName}`)
    let groupTotal = 0
    let groupDeposit = 0
    for (const o of groupOrders) {
      groupTotal += Number(o.totalTwd) || 0
      const dep = Number(editingAmounts[o.id] !== undefined ? editingAmounts[o.id] : o.deposit) || 0
      groupDeposit += dep
      for (const it of o.items || []) {
        lines.push(`  ▪️ ${it.name} ${it.qty}x$${Number(it.twd).toLocaleString()}`)
      }
    }
    totalDeposit += groupDeposit
    lines.push(`💰 總金額 $${groupTotal.toLocaleString()}, 訂金 $${groupDeposit.toLocaleString()}`)
    lines.push('🚚 抵台時：賣貨便尾款$20 + 日本境內運費 + 國際運費')
    lines.push('')
  }

  lines.push('----------------------')
  lines.push(`✨ 總訂金合計：$${totalDeposit.toLocaleString()}`)
  return lines.join('\n')
}

export function groupOrderCount(g: GroupBuyGroup): number {
  return (g.orders || []).length
}

function positiveAmount(v: string | number | undefined): number | null {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function costRowJpy(c: GroupBuyPurchaseCost): number | null {
  const total = positiveAmount(c.jpyTotal)
  if (total != null) return total
  const sum = (Number(c.jpyCost) || 0) + (Number(c.jpyShipping) || 0)
  return sum > 0 ? sum : null
}

/** 同一團可有多筆下單金額；沒有成本列時沿用日幣預算。 */
export function groupChargeAmounts(g: GroupBuyGroup): number[] {
  const fromCosts = (g.purchaseCosts || []).map(costRowJpy).filter((n): n is number => n != null)
  if (fromCosts.length) return fromCosts
  const budget = positiveAmount(g.jpyAmount)
  return budget != null ? [budget] : []
}

export function groupJpyDisplay(g: GroupBuyGroup): string {
  const amounts = groupChargeAmounts(g)
  if (!amounts.length) return '—'
  return amounts.map((n) => `¥${n.toLocaleString()}`).join('、')
}

export const V50_GROUP_STATUSES = ['已登記', '已下單', '官方已發貨', '已集運', '已抵台', '已結束'] as const
export type V50GroupStatus = (typeof V50_GROUP_STATUSES)[number]

export function normalizeGroupStatus(status?: string): V50GroupStatus {
  const s = String(status || '').trim()
  if (s === '待處理') return '已登記'
  if ((V50_GROUP_STATUSES as readonly string[]).includes(s)) return s as V50GroupStatus
  return '已登記'
}

/** 團務管理搜尋：團名、訂單編號、物流編號，以及每一筆刷卡／日幣金額 */
export function matchesV50GroupSearch(group: GroupBuyGroup, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    group.name,
    group.orderId,
    group.logisticsId,
    group.description,
    group.remarks,
    group.creditCard,
    ...(group.purchaseCosts?.map((c) => c.logisticsId) ?? []),
    ...(group.purchaseCosts?.map((c) => c.orderNumber) ?? []),
  ]
  if (fields.some((v) => String(v || '').toLowerCase().includes(q))) return true
  const digits = q.replace(/[^\d]/g, '')
  if (digits.length < 3) return false
  const amounts = [
    group.jpyAmount,
    ...(group.purchaseCosts ?? []).flatMap((c) => [c.jpyCost, c.jpyShipping, c.jpyTotal, c.twdCost]),
  ]
  return amounts.some((v) => {
    const n = positiveAmount(v)
    return n != null && String(Math.round(n)).includes(digits)
  })
}

export function v50PurchaseCostSearchHits(groups: GroupBuyGroup[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Array<{
    groupId: string
    groupName: string
    status: string
    costId: string
    orderNumber: string
    jpyTotal: number
  }> = []
  for (const group of groups) {
    for (const cost of group.purchaseCosts || []) {
      const orderNumber = String(cost.orderNumber || '').trim()
      if (!orderNumber || !orderNumber.toLowerCase().includes(q)) continue
      hits.push({
        groupId: group.id,
        groupName: group.name,
        status: group.status,
        costId: cost.id,
        orderNumber,
        jpyTotal: Number(cost.jpyTotal) || 0,
      })
    }
  }
  return hits
}

export function groupUnpaidCount(g: GroupBuyGroup): number {
  return (g.orders || []).filter((o) => o.paymentStatus === '未付款').length
}

export function groupHasUnpaidOrders(g: GroupBuyGroup): boolean {
  return groupUnpaidCount(g) > 0
}

export type GroupSortKey = 'newest' | 'closing' | 'saleEnd' | 'officialShip'

export const GROUP_SORT_OPTIONS: { key: GroupSortKey; label: string }[] = [
  { key: 'newest', label: '最新' },
  { key: 'closing', label: '結單日' },
  { key: 'saleEnd', label: '結束販賣日' },
  { key: 'officialShip', label: '官方出貨日' },
]

function groupNewestKey(g: GroupBuyGroup): number {
  const m = g.id.match(/_(\d+)_/)
  return m ? Number(m[1]) : 0
}

function groupDateSortKey(iso?: string): number {
  const s = formatYmd(iso)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.POSITIVE_INFINITY
  const ms = Date.parse(`${s}T00:00:00`)
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

export function sortGroups(list: GroupBuyGroup[], sortKey: GroupSortKey): GroupBuyGroup[] {
  const copy = [...list]
  switch (sortKey) {
    case 'newest':
      return copy.sort((a, b) => groupNewestKey(b) - groupNewestKey(a))
    case 'closing':
      return copy.sort((a, b) => groupDateSortKey(a.closingDate) - groupDateSortKey(b.closingDate))
    case 'saleEnd':
      return copy.sort((a, b) => groupDateSortKey(a.saleEndDate) - groupDateSortKey(b.saleEndDate))
    case 'officialShip':
      return copy.sort((a, b) => groupDateSortKey(a.officialShipDate) - groupDateSortKey(b.officialShipDate))
    default:
      return copy
  }
}

export function parseV50GroupStatus(text?: string): V50GroupStatus {
  const m = String(text || '').match(/v50Status:([^\s]+)/)
  return normalizeGroupStatus(m?.[1])
}

export function isV50GroupEnded(text?: string): boolean {
  return parseV50GroupStatus(text) === '已結束'
}

/** 團務已抵台：可安排國內出貨，應出現在出貨物流 */
export function isV50GroupReadyToShip(text?: string): boolean {
  return parseV50GroupStatus(text) === '已抵台'
}

export type ShippingQueueCountFilter = {
  orderIds?: Set<string>
  groupId?: string
  v50GroupId?: string
}

function resolveShippingQueueTargetGroupId(
  groups: Group[],
  filter?: ShippingQueueCountFilter,
): string | undefined {
  if (filter?.groupId) return filter.groupId
  if (filter?.v50GroupId) {
    const marker = `v50GroupId:${filter.v50GroupId}`
    return groups.find((g) => g.internalNotes?.includes(marker))?.id
  }
  return undefined
}

/** 與出貨物流頁相同：佇列中的 shipment id（團務已抵台、客單未結束，不限付款狀態） */
export function listPendingShipmentIds(
  shipments: Shipment[],
  orders: Order[],
  groups: Group[],
  filter?: ShippingQueueCountFilter,
): string[] {
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const targetGroupId = resolveShippingQueueTargetGroupId(groups, filter)

  const ids: string[] = []
  for (const sh of shipments) {
    const o = orderById.get(sh.orderId)
    if (!o) continue
    if (filter?.orderIds && !filter.orderIds.has(o.id)) continue
    if (targetGroupId && o.groupId !== targetGroupId) continue
    if (o.orderStatus === 'cancelled' || o.orderStatus === 'completed') continue
    const g = groupById.get(o.groupId)
    if (!isV50GroupReadyToShip(g?.internalNotes)) continue
    ids.push(sh.id)
  }
  return ids
}

/** 與出貨物流頁相同：佇列中的 shipment 筆數（團務已抵台、客單未結束，不限付款狀態） */
export function countShippingQueueRows(
  shipments: Shipment[],
  orders: Order[],
  groups: Group[],
  filter?: ShippingQueueCountFilter,
): number {
  return listPendingShipmentIds(shipments, orders, groups, filter).length
}

/** 顧客端／後台對外顯示的團務狀態（與 V50_GROUP_STATUSES 一致） */
export function customerFacingGroupStatus(text?: string): string {
  return parseV50GroupStatus(text)
}

export const CUSTOMER_GROUP_STATUS_FILTERS = [
  '已登記',
  '已下單',
  '官方已發貨',
  '已集運',
  '已抵台',
  '已結束',
] as const

export type CustomerGroupStatusFilter = (typeof CUSTOMER_GROUP_STATUS_FILTERS)[number] | ''

export function matchesCustomerGroupStatusFilter(
  groupInternalNotes: string | undefined,
  filter: CustomerGroupStatusFilter,
): boolean {
  if (!filter) return true
  const status = parseV50GroupStatus(groupInternalNotes)
  if (filter === '已登記') return status === '已登記'
  return status === filter
}

export function isDaigouOrderShipped(orderStatus?: string): boolean {
  return orderStatus === 'shipped' || orderStatus === 'completed'
}

export type OrderShippingReminderTone = 'shipped' | 'packed' | 'pending' | 'issue'

export type OrderShippingReminder = {
  label: string
  tone: OrderShippingReminderTone
}

/** 依客單與出貨物流紀錄顯示出貨狀態提醒 */
export function getOrderShippingReminder(
  orderId: string,
  orderStatus: string | undefined,
  shipments: { orderId: string; status: string }[],
): OrderShippingReminder | null {
  if (isDaigouOrderShipped(orderStatus)) {
    return { label: '已出貨', tone: 'shipped' }
  }
  const sh = shipments.find((s) => s.orderId === orderId)
  if (!sh) return null
  if (sh.status === 'shipped' || sh.status === 'delivered') {
    return { label: '已出貨', tone: 'shipped' }
  }
  if (sh.status === 'packed') return { label: '已包貨', tone: 'packed' }
  if (sh.status === 'not_packed') return { label: '待出貨', tone: 'pending' }
  if (sh.status === 'returned') return { label: '配送異常', tone: 'issue' }
  return null
}

export const REMITTANCE_BANK_OPTIONS = ['國泰', '中信', '郵局', 'LINE Bank', '台新', '其他'] as const

/** 對帳沖銷後寫入客訂的匯款紀錄，例：2026/06/15 中信 #備註 */
export function formatRemittancePaymentInfo(isoDate: string, bank: string, note?: string): string {
  const parts = isoDate.trim().split('-')
  const dateStr =
    parts.length === 3
      ? `${parts[0]}/${parts[1]}/${parts[2]}`
      : new Date().toISOString().slice(0, 10).replace(/-/g, '/')
  const bankLabel = bank.trim() || '待分類'
  const trimmed = note?.trim()
  if (trimmed) return `${dateStr} ${bankLabel} #${trimmed}`
  return `${dateStr} ${bankLabel}`
}

/** 暱稱查單：未付款顯示「總額−應付訂金」尾款；已付訂金後顯示帳上尾款 */
export function displayOrderBalanceAmount(
  paymentStatus: string,
  totalAmount: number,
  balance: number,
  deposit?: number,
): number {
  if (paymentStatus === 'unpaid') {
    const dep =
      deposit != null && Number(deposit) > 0 ? Number(deposit) : suggestDeposit(totalAmount)
    return calcOrderBalance(totalAmount, dep)
  }
  return balance
}

export type DaigouOrderBucket = 'pending' | 'processed' | 'ended'

export const ORDER_BUCKET_LABELS: Record<DaigouOrderBucket, string> = {
  pending: '待付款訂單',
  processed: '已處理訂單',
  ended: '已結束訂單',
}

export function classifyDaigouOrder(
  paymentStatus: string,
  groupInternalNotes?: string,
  orderStatus?: string,
): DaigouOrderBucket {
  if (isDaigouOrderShipped(orderStatus)) return 'ended'
  if (isV50GroupEnded(groupInternalNotes)) return 'ended'
  if (paymentStatus === 'unpaid') return 'pending'
  return 'processed'
}

export type CustomerOrderGroup = {
  name: string
  orders: Order[]
}

export function groupOrdersByCustomerName(
  orders: Order[],
  customers: { id: string; name: string; lineDisplayName?: string }[],
): CustomerOrderGroup[] {
  const custById = new Map(customers.map((c) => [c.id, c]))
  const map = new Map<string, CustomerOrderGroup>()
  for (const o of orders) {
    const c = custById.get(o.customerId)
    // 優先團務客訂姓名，避免 customerId 錯掛時分組顯示錯人
    const name = resolveOrderCustomerDisplayName(o, c)
    const key = normalizeCustomerNameKey(name) || name.toLowerCase()
    const row = map.get(key) ?? { name, orders: [] }
    row.orders.push(o)
    map.set(key, row)
  }
  for (const row of map.values()) {
    row.orders.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }
  return [...map.values()].sort((a, b) => (b.orders[0]?.createdAt ?? 0) - (a.orders[0]?.createdAt ?? 0))
}

export type GroupOrderSection = {
  groupId: string
  groupName: string
  groupStatus: V50GroupStatus | ''
  orders: Order[]
}

export function groupOrdersByGroupId(
  orders: Order[],
  groupsById: Map<string, { id: string; name: string; internalNotes?: string }>,
): GroupOrderSection[] {
  const map = new Map<string, GroupOrderSection>()
  for (const o of orders) {
    const g = groupsById.get(o.groupId)
    const key = o.groupId
    const row =
      map.get(key) ??
      {
        groupId: key,
        groupName: g?.name ?? '（未知團）',
        groupStatus: parseV50GroupStatus(g?.internalNotes),
        orders: [],
      }
    row.orders.push(o)
    map.set(key, row)
  }
  for (const row of map.values()) {
    row.orders.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }
  return [...map.values()]
}

export function countOrderBuckets(
  orders: Order[],
  groupsById: Map<string, { internalNotes?: string }>,
): Record<DaigouOrderBucket, number> {
  const counts: Record<DaigouOrderBucket, number> = { pending: 0, processed: 0, ended: 0 }
  for (const o of orders) {
    const g = groupsById.get(o.groupId)
    counts[classifyDaigouOrder(o.paymentStatus, g?.internalNotes, o.orderStatus)] += 1
  }
  return counts
}
