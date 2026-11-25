import type { GroupBuyGroup, GroupBuyOrder } from '../../api/types'
import { buildOrderFinancials } from '../../daigou/logic/orderCalc'
import { useDaigouStore } from '../../daigou/store'
import type { Order, OrderItem, OrderStatus, PaymentStatus, GroupStatus, Shipment } from '../../daigou/types'
import { customerNamesEqual, formatV50CustomerNameTag } from './customerNameKey'
import { isDaigouOrderShipped, isV50GroupReadyToShip, normalizeGroupStatus } from './v50Utils'

const V50_ORDER_TAG = 'v50OrderId:'

function buildV50GroupInternalNotes(groupId: string, status?: string) {
  return `v50GroupId:${groupId} v50Status:${normalizeGroupStatus(status)}`
}

export function findSyncedDaigouOrderId(v50OrderId: string): string | null {
  const marker = `${V50_ORDER_TAG}${v50OrderId}`
  const directId = `o_v50_${v50OrderId}`
  const o = useDaigouStore.getState().orders.find(
    (x) => x.id === directId || x.internalNote?.includes(marker) || x.notes?.includes(marker),
  )
  return o?.id ?? null
}

/** 刪除團務客訂時，一併移除客單管理鏡像與相關出貨列 */
export function removeSyncedDaigouOrder(v50OrderId: string) {
  const daigouId = findSyncedDaigouOrderId(v50OrderId)
  if (!daigouId) return
  useDaigouStore.setState((s) => ({
    ...s,
    orders: s.orders.filter((o) => o.id !== daigouId),
    shipments: s.shipments.filter((x) => x.orderId !== daigouId),
    shipmentRecords: s.shipmentRecords.filter((x) => x.orderId !== daigouId),
    myShipRecords: s.myShipRecords.filter((x) => x.orderId !== daigouId),
  }))
}

function v50PaymentToDaigou(status: string): PaymentStatus {
  if (status === '已付訂金') return 'deposit_paid'
  if (status === '已結清' || status === '已付款') return 'fully_paid'
  // 貨到付款：不收訂金，改列尾款待收（出貨／取貨時收取）
  if (status === '貨到付款') return 'balance_due'
  return 'unpaid'
}

function v50OrderStatus(group: GroupBuyGroup, payment: PaymentStatus): OrderStatus {
  const groupStatus = normalizeGroupStatus(group.status)
  if (groupStatus === '已結束') return 'completed'
  if (groupStatus === '已抵台' && payment !== 'unpaid') return 'ready_to_ship'
  if (payment === 'deposit_paid') return 'deposit_paid'
  if (payment === 'fully_paid') return 'fully_paid'
  if (payment === 'balance_due') return 'waiting_balance'
  return 'waiting_deposit'
}

function ensureShipmentForDaigouOrder(order: Order) {
  const st = useDaigouStore.getState()
  if (st.shipments.some((s) => s.orderId === order.id)) return
  if (isDaigouOrderShipped(order.orderStatus)) return

  const shipment: Shipment = {
    id: `s_v50_${order.id}`,
    orderId: order.id,
    customerId: order.customerId,
    carrier: '待填寫',
    trackingNo: '',
    status: 'not_packed',
    shipDate: '',
    notes: '團務已抵台，待出貨',
  }
  useDaigouStore.setState((s) => ({ ...s, shipments: [shipment, ...s.shipments] }))
}

function ensureShipmentsForV50Group(group: GroupBuyGroup) {
  if (!isV50GroupReadyToShip(normalizeGroupStatus(group.status))) return
  const marker = `v50GroupId:${group.id}`
  const dgGroup = useDaigouStore.getState().groups.find((g) => g.internalNotes?.includes(marker))
  if (!dgGroup) return
  for (const o of useDaigouStore.getState().orders.filter((x) => x.groupId === dgGroup.id)) {
    ensureShipmentForDaigouOrder(o)
  }
}

/** 依客單管理現有資料補齊出貨物流佇列（團務已抵台，含未付訂金） */
export function reconcileShippingQueueFromDaigou() {
  const st = useDaigouStore.getState()
  for (const g of st.groups) {
    if (!isV50GroupReadyToShip(g.internalNotes)) continue
    for (const o of st.orders.filter((x) => x.groupId === g.id)) {
      ensureShipmentForDaigouOrder(o)
    }
  }
}

