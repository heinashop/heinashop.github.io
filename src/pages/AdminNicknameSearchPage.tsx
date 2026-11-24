import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, RefreshCw, Search } from 'lucide-react'
import { Btn, Card, Empty, PageHeader } from '../components/ui'
import { cx } from '../components/app/cx'
import { StaffLookupMemberPreview } from './staffLookup/StaffLookupMemberPreview'
import { StaffLookupStaffPreview } from './staffLookup/StaffLookupStaffPreview'
import { adminSearchOrders, type AdminShipPhase } from '../daigou/portalSearch'
import { useApi } from '../context/useApi'
import type { GroupBuyAppData } from '../api/types'
import { syncV50GroupOrdersToDaigou } from '../modules/groupbuy/v50DaigouSync'
import { classifyDaigouOrder, countOrderBuckets, groupOrdersByCustomerName, ORDER_BUCKET_LABELS, type DaigouOrderBucket } from '../modules/groupbuy/v50Utils'
import { useDaigouStore } from '../daigou/store'
import { CustomerNoteField } from '../components/customers/CustomerNoteField'
import { getOrderStatusLabel, getPaymentStatusLabel } from '../daigou/statusDisplay'
import type { Customer, Order, OrderStatus, PaymentStatus, Transaction } from '../daigou/types'
import '../modules/groupbuy/groupbuy.css'

const ALL_PAYMENT: PaymentStatus[] = [
  'unpaid',
  'deposit_paid',
  'balance_due',
  'fully_paid',
  'overpaid',
  'refunded',
  'partial_refund',
  'bad_debt',
]

const ALL_ORDER: OrderStatus[] = [
  'pending_confirmation',
  'confirmed',
  'waiting_deposit',
  'deposit_paid',
  'ordered',
  'waiting_arrival',
  'arrived',
  'sorting',
  'waiting_balance',
  'fully_paid',
  'ready_to_ship',
  'shipped',
  'completed',
  'cancelled',
  'risk_flagged',
  'stockout_refund',
  'exception',
]


function orderOutstanding(o: Order) {
  if (o.outstandingAmount != null) return Math.max(0, o.outstandingAmount)
  return Math.max(0, o.totalAmount - (o.totalReceived ?? 0))
}

function maskPhoneLast3(last3: string) {
  const t = (last3 || '').trim()
  if (!t) return '—'
  return `•••${t}`
}

type ViewMode = 'staff' | 'member'

