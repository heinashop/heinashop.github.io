import type { GroupBuyOrder } from '../../api/types'
import { useDaigouStore } from '../../daigou/store'
import { findSyncedDaigouOrderId } from './v50DaigouSync'
import { formatPaymentNoteLabel, getOrderShippingReminder, isV50CodPayment } from './v50Utils'
import './v50OrderMiniCard.css'

type Props = {
  order: GroupBuyOrder
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}

function paymentBadges(status: string) {
  if (status === '未付款') return ['未付款'] as const
  if (status === '已付訂金') return ['已付訂金'] as const
  if (status === '已付款' || status === '已結清') return ['已付清'] as const
  if (status === '貨到付款') return ['貨到付款'] as const
  return [status || '—'] as const
}

export function V50OrderMiniCard({ order, onOpen, onEdit, onDelete }: Props) {
  const shipments = useDaigouStore((s) => s.shipments)
  const daigouOrders = useDaigouStore((s) => s.orders)
  const daigouId = findSyncedDaigouOrderId(order.id)
  const daigouOrder = daigouId ? daigouOrders.find((o) => o.id === daigouId) : undefined
  const shipReminder =
    daigouId != null ? getOrderShippingReminder(daigouId, daigouOrder?.orderStatus, shipments) : null

  const badges = paymentBadges(order.paymentStatus)
  const unpaid = order.paymentStatus === '未付款'
  const isCod = isV50CodPayment(order.paymentStatus)
  const depositLabel = isCod ? '訂金' : '應付訂金'
  const depositAmt = isCod ? 0 : Number(order.deposit || 0)
  const balanceLabel = isCod ? '貨到應收' : '尾款'
  const balanceAmt = Number(order.balance || (isCod ? order.totalTwd : 0) || 0)
  const payNote = formatPaymentNoteLabel(order.paymentInfo)

  return (
    <article className={unpaid ? 'v50-ocard v50-ocard--unpaid' : 'v50-ocard'}>
      <button type="button" className="v50-ocard-main" onClick={onOpen}>
        <p className="v50-ocard-name">{order.customerName || '（未填名字）'}</p>
        <p className="v50-ocard-amounts">
          <span className="v50-ocard-deposit">
            {depositLabel} ${depositAmt.toLocaleString()}
          </span>
          <span className="v50-ocard-amount-sep" aria-hidden>
            ·
          </span>
          <span className="v50-ocard-balance">
            {balanceLabel} ${balanceAmt.toLocaleString()}
          </span>
          {payNote ? <span className="v50-ocard-paynote">{payNote}</span> : null}
        </p>
      </button>
      <div className="v50-ocard-side">
        {shipReminder?.tone === 'shipped' ? (
          <span className="v50-ocard-badge v50-ocard-badge-shipped">已出貨</span>
        ) : null}
        {badges.map((b) => (
          <span
            key={b}
            className={
              unpaid
                ? 'v50-ocard-badge v50-ocard-badge-warn'
                : 'v50-ocard-badge v50-ocard-badge-ok'
            }
          >
            {b}
          </span>
        ))}
      </div>
      <div className="v50-ocard-actions">
        <button type="button" className="v50-ocard-edit" onClick={onEdit}>
          編輯
        </button>
        <button type="button" className="v50-ocard-delete" onClick={onDelete}>
          刪除
        </button>
      </div>
    </article>
  )
}