function ensureV50Customer(name: string) {
  const trimmed = String(name ?? '').trim()
  const st = useDaigouStore.getState()
  const customer = st.customers.find(
    (c) =>
      customerNamesEqual(c.name, trimmed) || customerNamesEqual(c.lineDisplayName, trimmed),
  )
  if (customer) return customer

  const nc = {
    name: trimmed,
    lineDisplayName: trimmed,
    phoneLast3: '000',
    socialAccount: '',
    tags: [] as const,
    riskScore: 0,
    pickupReliability: 80,
    totalOrders: 0,
    totalUnpaidBalance: 0,
    notes: '由 V50 團務客訂自動建立',
  }
  const newId = `c_v50_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  useDaigouStore.setState((s) => ({
    ...s,
    customers: [
      {
        ...nc,
        id: newId,
        tags: [...nc.tags],
      },
      ...s.customers,
    ],
  }))
  return useDaigouStore.getState().customers.find((c) => c.id === newId)!
}

function ensureV50Group(group: GroupBuyGroup) {
  const st = useDaigouStore.getState()
  const marker = `v50GroupId:${group.id}`
  const internalNotes = buildV50GroupInternalNotes(group.id, group.status)
  const existing = st.groups.find((g) => g.internalNotes?.includes(marker))

  const meta = {
    name: group.name,
    internalNotes,
    closingDate: group.closingDate || new Date().toISOString().slice(0, 10),
    saleEndDate: group.saleEndDate || group.closingDate || new Date().toISOString().slice(0, 10),
    officialShipDate: String(group.officialShipDate ?? '').trim(),
    exchangeRate: 0.22,
    jpyAmountTotal: Number(group.jpyAmount) || 0,
    orderNumber: group.orderId || '',
    logisticsNumber: group.logisticsId || '',
    purchaseLink: group.purchaseLink || '',
    status: (normalizeGroupStatus(group.status) === '已結束' ? 'completed' : 'open') as GroupStatus,
    customerAnnouncement: String(group.description ?? '').trim(),
    coverImageUrl: String(group.coverImageUrl ?? '').trim(),
    notes: String(group.remarks ?? '').trim(),
  }

  if (existing) {
    useDaigouStore.setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === existing.id ? { ...g, ...meta } : g)),
    }))
    return useDaigouStore.getState().groups.find((g) => g.id === existing.id)!
  }

  const ng = {
    id: `g_v50_${group.id}`,
    ...meta,
    createdAt: Date.now(),
  }
  useDaigouStore.setState((s) => ({ ...s, groups: [ng, ...s.groups] }))
  return ng
}

function mapItems(order: GroupBuyOrder): OrderItem[] {
  return (order.items || []).map((it, i) => ({
    productId: `v50_${order.id}_${i}`,
    name: it.name,
    qty: Number(it.qty) || 1,
    jpyUnit: Number(it.jpy) || 0,
    twdUnit: Number(it.twd) || 0,
  }))
}

/** 將 V50 團內客訂鏡像至客單管理（同一筆訂單以 v50OrderId 對應更新） */
export function syncV50OrderToDaigou(group: GroupBuyGroup, order: GroupBuyOrder) {
  const customer = ensureV50Customer(order.customerName)
  const dg = ensureV50Group(group)
  const paymentStatus = v50PaymentToDaigou(order.paymentStatus)
  const items = mapItems(order)
  const domesticShipping = Number(order.domesticShip) || 0
  const internationalShipping = Number(order.intlShip) || 0
  const isCod = order.paymentStatus === '貨到付款'
  const depositOverride = isCod
    ? 0
    : order.deposit != null && String(order.deposit) !== '' && Number(order.deposit) > 0
      ? Number(order.deposit)
      : undefined
  const { deposit, balance, totalAmount } = buildOrderFinancials(
    items,
    domesticShipping,
    internationalShipping,
    depositOverride,
  )
  const totalReceived =
    paymentStatus === 'fully_paid'
      ? totalAmount
      : paymentStatus === 'deposit_paid'
        ? deposit
        : 0
  const marker = `${V50_ORDER_TAG}${order.id}`
  const nameTag = formatV50CustomerNameTag(order.customerName)
  const st = useDaigouStore.getState()
  const existing = st.orders.find((o) => o.internalNote?.includes(marker) || o.notes?.includes(marker))

  const noteParts = [marker, `v50GroupId:${group.id}`, nameTag]
  if (isCod) noteParts.push('v50Payment:貨到付款')

  const payload: Omit<Order, 'id' | 'lookupCode' | 'createdAt'> & { id?: string; lookupCode?: string; createdAt?: number } = {
    customerId: customer.id,
    groupId: dg.id,
    items,
    deposit,
    balance,
    domesticShipping,
    internationalShipping,
    totalAmount,
    totalReceived,
    outstandingAmount: Math.max(0, totalAmount - totalReceived),
    paymentStatus,
    orderStatus:
      existing && isDaigouOrderShipped(existing.orderStatus)
        ? existing.orderStatus
        : v50OrderStatus(group, paymentStatus),
    notes: order.paymentInfo || '',
    internalNote: noteParts.filter(Boolean).join(' '),
    customerNote: '',
    updatedAt: Date.now(),
  }

  if (existing) {
    useDaigouStore.setState((s) => ({
      ...s,
      orders: s.orders.map((o) =>
        o.id === existing.id ? { ...o, ...payload, id: o.id, lookupCode: o.lookupCode, createdAt: o.createdAt } : o,
      ),
    }))
    return existing.lookupCode
  }

  const lookupCode = `V50-${String(order.id).slice(-6).toUpperCase()}`
  const no: Order = {
    ...payload,
    id: `o_v50_${order.id}`,
    lookupCode,
    createdAt: Date.now(),
  }
  useDaigouStore.setState((s) => ({ ...s, orders: [no, ...s.orders] }))
  return lookupCode
}

export function syncV50GroupOrdersToDaigou(group: GroupBuyGroup) {
  for (const o of group.orders || []) {
    syncV50OrderToDaigou(group, o)
  }
  ensureShipmentsForV50Group(group)
}
