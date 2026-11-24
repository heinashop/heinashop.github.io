import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Btn, Empty } from '../components/ui'
import { useApi } from '../context/useApi'
import type { GroupBuyAppData } from '../api/types'
import { useDaigouStore } from '../daigou/store'
import { PAYMENT_STATUS_LABEL } from '../daigou/constants'
import type { Group, Order, PaymentStatus } from '../daigou/types'
import { itemTotalTwd } from '../daigou/logic/orderCalc'
import { V50OrderDetailPanel } from '../modules/groupbuy/V50OrderDetailPanel'
import { groupOrdersByGroupId, parseV50GroupStatus } from '../modules/groupbuy/v50Utils'
import {
  extractV50OrderIdFromDaigou,
  findV50OrderContext,
  parseV50Refs,
} from '../modules/groupbuy/v50OrderLookup'
import {
  customerNamesEqual,
  normalizeCustomerNameKey,
  resolveOrderCustomerDisplayName,
} from '../modules/groupbuy/customerNameKey'
import { syncV50GroupOrdersToDaigou } from '../modules/groupbuy/v50DaigouSync'
import '../modules/groupbuy/groupbuy.css'
import '../modules/groupbuy/v50OrderDetailSheet.css'

function resolveOrder(orders: Order[], rawId: string): Order | null {
  const orderId = rawId ? decodeURIComponent(rawId) : ''
  if (!orderId) return null
  return (
    orders.find((x) => x.id === orderId) ??
    orders.find((x) => x.lookupCode === orderId) ??
    orders.find((x) => x.internalNote?.includes(`v50OrderId:${orderId}`)) ??
    orders.find((x) => x.notes?.includes(`v50OrderId:${orderId}`)) ??
    null
  )
}

function orderPaymentRowLabel(paymentStatus: PaymentStatus): string {
  if (paymentStatus === 'unpaid') return '未付款'
  return PAYMENT_STATUS_LABEL[paymentStatus]
}

function orderPaymentRowTone(paymentStatus: PaymentStatus): 'pending' | 'warn' | 'ok' | 'neutral' {
  if (paymentStatus === 'unpaid') return 'pending'
  if (paymentStatus === 'fully_paid' || paymentStatus === 'overpaid') return 'ok'
  if (paymentStatus === 'balance_due' || paymentStatus === 'deposit_paid') return 'warn'
  return 'neutral'
}

function OrderDetailShell({
  customerName,
  subtitle,
  children,
}: {
  customerName: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="order-detail-page space-y-4">
      <Link to="/orders" className="order-detail-back">
        <ArrowLeft className="h-4 w-4" />
        訂單列表
      </Link>
      <header className="order-detail-hero">
        <h1 className="order-detail-hero-title">{customerName}</h1>
        <p className="order-detail-hero-sub">{subtitle}</p>
      </header>
      {children}
    </div>
  )
}

