import type { Group, Order, Shipment } from '../../daigou/types'
import { itemTotalTwd } from '../../daigou/logic/orderCalc'
import { getPaymentStatusLabel } from '../../daigou/statusDisplay'
import { officialShipSortKey } from '../../modules/groupbuy/shipDateText'
import {
  countShippingQueueRows,
  customerFacingGroupStatus,
  displayOrderBalanceAmount,
  isDaigouOrderShipped,
  suggestDeposit,
  type DaigouOrderBucket,
} from '../../modules/groupbuy/v50Utils'

export function pillTone(status: string) {
  const s = String(status || '')
  if (/已付|完成|對帳|付清|溢付|貨到付款/.test(s)) return 'ok'
  if (/未付|待|尾款|訂金|呆帳|退款/.test(s)) return 'warn'
  if (/退|取消/.test(s)) return 'muted'
  return 'warn'
}

/** 待付訂金顯示／合計用：未填或 0 時自動帶入商品金額−20（不含運費） */
export function dueDepositAmount(order: Order) {
  if (order.paymentStatus !== 'unpaid') {
    return Math.max(0, Number(order.deposit) || 0)
  }
  const d = Number(order.deposit) || 0
  return d > 0 ? d : suggestDeposit(itemTotalTwd(order.items))
}

export function shipDateSortKey(text?: string): number {
  return officialShipSortKey(text)
}

export function depositLineForBucket(order: Order, bucket?: DaigouOrderBucket) {
  const settled = bucket !== 'pending' && order.paymentStatus !== 'unpaid'
  return {
    label: settled ? '已付訂金' : '應付訂金',
    amount: settled
      ? Math.max(0, Number(order.totalReceived ?? order.deposit) || 0)
      : dueDepositAmount(order),
  }
}

export function countPendingShipOrders(orders: Order[], shipments: Shipment[], groups: Group[]): number {
  return countShippingQueueRows(shipments, orders, groups, {
    orderIds: new Set(orders.map((o) => o.id)),
  })
}

export function previewSummaryForBucket(orders: Order[], orderBucket?: DaigouOrderBucket) {
  if (orderBucket === 'pending') {
    return {
      label: '待付訂金合計',
      sum: sumPendingDepositDue(orders),
      footnote: '訂金合計僅供參考，不含未入帳調整；實際對外頁面以線上部署為準。',
    }
  }
  if (orderBucket === 'ended') {
    return {
      label: '',
      sum: 0,
      footnote: '已結束訂單視為款項結清，不再顯示待補尾款。',
    }
  }
  return {
    label: '待付尾款合計',
    sum: sumPendingBalanceDue(orders),
    footnote: '尾款合計僅供參考，不含未入帳調整；實際對外頁面以線上部署為準。',
  }
}

/** 待付訂金：尚未付訂金的客單訂金合計 */
export function sumPendingDepositDue(orders: Order[]) {
  return orders.reduce((a, o) => {
    if (o.paymentStatus !== 'unpaid') return a
    return a + dueDepositAmount(o)
  }, 0)
}

/** 待付尾款：尚有尾款餘額的合計 */
export function sumPendingBalanceDue(orders: Order[]) {
  return orders.reduce((a, o) => {
    if (o.paymentStatus === 'fully_paid' || o.paymentStatus === 'refunded' || o.paymentStatus === 'overpaid') {
      return a
    }
    return a + Math.max(0, Number(o.balance) || 0)
  }, 0)
}

export function balanceAmountForPreview(order: Order, bucket?: DaigouOrderBucket) {
  if (bucket === 'ended') return 0
  return displayOrderBalanceAmount(
    order.paymentStatus,
    order.totalAmount,
    order.balance,
    dueDepositAmount(order),
  )
}

export function showBalanceLineInPreview(bucket?: DaigouOrderBucket) {
  return bucket !== 'ended'
}

export function formatShippedMonthLabel(shipDate?: string): string | null {
  const s = String(shipDate || '').trim()
  if (!s) return null
  const parts = s.split('-')
  if (parts.length >= 2) {
    const y = parts[0]
    const mo = parts[1].padStart(2, '0')
    if (/^\d{4}$/.test(y) && /^\d{2}$/.test(mo)) return `${y}/${mo}月已出貨`
  }
  return null
}

export type PreviewShipLine = {
  label?: string
  value: string
}

export function previewShipLineForBucket(
  order: Order,
  group: Group | undefined,
  orderBucket: DaigouOrderBucket | undefined,
  shipment?: Shipment,
): PreviewShipLine {
  if (orderBucket === 'ended') {
    const fromShipment = formatShippedMonthLabel(shipment?.shipDate)
    if (fromShipment) return { value: fromShipment }
    if (isDaigouOrderShipped(order.orderStatus)) return { value: '已出貨' }
    return { value: '出貨日待確認' }
  }
  if (orderBucket === 'processed') {
    const date = group?.officialShipDate?.trim()
    return { label: '官方的出貨日', value: date || '未定' }
  }
  const date = group?.officialShipDate?.trim()
  return { label: '出貨', value: date || '未定' }
}

export function groupStatusLabel(group?: Group) {
  return customerFacingGroupStatus(group?.internalNotes)
}

export function paymentLabel(order: Order) {
  const hay = `${order.notes || ''} ${order.internalNote || ''}`
  if (order.paymentStatus === 'balance_due' && /貨到付款/.test(hay)) return '貨到付款'
  return getPaymentStatusLabel(order.paymentStatus)
}
