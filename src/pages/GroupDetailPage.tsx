import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Card, Btn, Chip, PageHeader, Empty } from '../components/ui'
import { AppCard } from '../components/app/AppCard'
import { PageGrid, Col } from '../components/app/PageLayout'
import { StepTimeline } from '../components/app/StepTimeline'
import { DataRowCard } from '../components/app/DataRowCard'
import { useDaigouStore } from '../daigou/store'
import {
  ALL_GROUP_STATUSES,
  GROUP_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  TRANSACTION_CATEGORY_LABEL,
  TRANSACTION_TYPE_LABEL,
} from '../daigou/constants'
import type { GroupStatus } from '../daigou/types'
import { groupProfit } from '../daigou/selectors'
import { downloadCsv } from '../daigou/csv'

export function GroupDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const groups = useDaigouStore((s) => s.groups)
  const products = useDaigouStore((s) => s.products)
  const orders = useDaigouStore((s) => s.orders)
  const transactions = useDaigouStore((s) => s.transactions)
  const customers = useDaigouStore((s) => s.customers)
  const updateGroup = useDaigouStore((s) => s.updateGroup)
  const duplicateGroup = useDaigouStore((s) => s.duplicateGroup)
  const archiveGroup = useDaigouStore((s) => s.archiveGroup)
  const addToast = useDaigouStore((s) => s.addToast)
  const [tab, setTab] = useState<'products' | 'orders' | 'ledger' | 'profit'>('products')

  const g = groups.find((x) => x.id === id)
  const gp = useDaigouStore((s) => (id ? groupProfit(s, id) : 0))

  const gProducts = useMemo(() => products.filter((p) => p.groupId === id), [products, id])
  const gOrders = useMemo(() => orders.filter((o) => o.groupId === id), [orders, id])
  const gTx = useMemo(() => transactions.filter((t) => t.groupId === id), [transactions, id])

  const stepItems = useMemo(() => ALL_GROUP_STATUSES.map((s) => ({ id: s, label: GROUP_STATUS_LABEL[s] })), [])

  if (!g) {
    return (
      <div>
        <Link to="/groups" className="mb-4 inline-flex text-sm font-semibold text-ds-primary hover:text-ds-highlight hover:underline">
          ← 返回團務
        </Link>
        <Empty title="找不到此團" hint="可能已被刪除或 ID 錯誤。" />
      </div>
    )
  }

  const group = g
  const activeStepIndex = Math.max(0, ALL_GROUP_STATUSES.indexOf(group.status))

  function exportSummary() {
    const rows: (string | number)[][] = [
      ['團名', '狀態', '截團日', '匯率', '團 JPY', '訂單數', '預估團利潤(TWD)'],
      [
        group.name,
        GROUP_STATUS_LABEL[group.status],
        group.closingDate,
        group.exchangeRate,
        group.jpyAmountTotal,
        gOrders.length,
        gp,
      ],
    ]
    downloadCsv(`團務_${group.name}_摘要.csv`, rows)
    addToast('已匯出團摘要', 'ok')
  }

  return (
    <div>
      <Link
        to="/groups"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ds-primary hover:text-ds-highlight hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        團務列表
      </Link>
      <PageHeader
        title={group.name}
        subtitle={`訂單編號 ${group.orderNumber} · 物流 ${group.logisticsNumber || '—'}`}
        action={
          <>
            <Btn
              variant="secondary"
              onClick={() => {
                const nid = duplicateGroup(group.id)
                if (nid) navigate(`/groups/${nid}`)
              }}
            >
              複製團務
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => {
                archiveGroup(group.id)
                navigate('/groups')
              }}
            >
              封存團務
            </Btn>
            <Btn variant="secondary" onClick={exportSummary}>
              匯出摘要 CSV
            </Btn>
            {group.purchaseLink ? (
              <Btn variant="secondary" href={group.purchaseLink} target="_blank">
                開啟採購連結
              </Btn>
            ) : null}
          </>
        }
      />

      <PageGrid className="mb-8">
        <Col span={4}>
          <AppCard hover={false} className="!p-5">
            <p className="text-meta font-semibold uppercase tracking-wide text-ds-text-muted">團務進度</p>
            <div className="mt-4">
              <StepTimeline steps={stepItems} activeIndex={activeStepIndex} />
            </div>
          </AppCard>
        </Col>
        <Col span={8}>
          <Card className="!p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-meta font-semibold text-ds-text-muted">團狀態</p>
                <select
                  className="mt-2 w-full"
                  value={group.status}
                  onChange={(e) => updateGroup(group.id, { status: e.target.value as GroupStatus })}
                >
                  {ALL_GROUP_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {GROUP_STATUS_LABEL[st]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-meta font-semibold text-ds-text-muted">截團 / 出貨</p>
                <p className="mt-2 text-body text-ds-text-secondary">
                  {group.closingDate} → {group.officialShipDate}
                </p>
              </div>
              <div>
                <p className="text-meta font-semibold text-ds-text-muted">匯率</p>
                <p className="mt-2 text-body font-bold tabular-nums text-ds-text">{group.exchangeRate}</p>
              </div>
              <div>
                <p className="text-meta font-semibold text-ds-text-muted">團 JPY 合計</p>
                <p className="mt-2 text-body font-bold tabular-nums text-ds-text">¥ {group.jpyAmountTotal.toLocaleString()}</p>
              </div>
            </div>
          </Card>
        </Col>
      </PageGrid>

      {group.notes ? (
        <AppCard hover={false} className="mb-6 !p-4">
          <span className="font-semibold text-ds-text-secondary">備註：</span>
          <span className="text-body text-ds-text-secondary">{group.notes}</span>
        </AppCard>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ['products', '團內商品'],
            ['orders', '團內訂單'],
            ['ledger', '團帳務'],
            ['profit', '利潤試算'],
          ] as const
        ).map(([k, label]) => (
          <Btn key={k} variant={tab === k ? 'primary' : 'secondary'} className="!py-2 text-xs" onClick={() => setTab(k)}>
            {label}
          </Btn>
        ))}
      </div>

      {tab === 'products' && (
        <div className="space-y-3">
          {gProducts.length === 0 ? (
            <Empty title="此團尚無商品" hint="到商品頁新增並指定團別。" />
          ) : (
            gProducts.map((p) => (
              <DataRowCard key={p.id} clickable={false}>
                <div className="flex gap-4">
                  <img loading="lazy" decoding="async" src={p.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-white/[0.08]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ds-text">{p.name}</p>
                    <p className="text-meta text-ds-text-muted">
                      JPY {p.jpyPrice} → TWD {p.twdPrice}
                    </p>
                  </div>
                  <Btn variant="ghost" className="!px-2 text-xs" to="/products">
                    商品
                  </Btn>
                </div>
              </DataRowCard>
            ))
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          {gOrders.map((o) => {
            const c = customers.find((x) => x.id === o.customerId)
            return (
              <DataRowCard
                key={o.id}
                role="presentation"
                clickable
                onClick={() => navigate(`/orders/${o.id}`)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold text-ds-primary">{o.lookupCode}</p>
                    <p className="text-meta text-ds-text-muted">{c?.name ?? o.customerId}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Chip tone="info">{ORDER_STATUS_LABEL[o.orderStatus]}</Chip>
                    <Chip tone="warn">{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Chip>
                  </div>
                </div>
              </DataRowCard>
            )
          })}
        </div>
      )}

      {tab === 'ledger' && (
        <AppCard hover={false} className="!p-0">
          <div className="border-b border-white/[0.06] px-5 py-3 text-meta font-semibold text-ds-text-muted">團內分錄</div>
          <div className="divide-y divide-white/[0.05]">
            {gTx.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition hover:bg-white/[0.03]">
                <span className="text-meta text-ds-text-muted">{t.date}</span>
                <span className="text-body text-ds-text-secondary">{TRANSACTION_TYPE_LABEL[t.type]}</span>
                <span className="text-body text-ds-text">{TRANSACTION_CATEGORY_LABEL[t.category]}</span>
                <span className="ml-auto font-mono text-body font-semibold tabular-nums text-ds-text">
                  {t.amount.toLocaleString()} {t.currency}
                </span>
              </div>
            ))}
          </div>
        </AppCard>
      )}

      {tab === 'profit' && (
        <AppCard>
          <p className="text-body text-ds-text-secondary">
            以下為本團在示範帳本中的 <span className="font-semibold text-ds-text">收入 − 支出</span> 簡化試算（實務請依實際成本調整）。
          </p>
          <p className="mt-6 bg-gradient-to-r from-ds-success to-ds-highlight bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent">
            NT$ {gp.toLocaleString()}
          </p>
          <p className="mt-2 text-meta text-ds-text-muted">帳務筆數 {gTx.length}</p>
        </AppCard>
      )}
    </div>
  )
}