function RelatedCustomerOrders({
  currentOrderId,
  customerName,
  orders,
  customers,
  groups,
  gbGroups,
  onOpen,
}: {
  currentOrderId: string
  /** 以詳情頁顯示的客人姓名為準（團務客訂姓名），勿只靠可能錯掛的 customerId */
  customerName: string
  orders: Order[]
  customers: { id: string; name: string; lineDisplayName?: string }[]
  groups: Group[]
  gbGroups?: GroupBuyAppData['groups'] | null
  onOpen: (id: string) => void
}) {
  const want = normalizeCustomerNameKey(customerName)
  if (!want) return null

  const customersById = new Map(customers.map((c) => [c.id, c]))
  const related = orders.filter((o) => {
    if (o.id === currentOrderId) return false

    // 有團務資料時：以團務客訂姓名精確勾稽（避免 customerId 錯掛）
    const v50Id = extractV50OrderIdFromDaigou(o)
    if (v50Id && gbGroups?.length) {
      const ctx = findV50OrderContext(gbGroups, v50Id)
      if (ctx) return customerNamesEqual(ctx.order.customerName, customerName)
    }

    const c = customersById.get(o.customerId)
    return customerNamesEqual(resolveOrderCustomerDisplayName(o, c, ''), customerName)
  })
  if (related.length === 0) return null

  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const sections = groupOrdersByGroupId(related, groupsById)

  return (
    <section className="order-detail-related">
      <p className="order-detail-related-title">此客人其他訂單</p>
      {sections.map((section) => (
        <div key={section.groupId} className="order-detail-related-card mb-3">
          <p className="order-row-group-name">{section.groupName}</p>
          {section.orders.map((o) => {
            const unpaid = o.paymentStatus === 'unpaid'
            return (
              <button
                key={o.id}
                type="button"
                className="order-detail-related-row"
                onClick={() => onOpen(o.id)}
              >
                <div className="order-row-meta order-detail-related-meta">
                  <span className={`order-pay-status order-pay-status--${orderPaymentRowTone(o.paymentStatus)}`}>
                    {orderPaymentRowLabel(o.paymentStatus)}
                  </span>
                  {section.groupStatus ? (
                    <span className={`order-group-status order-group-status--${section.groupStatus}`}>
                      {section.groupStatus}
                    </span>
                  ) : null}
                  <span className="order-detail-related-code">{o.lookupCode}</span>
                </div>
                <span className={`order-detail-related-balance${unpaid ? ' order-detail-balance--due' : ''}`}>
                  尾款 NT${Number(o.balance || 0).toLocaleString()}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </section>
  )
}

function DaigouOrderDetailPanel({
  order,
  groupName,
  groupStatus,
}: {
  order: Order
  groupName: string
  groupStatus?: string
}) {
  const items = order.items ?? []
  const itemTotal = itemTotalTwd(items)
  const unpaid = order.paymentStatus === 'unpaid'
  const paymentLabel = orderPaymentRowLabel(order.paymentStatus)
  const paymentTone = orderPaymentRowTone(order.paymentStatus)

  return (
    <article className="order-detail-card">
      <p className="order-row-group-name">{groupName}</p>
      <div className="order-row-meta">
        <span className={`order-pay-status order-pay-status--${paymentTone}`}>{paymentLabel}</span>
        {groupStatus ? (
          <span className={`order-group-status order-group-status--${groupStatus}`}>{groupStatus}</span>
        ) : null}
        <span className="order-detail-inline-code">{order.lookupCode}</span>
      </div>

      <div className="order-detail-body">
        <div className={`order-detail-balance${unpaid ? ' order-detail-balance--due' : ''}`}>
          <span className="order-detail-balance-label">尾款</span>
          <strong className="order-detail-balance-value">NT${Number(order.balance || 0).toLocaleString()}</strong>
        </div>

        <div className="order-detail-stats">
          <div className="order-detail-stat">
            <span className="order-detail-stat-label">訂單金額</span>
            <strong>NT${itemTotal.toLocaleString()}</strong>
          </div>
          <div className="order-detail-stat">
            <span className="order-detail-stat-label">應付訂金</span>
            <strong>NT${Number(order.deposit || 0).toLocaleString()}</strong>
          </div>
          <div className="order-detail-stat">
            <span className="order-detail-stat-label">國內運費</span>
            <strong>NT${Number(order.domesticShipping || 0).toLocaleString()}</strong>
          </div>
          <div className="order-detail-stat">
            <span className="order-detail-stat-label">國際運費</span>
            <strong>NT${Number(order.internationalShipping || 0).toLocaleString()}</strong>
          </div>
        </div>

        <p className="order-detail-section-title">品項明細</p>
        {items.length === 0 ? (
          <p className="order-detail-hint">尚無品項</p>
        ) : (
          <ul className="order-detail-items">
            {items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="order-detail-item">
                <p className="order-detail-item-name">{it.name}</p>
                <p className="order-detail-item-meta">
                  ×{it.qty} · ¥{Number(it.jpyUnit || 0).toLocaleString()} · NT$
                  {Number(it.twdUnit || 0).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}

        {order.notes ? <p className="order-detail-note">備註：{order.notes}</p> : null}
      </div>
    </article>
  )
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const { id: rawId } = useParams()
  const orderId = rawId ? decodeURIComponent(rawId) : ''
  const api = useApi()
  const orders = useDaigouStore((s) => s.orders)
  const customers = useDaigouStore((s) => s.customers)
  const groups = useDaigouStore((s) => s.groups)
  const [gbGroups, setGbGroups] = useState<GroupBuyAppData['groups'] | null>(null)
  const [gbLoading, setGbLoading] = useState(false)

  const o = resolveOrder(orders, rawId || '')
  const c = o ? customers.find((x) => x.id === o.customerId) : undefined
  const v50OrderId = o ? extractV50OrderIdFromDaigou(o) : null
  const v50GroupId = o ? parseV50Refs(o.internalNote).v50GroupId ?? parseV50Refs(o.notes).v50GroupId : undefined

  useEffect(() => {
    if (!v50OrderId) {
      setGbGroups(null)
      return
    }
    let cancelled = false
    setGbLoading(true)
    void api
      .call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      .then((data) => {
        if (cancelled) return
        const list = data.groups || []
        // 同步時寫入 v50CustomerName，並校正客單 customerId
        for (const g of list) syncV50GroupOrdersToDaigou(g)
        setGbGroups(list)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setGbGroups([])
      })
      .finally(() => {
        if (!cancelled) setGbLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, v50OrderId])

  const v50Context = useMemo(() => {
    if (!v50OrderId || !gbGroups) return null
    return findV50OrderContext(gbGroups, v50OrderId, v50GroupId)
  }, [gbGroups, v50GroupId, v50OrderId])

  if (!o) {
    return (
      <div className="order-detail-page space-y-4">
        <Link to="/orders" className="order-detail-back">
          <ArrowLeft className="h-4 w-4" />
          訂單列表
        </Link>
        <Empty title="找不到訂單" description={`查無 ID：${orderId || '（空）'}`} />
      </div>
    )
  }

  const customerName =
    v50Context?.order.customerName?.trim() ||
    resolveOrderCustomerDisplayName(o, c, c?.name || o.lookupCode)
  const g = groups.find((x) => x.id === o.groupId)
  const groupStatus = g ? parseV50GroupStatus(g.internalNotes) : undefined

  if (v50OrderId) {
    return (
      <OrderDetailShell
        customerName={customerName}
        subtitle={v50Context ? `${v50Context.group.name} · ${o.lookupCode}` : `讀取團務資料中… · ${o.lookupCode}`}
      >
        {gbLoading ? (
          <div className="order-detail-loading">正在從團務管理載入訂單資料…</div>
        ) : v50Context ? (
          <>
            <V50OrderDetailPanel group={v50Context.group} order={v50Context.order} lookupCode={o.lookupCode} />
            <RelatedCustomerOrders
              currentOrderId={o.id}
              customerName={customerName}
              orders={orders}
              customers={customers}
              groups={groups}
              gbGroups={gbGroups}
              onOpen={(id) => navigate(`/orders/${id}`)}
            />
          </>
        ) : (
          <div className="order-detail-empty">
            <p>無法從團務管理找到對應客訂，請至團務管理確認是否已刪除。</p>
            <Btn
              variant="secondary"
              className="mt-3"
              onClick={() =>
                navigate(v50GroupId ? `/groups?group=${encodeURIComponent(v50GroupId)}` : '/groups')
              }
            >
              前往團務管理
            </Btn>
          </div>
        )}
      </OrderDetailShell>
    )
  }

  return (
    <OrderDetailShell
      customerName={customerName}
      subtitle={`${g?.name ?? '（未知團）'} · ${o.lookupCode}`}
    >
      <DaigouOrderDetailPanel order={o} groupName={g?.name ?? '（未知團）'} groupStatus={groupStatus} />
      <RelatedCustomerOrders
        currentOrderId={o.id}
        customerName={customerName}
        orders={orders}
        customers={customers}
        groups={groups}
        onOpen={(id) => navigate(`/orders/${id}`)}
      />
    </OrderDetailShell>
  )
}