export function AdminNicknameSearchPage() {
  const api = useApi()
  const orders = useDaigouStore((s) => s.orders)
  const customers = useDaigouStore((s) => s.customers)
  const updateCustomer = useDaigouStore((s) => s.updateCustomer)
  const groups = useDaigouStore((s) => s.groups)
  const transactions = useDaigouStore((s) => s.transactions)
  const addToast = useDaigouStore((s) => s.addToast)

  const [syncing, setSyncing] = useState(true)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<ViewMode>('staff')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [payFilter, setPayFilter] = useState<PaymentStatus | ''>('')
  const [orderFilter, setOrderFilter] = useState<OrderStatus | ''>('')
  const [shipPhase, setShipPhase] = useState<AdminShipPhase>('')
  const [orderBucketTab, setOrderBucketTab] = useState<DaigouOrderBucket>('pending')

  const refreshFromGroupbuy = useCallback(async () => {
    setSyncing(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      for (const g of data.groups || []) syncV50GroupOrdersToDaigou(g)
    } catch (e) {
      console.error(e)
      addToast('團務資料同步失敗', 'err')
    } finally {
      setSyncing(false)
    }
  }, [api, addToast])

  useEffect(() => {
    void refreshFromGroupbuy()
  }, [refreshFromGroupbuy])

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  const nameSearchOrders = useMemo(
    () =>
      adminSearchOrders({ orders, customers, groups }, q, {
        groupId: groupId || undefined,
        paymentStatus: payFilter,
        orderStatus: orderFilter,
        shipPhase: shipPhase || undefined,
      }),
    [orders, customers, groups, q, groupId, payFilter, orderFilter, shipPhase],
  )

  const bucketCounts = useMemo(
    () => countOrderBuckets(nameSearchOrders, groupsById),
    [nameSearchOrders, groupsById],
  )

  const filteredOrders = useMemo(() => {
    return nameSearchOrders.filter((o) => {
      const g = groupsById.get(o.groupId)
      return classifyDaigouOrder(o.paymentStatus, g?.internalNotes, o.orderStatus) === orderBucketTab
    })
  }, [nameSearchOrders, groupsById, orderBucketTab])

  const customerGroups = useMemo(
    () => groupOrdersByCustomerName(filteredOrders, customers),
    [filteredOrders, customers],
  )

  const txByCustomer = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of transactions) {
      const cid = t.customerId
      if (!cid) continue
      const arr = map.get(cid) ?? []
      arr.push(t)
      map.set(cid, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const da = new Date(a.date).getTime()
        const db = new Date(b.date).getTime()
        if (db !== da) return db - da
        return (b.createdAt ?? 0) - (a.createdAt ?? 0)
      })
    }
    return map
  }, [transactions])

  function pickPrimaryCustomer(custOrders: Order[]): Customer | undefined {
    const ids = [...new Set(custOrders.map((o) => o.customerId))]
    const rows = ids.map((id) => customers.find((c) => c.id === id)).filter((c): c is Customer => Boolean(c))
    return rows[0]
  }

  function runSearch() {
    setQ(draft.trim())
    setOrderBucketTab('pending')
  }

  function resetFilters() {
    setDraft('')
    setQ('')
    setGroupId('')
    setPayFilter('')
    setOrderFilter('')
    setShipPhase('')
    setOrderBucketTab('pending')
  }

  async function copyOrderSummary(o: Order) {
    const c = customers.find((x) => x.id === o.customerId)
    const g = groups.find((x) => x.id === o.groupId)
    const lines = [
      `查詢碼：${o.lookupCode}`,
      `客戶：${c?.lineDisplayName ?? ''}（${c?.name ?? ''}）`,
      `團務：${g?.name ?? ''}`,
      `應付：NT$ ${o.totalAmount.toLocaleString()}／未收：NT$ ${orderOutstanding(o).toLocaleString()}`,
      `付款：${getPaymentStatusLabel(o.paymentStatus)}／訂單：${getOrderStatusLabel(o.orderStatus)}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      addToast('已複製摘要到剪貼簿', 'ok')
    } catch {
      addToast('無法複製，請手動選取', 'err')
    }
  }

  return (
    <div className="nickname-search-page space-y-6">
      <PageHeader
        title="暱稱查單"
        action={
          <>
            <Btn variant="secondary" className="nickname-search-sync-btn" onClick={() => void refreshFromGroupbuy()} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              同步團務
            </Btn>
            <div
              className="nickname-search-view-toggle flex w-full rounded-xl border border-white/[0.08] bg-ds-card/45 p-1 shadow-inner sm:w-auto"
              role="group"
              aria-label="結果檢視模式"
            >
              <button
                type="button"
                className={cx(
                  'cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold tracking-tight transition sm:py-2',
                  view === 'staff' ? 'bg-ds-primary/22 text-ds-text shadow-[0_0_20px_rgba(91,140,255,0.18)]' : 'text-ds-text-secondary hover:bg-white/[0.05] hover:text-ds-text',
                )}
                onClick={() => setView('staff')}
              >
                後台檢視
              </button>
              <button
                type="button"
                className={cx(
                  'cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold tracking-tight transition sm:py-2',
                  view === 'member' ? 'bg-ds-primary/22 text-ds-text shadow-[0_0_20px_rgba(91,140,255,0.18)]' : 'text-ds-text-secondary hover:bg-white/[0.05] hover:text-ds-text',
                )}
                onClick={() => setView('member')}
              >
                顧客畫面預覽
              </button>
            </div>
          </>
        }
      />

      <Card className="nickname-search-panel space-y-4 !p-4 md:!p-5">
        <div>
          <label className="block text-meta font-semibold text-ds-text-secondary">客人名字</label>
          <input
            className="nickname-search-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder="輸入客人名字（支援部分比對）"
            aria-label="客人名字"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn type="button" onClick={runSearch} disabled={syncing}>
            <Search className="h-4 w-4" />
            查詢
          </Btn>
          <Btn type="button" variant="secondary" onClick={resetFilters}>
            清除
          </Btn>
          <Btn type="button" variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '收合進階篩選' : '進階篩選'}
          </Btn>
        </div>
        {showAdvanced ? (
        <div className="grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-meta font-semibold text-ds-text-secondary">
            團務
            <select className="mt-2 w-full" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="篩選團務">
              <option value="">全部團務</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-meta font-semibold text-ds-text-secondary">
            付款狀態
            <select className="mt-2 w-full" value={payFilter} onChange={(e) => setPayFilter(e.target.value as PaymentStatus | '')} aria-label="篩選付款狀態">
              <option value="">全部</option>
              {ALL_PAYMENT.map((p) => (
                <option key={p} value={p}>
                  {getPaymentStatusLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-meta font-semibold text-ds-text-secondary">
            訂單狀態
            <select className="mt-2 w-full" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value as OrderStatus | '')} aria-label="篩選訂單狀態">
              <option value="">全部</option>
              {ALL_ORDER.map((s) => (
                <option key={s} value={s}>
                  {getOrderStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-meta font-semibold text-ds-text-secondary">
            出貨／配送階段
            <select className="mt-2 w-full" value={shipPhase} onChange={(e) => setShipPhase(e.target.value as AdminShipPhase)} aria-label="篩選出貨階段">
              <option value="">全部</option>
              <option value="not_shipped">尚未出貨／進行中</option>
              <option value="shipped">已出貨（運送中）</option>
              <option value="completed">已完成</option>
              <option value="issue">異常／風險</option>
            </select>
          </label>
        </div>
        ) : null}
      </Card>

      {syncing ? (
        <p className="text-body text-ds-text-muted">正在同步團務客訂資料…</p>
      ) : null}

      {q ? (
        <>
        <div className="gb-admin-tabs gb-order-tabs mb-4">
          {(Object.keys(ORDER_BUCKET_LABELS) as DaigouOrderBucket[]).map((key) => (
            <button
              key={key}
              type="button"
              className={orderBucketTab === key ? 'gb-tab gb-tab-active' : 'gb-tab'}
              onClick={() => setOrderBucketTab(key)}
            >
              {ORDER_BUCKET_LABELS[key]}（{bucketCounts[key]}）
            </button>
          ))}
        </div>
        </>
      ) : null}

      {!q ? (
        <Empty
          icon={ClipboardList}
          title="輸入客人名字後查詢"
          hint="資料已與團務管理同步。輸入名字後按查詢，即可看到該客人所有訂單與付款／訂單狀態。"
        />
      ) : nameSearchOrders.length === 0 ? (
        <Empty
          title="查無資料"
          hint="找不到符合條件的客單，請嘗試改用暱稱、手機末三碼或商品關鍵字；或放寬團務／狀態篩選。"
        />
      ) : filteredOrders.length === 0 ? (
        <Empty
          title={`沒有${ORDER_BUCKET_LABELS[orderBucketTab]}`}
          hint="切換其他分頁查看此客人的其他訂單。"
        />
      ) : (
        <div className="space-y-8">
          {customerGroups.map((group) => {
            const custOrders = group.orders
            const c = pickPrimaryCustomer(custOrders)
            if (!c) return null
            const txs = [...new Set(custOrders.map((o) => o.customerId))]
              .flatMap((id) => txByCustomer.get(id) ?? [])
              .sort((a, b) => {
                const da = new Date(a.date).getTime()
                const db = new Date(b.date).getTime()
                if (db !== da) return db - da
                return (b.createdAt ?? 0) - (a.createdAt ?? 0)
              })
            const primaryName = c.lineDisplayName || c.name

            return (
              <Card key={group.name} className="space-y-5 !p-4 md:!p-6">
                <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-section font-semibold text-ds-text">{group.name}</h2>
                    <p className="mt-1 text-body text-ds-text-secondary">
                      LINE：{primaryName} · 手機尾碼 {maskPhoneLast3(c.phoneLast3)}
                      {c.socialAccount?.trim() ? ` · 社群：${c.socialAccount}` : null}
                    </p>
                    <p className="mt-2 text-meta text-ds-text-muted">
                      訂單 {custOrders.length} 筆 · 未結餘額 NT$ {c.totalUnpaidBalance.toLocaleString()}
                      {c.lastOrderAt ? ` · 最近訂單 ${c.lastOrderAt}` : ''}
                    </p>
                    <div className="nickname-customer-note">
                      <CustomerNoteField
                        compact
                        autoSize
                        value={c.customerNote}
                        onSave={(next) => updateCustomer(c.id, { customerNote: next })}
                      />
                    </div>
                  </div>
                  <Link className="text-body font-semibold text-ds-primary hover:underline" to={`/customers/${c.id}`}>
                    客戶詳情
                  </Link>
                </div>

                {view === 'member' ? (
                  <div className="max-h-[min(72vh,860px)] overflow-y-auto overflow-x-hidden rounded-xl">
                    <StaffLookupMemberPreview
                      lineDisplayName={primaryName}
                      orders={custOrders}
                      groupsById={groupsById}
                      orderBucket={orderBucketTab}
                    />
                  </div>
                ) : (
                  <div className="max-h-[min(72vh,860px)] overflow-y-auto overflow-x-hidden rounded-xl">
                    <StaffLookupStaffPreview
                      lineDisplayName={primaryName}
                      orders={custOrders}
                      groupsById={groupsById}
                      orderBucket={orderBucketTab}
                      transactions={txs}
                      onCopyOrderSummary={(o) => void copyOrderSummary(o)}
                    />
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
