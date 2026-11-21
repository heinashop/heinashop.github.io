import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, Btn, Chip, Empty } from '../components/ui'
import { useDaigouStore } from '../daigou/store'
import { findPortalOrders } from '../daigou/portalSearch'
import { MEMBERSHIP_TIER_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from '../daigou/constants'
import { tierDef } from '../daigou/membershipTiers'
import { PortalLayoutBadge } from './customer-portal/PortalLayoutBadge'
import { PortalLayoutToggle } from './customer-portal/PortalLayoutToggle'
import { usePortalLayoutMode } from './customer-portal/portalLayoutPreference'
import './CustomerPortalSimple.layout.css'

export function CustomerPortalPage() {
  const store = useDaigouStore()
  const { settings, customers, products, shipments } = store
  const { layoutClass, mode, setMode, effectiveLayout } = usePortalLayoutMode()
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const results = searched ? findPortalOrders(store, q) : []

  function runSearch() {
    setSearched(true)
  }

  async function copyBank() {
    await navigator.clipboard.writeText(settings.bankInfo)
    setToast('已複製匯款資訊')
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className={'kp-simple-portal ' + layoutClass} data-layout={effectiveLayout}>
      <div className="kp-simple-portal-inner">
        <div className="kp-simple-portal-top">
          <div className="flex flex-wrap items-center gap-2">
            <PortalLayoutBadge layout={effectiveLayout} />
            <PortalLayoutToggle mode={mode} onChange={setMode} />
          </div>
          <p className="text-[11px] text-zinc-500">
            <Link to="/lookup" className="font-medium text-indigo-600 hover:underline">
              完整顧客專區
            </Link>
          </p>
        </div>

        <header className="kp-simple-portal-header mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-lg font-bold text-white shadow-lg shadow-indigo-500/30">
            HM
          </div>
          <h1 className="text-[1.375rem] font-bold leading-tight tracking-tight text-zinc-900 sm:text-2xl">訂單查詢</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-500">輸入 LINE 顯示名稱、手機末三碼或查詢碼</p>
        </header>

        {settings.portalAnnouncement ? (
          <Card className="mb-4 border-indigo-100 bg-indigo-50/60 text-sm text-indigo-900">{settings.portalAnnouncement}</Card>
        ) : null}

        <Card className="kp-simple-search-card mb-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              className="min-h-12 w-full rounded-xl border border-zinc-200 py-3 pl-11 pr-3 text-base outline-none focus:ring-2 focus:ring-indigo-500/30 sm:text-sm"
              placeholder="例：LINE_阿哲、789、HMB-10001"
              enterKeyHint="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </div>
          <Btn className="mt-3 w-full" onClick={runSearch}>
            查詢訂單
          </Btn>
        </Card>

        <AnimatePresence>
          {toast ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 rounded-xl bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white"
            >
              {toast}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!searched ? (
          <p className="text-center text-xs text-zinc-400">查詢結果僅供買家確認進度與金額，不含店家內部毛利。</p>
        ) : results.length === 0 ? (
          <Empty title="查無資料" hint="請確認與留單時相同的 LINE 名稱或手機末三碼。" />
        ) : (
          <div className="kp-simple-results space-y-4">
            {(() => {
              const ids = [...new Set(results.map((o) => o.customerId))]
              if (ids.length !== 1) return null
              const cust = customers.find((c) => c.id === ids[0])
              if (!cust) return null
              const tid = cust.membershipTierId ?? 'regular'
              const def = tierDef(tid)
              return (
                <Card key="member-tier" className="border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50/80">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">會員禮遇</p>
                  <p className="mt-1 text-base font-bold text-amber-950">{MEMBERSHIP_TIER_LABEL[tid]}</p>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-amber-950/90">
                    {def.memberBenefits.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] leading-relaxed text-amber-900/75">
                    等級會依您的累積消費自動調整，此處不顯示金額。實際折扣／活動以社群與闆娘最新公告為準。
                  </p>
                </Card>
              )
            })()}
            {results.map((o) => {
              const cust = customers.find((c) => c.id === o.customerId)
              const ship = shipments.find((s) => s.orderId === o.id)
              return (
                <motion.div key={o.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Card>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-lg font-bold text-indigo-700">{o.lookupCode}</p>
                      <div className="flex flex-wrap gap-1">
                        <Chip tone="info">{ORDER_STATUS_LABEL[o.orderStatus]}</Chip>
                        <Chip tone="warn">{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Chip>
                      </div>
                    </div>
                    <p className="text-sm text-zinc-600">買家暱稱：{cust?.lineDisplayName ?? '—'}</p>
                    <div className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">訂金</span>
                        <span className="font-semibold">NT$ {o.deposit.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">尾款／待結</span>
                        <span className="font-semibold text-amber-800">NT$ {o.balance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">國內運費</span>
                        <span className="font-semibold">NT$ {o.domesticShipping.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">國際運費</span>
                        <span className="font-semibold">NT$ {o.internationalShipping.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between border-t border-zinc-200 pt-2 font-bold text-zinc-900">
                        <span>應付總額</span>
                        <span>NT$ {o.totalAmount.toLocaleString()}</span>
                      </div>
                    </div>
                    {ship ? (
                      <div className="mt-3 rounded-xl border border-zinc-100 bg-white p-3 text-sm">
                        <p className="font-semibold text-zinc-800">物流追蹤</p>
                        <p className="mt-1 text-zinc-600">
                          {ship.carrier} · 單號 <span className="font-mono font-medium">{ship.trackingNo}</span>
                        </p>
                        <Chip tone="info" className="mt-2">
                          {SHIPMENT_STATUS_LABEL[ship.status]}
                        </Chip>
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      <p className="text-xs font-semibold text-zinc-500">品項</p>
                      {o.items.map((it, i) => {
                        const img = products.find((p) => p.id === it.productId)?.imageUrl
                        return (
                          <div key={i} className="flex gap-3">
                            {img ? <img loading="lazy" decoding="async" src={img} alt="" className="h-16 w-16 rounded-lg object-cover" /> : null}
                            <div className="text-sm">
                              <p className="font-medium text-zinc-900">{it.name}</p>
                              <p className="text-xs text-zinc-500">×{it.qty}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {o.customerNote?.trim() ? (
                      <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm text-indigo-950">
                        <p className="text-xs font-semibold text-indigo-900/90">抵達／付款說明（開團明細匯入）</p>
                        <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{o.customerNote}</p>
                      </div>
                    ) : null}
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}

        <Card className="mt-8">
          <h2 className="text-sm font-bold text-zinc-900">匯款資訊</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{settings.bankInfo}</p>
          <Btn variant="secondary" className="mt-3 w-full" onClick={copyBank}>
            一鍵複製匯款文字
          </Btn>
        </Card>

        <p className="kp-simple-footer-links mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs text-zinc-500">
          <Link to="/lookup" className="font-medium text-indigo-600 hover:underline">
            完整顧客專區
          </Link>
          <Link to="/home" className="font-medium text-indigo-600 hover:underline">
            行銷首頁
          </Link>
          <Link to="/shop" className="font-medium text-indigo-600 hover:underline">
            現貨商城
          </Link>
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">
            團主後台
          </Link>
        </p>
      </div>
    </div>
  )
}
