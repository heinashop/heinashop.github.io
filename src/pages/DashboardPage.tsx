import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  Truck,
  Wallet,
  Building2,
} from 'lucide-react'
import { Btn } from '../components/ui'
import { useApi } from '../context/useApi'
import { useRemoteSlice } from '../sync/SheetSyncBridge'
import type { GroupBuyAppData } from '../api/types'
import { useDaigouStore } from '../daigou/store'
import { commercialDashboard, type PendingDepositCustomerRow } from '../daigou/commercialDashboard'
import { summarizePendingDepositByCustomerFromGroups } from '../modules/groupbuy/paymentReportLogic'
import { countExpectedInboundThisMonth } from '../modules/groupbuy/inboundMonthLogic'
import { TRANSACTION_CATEGORY_LABEL } from '../daigou/constants'
import './dashboardPage.css'

function linkTo(l: { to: string; search?: string }) {
  if (!l.search) return l.to
  const q = l.search.startsWith('?') ? l.search.slice(1) : l.search
  return `${l.to}?${q}`
}

function money(n: number) {
  return `NT$ ${Math.round(n || 0).toLocaleString('zh-TW')}`
}

function mergePendingDepositRows(
  primary: PendingDepositCustomerRow[],
  secondary: PendingDepositCustomerRow[],
): PendingDepositCustomerRow[] {
  const map = new Map<string, PendingDepositCustomerRow>()
  for (const row of [...primary, ...secondary]) {
    const key = row.name.toLowerCase()
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { ...row })
      continue
    }
    // 同名以較高金額為準（避免團務鏡像與本機客單重複加總）
    if (row.depositTotal > existing.depositTotal) {
      map.set(key, { ...row })
    }
  }
  return [...map.values()].sort(
    (a, b) => b.depositTotal - a.depositTotal || a.name.localeCompare(b.name, 'zh-Hant'),
  )
}

export function DashboardPage() {
  const api = useApi()
  const groups = useDaigouStore((s) => s.groups)
  const orders = useDaigouStore((s) => s.orders)
  const s = useDaigouStore()
  const dash = commercialDashboard(s)
  const [groupbuyPending, setGroupbuyPending] = useState<PendingDepositCustomerRow[]>([])
  const [inboundExpectedCount, setInboundExpectedCount] = useState(0)

  const loadGroupbuyPending = useCallback(async () => {
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      const loadedGroups = data.groups || []
      setGroupbuyPending(summarizePendingDepositByCustomerFromGroups(loadedGroups))
      setInboundExpectedCount(countExpectedInboundThisMonth(loadedGroups))
    } catch (e) {
      console.error(e)
      setGroupbuyPending([])
      setInboundExpectedCount(0)
    }
  }, [api])

  useEffect(() => {
    void loadGroupbuyPending()
  }, [loadGroupbuyPending])
  useRemoteSlice(() => {
    void loadGroupbuyPending()
  })

  const pendingDepositRows = useMemo(
    () => mergePendingDepositRows(groupbuyPending, dash.pendingDepositByCustomer),
    [groupbuyPending, dash.pendingDepositByCustomer],
  )
  const pendingDepositCustomersTotal = useMemo(
    () => pendingDepositRows.reduce((a, r) => a + r.depositTotal, 0),
    [pendingDepositRows],
  )

  const payPreview = dash.recentIncomeTx.slice(0, 5)
  const shipPreview = dash.recentShipments.slice(0, 5)

  return (
    <div className="dash-page">
      <section className="dash-hero">
        <p className="dash-hero-kicker">Operations</p>
        <div className="dash-hero-title-row">
          <h1>營運總覽</h1>
          <Btn variant="secondary" className="dash-hero-center-btn" to="/group-buy-center">
            開團中心
          </Btn>
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>團務時程</h2>
          <Link to={linkTo(dash.links.receivable)}>應收 {money(dash.receivableOutstanding)}</Link>
        </div>
        <div className="dash-kpi-grid dash-kpi-grid--3">
          <Link className="dash-kpi dash-kpi--lilac" to={linkTo(dash.links.closingGroups)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">即將結單</p>
              <span className="dash-kpi-icon">
                <CalendarClock className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{dash.closingSoonGroupCount}</p>
            <p className="dash-kpi-hint">近七日截團團務</p>
          </Link>

          <Link className="dash-kpi dash-kpi--peach" to={linkTo(dash.links.saleEndingGroups)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">即將結束販賣</p>
              <span className="dash-kpi-icon">
                <CalendarClock className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{dash.saleEndingSoonGroupCount}</p>
            <p className="dash-kpi-hint">近七日結束販賣</p>
          </Link>
          <Link className="dash-kpi dash-kpi--sky" to="/inbound-month">
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">本月進倉</p>
              <span className="dash-kpi-icon">
                <Building2 className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{inboundExpectedCount}</p>
            <p className="dash-kpi-hint">官方出貨月＝本月，尚未進日本倉</p>
          </Link>
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>今日優先</h2>
          <Link to={linkTo(dash.links.todayTodos)}>查看待辦</Link>
        </div>
        <div className="dash-kpi-grid">
          <Link className="dash-kpi dash-kpi--amber" to={linkTo(dash.links.todayTodos)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">今日待處理</p>
              <span className="dash-kpi-icon">
                <CalendarClock className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{dash.todayTodos}</p>
            <p className="dash-kpi-hint">待確認／截團／逾期取貨</p>
          </Link>

          <Link className="dash-kpi dash-kpi--sky" to={linkTo(dash.links.pendingDeposit)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">待收訂金</p>
              <span className="dash-kpi-icon">
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{money(dash.pendingDepositTwd)}</p>
            <p className="dash-kpi-hint">未付訂金催款（不含已結束／貨到付款）</p>
          </Link>

          <Link className="dash-kpi dash-kpi--rose" to={linkTo(dash.links.pendingBalance)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">待收尾款</p>
              <span className="dash-kpi-icon">
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{money(dash.pendingBalanceTwd)}</p>
            <p className="dash-kpi-hint">訂金已付／尾款待收</p>
          </Link>

          <Link className="dash-kpi dash-kpi--mint" to={linkTo(dash.links.unshipped)}>
            <div className="dash-kpi-top">
              <p className="dash-kpi-label">待出貨</p>
              <span className="dash-kpi-icon">
                <Truck className="h-4 w-4" />
              </span>
            </div>
            <p className="dash-kpi-value">{dash.unshippedOrderCount}</p>
            <p className="dash-kpi-hint">可安排出貨的客單</p>
          </Link>
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>尚未付訂金 · 催款名單</h2>
          <Link to={linkTo(dash.links.pendingDeposit)}>客單列表</Link>
        </div>
        <div className="dash-deposit-panel">
          <div className="dash-deposit-summary">
            <div>
              <p className="dash-deposit-summary-label">待催訂金合計</p>
              <p className="dash-deposit-summary-value">{money(pendingDepositCustomersTotal)}</p>
            </div>
            <p className="dash-deposit-summary-meta">
              {pendingDepositRows.length} 位客人 ·{' '}
              {pendingDepositRows.reduce((a, r) => a + r.orderCount, 0)} 筆未付
              （不含已結束／貨到付款）
            </p>
          </div>
          {pendingDepositRows.length === 0 ? (
            <p className="dash-empty">目前沒有需要催訂金的客人。</p>
          ) : (
            <div className="dash-deposit-table" role="table" aria-label="尚未付訂金客人總整理">
              <div className="dash-deposit-table-head" role="row">
                <span role="columnheader">客人</span>
                <span role="columnheader">未付筆數</span>
                <span role="columnheader">待付訂金總額</span>
              </div>
              {pendingDepositRows.map((row) => (
                <Link
                  key={row.name}
                  className="dash-deposit-table-row"
                  role="row"
                  to={`/orders?dash=wait-deposit&customer=${encodeURIComponent(row.name)}&q=${encodeURIComponent(row.name)}`}
                >
                  <span className="dash-deposit-name" role="cell">
                    {row.name}
                  </span>
                  <span className="dash-deposit-count" role="cell">
                    {row.orderCount} 筆
                  </span>
                  <strong className="dash-deposit-amount" role="cell">
                    {money(row.depositTotal)}
                  </strong>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>快捷入口</h2>
        </div>
        <div className="dash-shortcuts">
          <Link className="dash-shortcut" to="/inbound-month">
            <strong>本月進倉</strong>
            <span>依官方出貨月查看哪些團會到日本倉</span>
          </Link>
          <Link className="dash-shortcut" to="/group-buy-center">
            <strong>開團中心</strong>
            <span>團務狀態、Excel、付款回報匯出</span>
          </Link>
          <Link className="dash-shortcut" to="/payment-reports">
            <strong>付款回報</strong>
            <span>確認客人匯款與訂金沖銷</span>
          </Link>
          <Link className="dash-shortcut" to="/live">
            <strong>連線管理</strong>
            <span>現場連線貨到付款同步出貨</span>
          </Link>
          <Link className="dash-shortcut" to="/orders">
            <strong>客單管理</strong>
            <span>查詢、改單與付款狀態</span>
          </Link>
        </div>
      </section>

      <div className="dash-layout dash-section">
        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>需要注意</h3>
            <Link to="/myship-records" className="text-xs font-bold" style={{ color: '#3d6f96' }}>
              賣貨便 →
            </Link>
          </div>
          <div className="dash-panel-body">
            {dash.overdueRiskAlerts.length === 0 ? (
              <p className="dash-empty">目前沒有額外警示，維持現況即可。</p>
            ) : (
              <div className="dash-alert-list">
                {dash.overdueRiskAlerts.slice(0, 6).map((a) => (
                  <Link key={a.id} className="dash-alert" to={linkTo(a.link)}>
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>最近動態</h3>
            <Link to="/shipment-records" className="text-xs font-bold" style={{ color: '#3d6f96' }}>
              出貨紀錄 →
            </Link>
          </div>
          <div className="dash-panel-body">
            <div className="dash-activity">
              {payPreview.map((t) => (
                <div key={t.id} className="dash-activity-row">
                  <div>
                    <p className="dash-activity-title">{TRANSACTION_CATEGORY_LABEL[t.category]}</p>
                    <p className="dash-activity-sub">收款入帳 · {t.date}</p>
                  </div>
                  <p className="dash-activity-meta">{money(t.amount)}</p>
                </div>
              ))}
              {shipPreview.map((r) => (
                <div key={r.id} className="dash-activity-row">
                  <div>
                    <p className="dash-activity-title">{r.status}</p>
                    <p className="dash-activity-sub">出貨 · {r.trackingNo || '無追蹤碼'}</p>
                  </div>
                  <p className="dash-activity-meta">{r.updatedAt?.slice(0, 10) ?? ''}</p>
                </div>
              ))}
              {!payPreview.length && !shipPreview.length ? (
                <p className="dash-empty">尚無近期收款或出貨紀錄。</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p className="dash-foot">
        本機客單 {orders.length} 筆 · 團務 {groups.length} 團
        <span className="mx-2">·</span>
        <Link to="/integrations" style={{ color: '#3d6f96', fontWeight: 700 }}>
          工具中心
        </Link>
        <span className="mx-1">/</span>
        <Link to="/settings" style={{ color: '#3d6f96', fontWeight: 700 }}>
          系統設定
        </Link>
      </p>
    </div>
  )
}
