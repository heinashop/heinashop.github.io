import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  CalendarClock,
  ClipboardList,
  FileDown,
  FileUp,
  Layers,
  RefreshCw,
  ScrollText,
  Truck,
  Wallet,
  ArrowRight,
  Users,
  Receipt,
  Download,
} from 'lucide-react'
import { PageHeader, Btn, Modal } from '../components/ui'
import { PageLayout } from '../components/app/PageLayout'
import { useApi } from '../context/useApi'
import { isSheetEditing, mergeGroupList } from '../sync/sheetSync'
import { useRemoteSlice } from '../sync/SheetSyncBridge'
import { applySavedRevisions, buildGroupSavePayload, type SaveResult } from '../sync/groupSave'
import { summarizePendingBalance } from '../daigou/commercialDashboard'
import { useDaigouStore } from '../daigou/store'
import type {
  GroupBuyAppData,
  GroupBuyGroup,
  GroupBuyOrder,
} from '../api/types'
import { V50GroupExcelModal } from '../modules/groupbuy/V50GroupExcelModal'
import { syncV50GroupOrdersToDaigou, syncV50OrderToDaigou, reconcileShippingQueueFromDaigou } from '../modules/groupbuy/v50DaigouSync'
import { downloadV50OrderTemplateXlsx } from '../modules/groupbuy/v50ExcelBridge'
import {
  computeGroupBuyHubStats,
  listImminentClosingGroups,
  listImminentShippingGroups,
  HUB_SELECTABLE_STATUSES,
  HUB_STATUS_LABELS,
  type ImminentClosingRow,
  type ImminentShippingRow,
} from '../modules/groupbuy/groupBuyHubAnalytics'
import { isMailOrderChannel } from '../modules/groupbuy/groupLifecycle'
import {
  customerDisplayName,
  listPendingShippingQueueRows,
} from '../modules/groupbuy/shippingQueueUtils'
import {
  applyCustomerImportRows,
  exportAllV50OrdersXlsx,
  exportConfirmedPaymentReportsXlsx,
  exportCustomersXlsx,
  filterConfirmedPaymentReportsByRange,
  parseCustomerImportWorkbook,
} from '../modules/groupbuy/groupBuyHubExports'
import { normalizeGroupStatus, type V50GroupStatus } from '../modules/groupbuy/v50Utils'
import '../modules/groupbuy/v50OrderEntryModal.css'
import '../modules/groupbuy/v50GroupExcelModal.css'
import './groupBuyHubPage.css'
import '../modules/groupbuy/groupbuy.css'

function formatDaysLabel(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return '今日'
  if (days === 1) return '明日'
  return `${days} 日後`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function GroupBuyPreorderHubPage() {
  const api = useApi()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupBuyGroup[]>([])
  const baseGroupsRef = useRef<GroupBuyGroup[]>([])
  useRemoteSlice((slice) => {
    if (isSheetEditing()) return
    if (slice.groups) {
      const incoming = slice.groups as GroupBuyGroup[]
      setGroups((prev) => mergeGroupList(prev, incoming))
      baseGroupsRef.current = mergeGroupList(baseGroupsRef.current, incoming)
    }
    if (slice.bankJournal) setBankJournal(slice.bankJournal as GroupBuyAppData['bankJournal'])
    if (slice.paymentReports) setPaymentReports(slice.paymentReports as GroupBuyAppData['paymentReports'])
  })
  const [bankJournal, setBankJournal] = useState<GroupBuyAppData['bankJournal']>([])
  const [paymentReports, setPaymentReports] = useState<GroupBuyAppData['paymentReports']>([])
  const [portalConfig, setPortalConfig] = useState<GroupBuyAppData['portalConfig'] | null>(null)
  const [exchangeRate, setExchangeRate] = useState(0.22)
  const [statusMsg, setStatusMsg] = useState('')
  const [excelModal, setExcelModal] = useState<'export' | 'exportFull' | 'import' | null>(null)
  const [paymentExportOpen, setPaymentExportOpen] = useState(false)
  const [paymentFrom, setPaymentFrom] = useState('')
  const [paymentTo, setPaymentTo] = useState('')

  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())
  const [batchFilterStatus, setBatchFilterStatus] = useState<V50GroupStatus>('已登記')
  const [batchStatus, setBatchStatus] = useState<V50GroupStatus>('已登記')
  const [batchBusy, setBatchBusy] = useState(false)
  const [shipSelected, setShipSelected] = useState<Set<string>>(new Set())
  const [shipBusy, setShipBusy] = useState(false)
  const [stockAddId, setStockAddId] = useState('')

  const customerFileRef = useRef<HTMLInputElement>(null)
  const [customerImportMsg, setCustomerImportMsg] = useState('')

  const daigouOrders = useDaigouStore((s) => s.orders)
  const daigouGroups = useDaigouStore((s) => s.groups)
  const shipments = useDaigouStore((s) => s.shipments)
  const customers = useDaigouStore((s) => s.customers)
  const addToast = useDaigouStore((s) => s.addToast)
  const batchShipShipped = useDaigouStore((s) => s.batchShipShipped)

  /** 開團中心／團務僅通販；場販在開團專區管理 */
  const filteredGroups = useMemo(() => groups.filter(isMailOrderChannel), [groups])

  const activeGroups = useMemo(
    () => filteredGroups.filter((g) => normalizeGroupStatus(g.status) !== '已結束'),
    [filteredGroups],
  )

  const batchCurrentStatuses = useMemo(
    () => HUB_SELECTABLE_STATUSES.filter((s) => s !== '已結束'),
    [],
  )

  const batchStatusCounts = useMemo(() => {
    const counts: Partial<Record<V50GroupStatus, number>> = {}
    for (const s of batchCurrentStatuses) counts[s] = 0
    for (const g of activeGroups) {
      const st = normalizeGroupStatus(g.status)
      if (st === '已結束') continue
      counts[st] = (counts[st] ?? 0) + 1
    }
    return counts
  }, [activeGroups, batchCurrentStatuses])

  const visibleBatchGroups = useMemo(
    () => activeGroups.filter((g) => normalizeGroupStatus(g.status) === batchFilterStatus),
    [activeGroups, batchFilterStatus],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      setGroups(data.groups || [])
      baseGroupsRef.current = data.groups || []
      for (const g of data.groups || []) syncV50GroupOrdersToDaigou(g)
      reconcileShippingQueueFromDaigou()
      setBankJournal(data.bankJournal || [])
      setPaymentReports(data.paymentReports || [])
      setExchangeRate(data.exchangeRate ?? 0.22)
      setPortalConfig(data.portalConfig)
    } catch (e) {
      console.error(e)
      setStatusMsg('讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const visibleBatchSelectedCount = useMemo(
    () => visibleBatchGroups.reduce((n, g) => n + (batchSelected.has(g.id) ? 1 : 0), 0),
    [visibleBatchGroups, batchSelected],
  )
  const allVisibleBatchSelected =
    visibleBatchGroups.length > 0 && visibleBatchSelectedCount === visibleBatchGroups.length

  const persist = useCallback(
    async (
      nextGroups: GroupBuyGroup[],
      nextJournal = bankJournal,
      nextPaymentReports = paymentReports,
    ) => {
      setStatusMsg('儲存中…')
      try {
        const extra = {
          bankJournal: nextJournal,
          exchangeRate,
          portalConfig: portalConfig || {
            title: '訂單自助查詢',
            intro: '',
            websiteUrl: '',
            groupUrl: '',
            extraNote: '',
          },
          paymentReports: nextPaymentReports,
        }
        const { payload, mutationMode } = buildGroupSavePayload(baseGroupsRef.current, nextGroups, extra)
        const saved = await api.call<SaveResult>({ module: 'groupbuy', action: 'saveAppData', payload })
        const committed = mutationMode ? applySavedRevisions(nextGroups, saved) : nextGroups
        baseGroupsRef.current = committed
        setGroups(committed)
        setBankJournal(nextJournal)
        setPaymentReports(nextPaymentReports)
        setStatusMsg(mutationMode ? '已儲存（只寫入本次改動）' : '已儲存')
      } catch (e) {
        console.error(e)
        setStatusMsg(e instanceof Error ? e.message : '儲存失敗')
      }
      setTimeout(() => setStatusMsg(''), 2200)
    },
    [api, bankJournal, exchangeRate, paymentReports, portalConfig],
  )

  const stats = useMemo(() => {
    const base = computeGroupBuyHubStats(filteredGroups)
    // 待收尾款與營運總覽同一資料源／公式（客單管理 orders）
    return { ...base, ...summarizePendingBalance(daigouOrders) }
  }, [filteredGroups, daigouOrders])
  const imminentClosing = useMemo(
    () => listImminentClosingGroups(filteredGroups),
    [filteredGroups],
  )
  const imminentShipping = useMemo(
    () => listImminentShippingGroups(filteredGroups, shipments, daigouOrders, daigouGroups),
    [filteredGroups, shipments, daigouOrders, daigouGroups],
  )

  const stockWatchGroups = useMemo(
    () => filteredGroups.filter((g) => g.stockAlert),
    [filteredGroups],
  )
  const stockAddOptions = useMemo(
    () => activeGroups.filter((g) => !g.stockAlert),
    [activeGroups],
  )

  function saveStockWatch(groupId: string, on: boolean, note?: string) {
    const next = groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            stockAlert: on,
            stockAlertNote: note !== undefined ? note : g.stockAlertNote || '',
          }
        : g,
    )
    void persist(next)
  }

  /** 出貨物流佇列中目前待出貨的每一筆（可勾選批次出貨） */
  const pendingShipRows = useMemo(
    () => listPendingShippingQueueRows(shipments, daigouOrders, customers, daigouGroups),
    [shipments, daigouOrders, customers, daigouGroups],
  )

  useEffect(() => {
    setShipSelected(new Set(pendingShipRows.map((r) => r.sh.id)))
  }, [pendingShipRows])

  function toggleShip(id: string) {
    setShipSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleShipAll() {
    if (shipSelected.size === pendingShipRows.length) setShipSelected(new Set())
    else setShipSelected(new Set(pendingShipRows.map((r) => r.sh.id)))
  }

  function applyBatchShip() {
    const shipmentIds = pendingShipRows
      .filter((r) => shipSelected.has(r.sh.id))
      .map((r) => r.sh.id)
    if (!shipmentIds.length) {
      addToast('請至少勾選一筆出貨物流待出貨項目', 'err')
      return
    }
    if (
      !window.confirm(
        `確定批次出貨已勾選的 ${shipmentIds.length} 筆？客單會同步標為已結束。`,
      )
    ) {
      return
    }
    setShipBusy(true)
    try {
      const today = todayIso()
      const shipDateByShipmentId: Record<string, string> = {}
      for (const id of shipmentIds) shipDateByShipmentId[id] = today
      batchShipShipped(shipmentIds, shipDateByShipmentId)
      setShipSelected(new Set())
    } finally {
      setShipBusy(false)
    }
  }

  const paymentExportPreviewCount = useMemo(
    () =>
      filterConfirmedPaymentReportsByRange(paymentReports || [], {
        from: paymentFrom || undefined,
        to: paymentTo || undefined,
      }).length,
    [paymentReports, paymentFrom, paymentTo],
  )

  function openPaymentExportModal() {
    setPaymentFrom(monthStartIso())
    setPaymentTo(todayIso())
    setPaymentExportOpen(true)
  }

  function runPaymentReportExport(all = false) {
    const range = all
      ? undefined
      : {
          from: paymentFrom || undefined,
          to: paymentTo || undefined,
        }
    if (!all && paymentFrom && paymentTo && paymentFrom > paymentTo) {
      addToast('起始日不可晚於結束日', 'err')
      return
    }
    const { exported } = exportConfirmedPaymentReportsXlsx(paymentReports || [], undefined, range)
    if (!exported) {
      addToast(all ? '沒有已確認的付款回報可匯出' : '此區間沒有已確認的付款回報', 'info')
      return
    }
    addToast(`已匯出 ${exported} 筆已確認付款回報`, 'ok')
    setPaymentExportOpen(false)
  }

  async function applyBatchStatus() {
    const visibleIds = new Set(visibleBatchGroups.map((g) => g.id))
    const ids = [...batchSelected].filter((id) => visibleIds.has(id))
    if (!ids.length) {
      addToast('請先篩選狀態並勾選要修改的團務', 'err')
      return
    }
    setBatchBusy(true)
    try {
      const idSet = new Set(ids)
      const next = groups.map((g) => (idSet.has(g.id) ? { ...g, status: batchStatus } : g))
      await persist(next)
      setBatchSelected(new Set())
      addToast(`已更新 ${ids.length} 個團務狀態為「${batchStatus}」`, 'ok')
    } finally {
      setBatchBusy(false)
    }
  }

  function changeBatchFilter(status: V50GroupStatus) {
    setBatchFilterStatus(status)
    setBatchSelected(new Set())
  }

  function toggleBatch(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleBatchAll() {
    if (allVisibleBatchSelected) setBatchSelected(new Set())
    else setBatchSelected(new Set(visibleBatchGroups.map((g) => g.id)))
  }

  async function applyExcelImport(
    updates: { groupId: string; orders: GroupBuyOrder[] }[],
    summary: string,
  ) {
    const byId = new Map(updates.map((u) => [u.groupId, u.orders]))
    const next = groups.map((g) => (byId.has(g.id) ? { ...g, orders: byId.get(g.id)! } : g))
    for (const g of next) {
      const orders = byId.get(g.id)
      if (!orders) continue
      for (const o of orders) syncV50OrderToDaigou(g, o)
    }
    await persist(next)
    setStatusMsg(summary)
    setTimeout(() => setStatusMsg(''), 3200)
  }

  async function onCustomerImport(file: File | null) {
    if (!file) return
    try {
      const ab = await file.arrayBuffer()
      const rows = parseCustomerImportWorkbook(ab)
      const newId = () => `c_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
      const { customers: next, result } = applyCustomerImportRows(rows, customers, newId)
      useDaigouStore.setState({ customers: next })
      const msg = `客人列表：新增 ${result.added}、更新 ${result.updated}${result.skipped ? `、略過 ${result.skipped}` : ''}`
      setCustomerImportMsg(msg)
      addToast(msg, 'ok')
      if (result.warnings.length) setCustomerImportMsg(`${msg}（${result.warnings[0]}）`)
    } catch (e) {
      console.error(e)
      addToast('讀取客人列表失敗', 'err')
    } finally {
      if (customerFileRef.current) customerFileRef.current.value = ''
    }
  }

  if (loading) {
    return <div className="gb-loading">開團中心載入中…</div>
  }

  return (
    <PageLayout className="gb-hub-page px-4 py-6 sm:px-6">
      {statusMsg ? <div className="gb-toast">{statusMsg}</div> : null}

      <PageHeader
        title="開團中心"
        action={
          <div className="gb-hub-top-actions">
            <Btn variant="secondary" to="/groups">
              團務管理
              <ArrowRight className="h-4 w-4" />
            </Btn>
            <Btn variant="secondary" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              重新載入
            </Btn>
          </div>
        }
      />

      <section className="gb-hub-kpi-grid" aria-label="進行中團務摘要">
        <div className="gb-hub-kpi gb-hub-kpi--violet">
          <div className="gb-hub-kpi-head">
            <span className="gb-hub-kpi-icon"><Layers className="h-3.5 w-3.5" aria-hidden /></span>
            進行中團數
          </div>
          <div className="gb-hub-kpi-value">{stats.activeGroups}</div>
          <p className="gb-hub-kpi-foot">已結束 {stats.statusCounts.已結束} 團不計入下方數字</p>
        </div>
        <div className="gb-hub-kpi gb-hub-kpi--slate">
          <div className="gb-hub-kpi-head">
            <span className="gb-hub-kpi-icon"><ClipboardList className="h-3.5 w-3.5" aria-hidden /></span>
            客訂筆數
          </div>
          <div className="gb-hub-kpi-value">{stats.totalOrders}</div>
          <p className="gb-hub-kpi-foot">僅統計進行中團務</p>
        </div>
        <div className="gb-hub-kpi gb-hub-kpi--rose">
          <div className="gb-hub-kpi-head">
            <span className="gb-hub-kpi-icon"><AlertCircle className="h-3.5 w-3.5" aria-hidden /></span>
            未付款客訂
          </div>
          <div className="gb-hub-kpi-value">{stats.unpaidOrderCount}</div>
          <p className="gb-hub-kpi-foot">付款狀態為未付款</p>
        </div>
        <div className="gb-hub-kpi gb-hub-kpi--green">
          <div className="gb-hub-kpi-head">
            <span className="gb-hub-kpi-icon"><Wallet className="h-3.5 w-3.5" aria-hidden /></span>
            待收尾款
          </div>
          <div className="gb-hub-kpi-value gb-hub-kpi-value--money">
            ${stats.pendingBalanceTotal.toLocaleString()}
          </div>
          <p className="gb-hub-kpi-foot">
            {stats.pendingBalanceOrderCount} 筆 · {stats.pendingBalanceCustomerCount} 人 · 同營運總覽
          </p>
        </div>
      </section>

      <section className="gb-hub-section" aria-label="團務狀態分佈">
        <div className="gb-hub-section-label">
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          團務狀態
        </div>
        <div className="gb-hub-status-bar">
          {HUB_SELECTABLE_STATUSES.map((s) => (
            <div
              key={s}
              className={
                'gb-hub-status-item' + (s === '已結束' ? ' gb-hub-status-item--ended' : '')
              }
            >
              <span className="gb-hub-status-count">{stats.statusCounts[s]}</span>
              <span className="gb-hub-status-name">{HUB_STATUS_LABELS[s]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gb-hub-section" aria-label="缺貨待補">
        <div className="gb-hub-section-label">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          缺貨待補{stockWatchGroups.length ? ` · ${stockWatchGroups.length}` : ''}
        </div>
        <article className="gb-hub-card">
          <div className="gb-hub-card-body gb-hub-stock">
            <p className="gb-hub-note">購買時缺貨的團務可加入這裡，寫下缺哪一款。補到貨後取消勾選即可。</p>
            <div className="gb-hub-stock-add">
              <select value={stockAddId} onChange={(e) => setStockAddId(e.target.value)} aria-label="選擇要追蹤的團務">
                <option value="">選擇團務…</option>
                {stockAddOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="gb-hub-text-btn"
                disabled={!stockAddId}
                onClick={() => {
                  saveStockWatch(stockAddId, true, '')
                  setStockAddId('')
                }}
              >
                加入提醒
              </button>
            </div>
            {stockWatchGroups.length === 0 ? (
              <p className="gb-hub-empty">目前沒有缺貨待補的團務</p>
            ) : (
              <ul className="gb-hub-stock-list">
                {stockWatchGroups.map((g) => (
                  <li key={g.id} className="gb-hub-stock-row">
                    <label className="gb-hub-check-row">
                      <input type="checkbox" checked onChange={() => saveStockWatch(g.id, false)} />
                      <span className="gb-hub-list-name">{g.name}</span>
                    </label>
                    <a className="gb-hub-text-btn" href={`#/groups?group=${encodeURIComponent(g.id)}`}>開啟團務</a>
                    <input
                      className="gb-hub-stock-note"
                      defaultValue={g.stockAlertNote || ''}
                      placeholder="備註，例如缺哪一款、下次再看"
                      aria-label={`${g.name} 缺貨備註`}
                      onBlur={(e) => {
                        const note = e.target.value.trim()
                        if (note === (g.stockAlertNote || '').trim()) return
                        saveStockWatch(g.id, true, note)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>

      <section className="gb-hub-section" aria-label="待辦提醒">
        <div className="gb-hub-section-label">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          待辦提醒
        </div>
        <div className="gb-hub-attention">
          <article className="gb-hub-attention-card">
            <div className="gb-hub-attention-head">
              <h3 className="gb-hub-attention-title">
                <span className="gb-hub-attention-icon gb-hub-attention-icon--warn">
                  <CalendarClock className="h-4 w-4" aria-hidden />
                </span>
                即將結單
              </h3>
              <span className="gb-hub-attention-tag">7 日內</span>
            </div>
            <div className="gb-hub-attention-body">
              {imminentClosing.length === 0 ? (
                <p className="gb-hub-empty">近期無即將結單或結束販賣的團務</p>
              ) : (
                imminentClosing.map((row: ImminentClosingRow) => (
                  <div key={row.id} className="gb-hub-list-item">
                    <div className="gb-hub-list-item-head">
                      <span className="gb-hub-list-name">{row.name}</span>
                      <span className="gb-hub-pill gb-hub-pill--violet">{row.status}</span>
                    </div>
                    <div className="gb-hub-list-meta">
                      {row.closingDate ? (
                        <span>結單 {row.closingDate}（{formatDaysLabel(row.daysToClosing)}）</span>
                      ) : null}
                      {row.saleEndDate ? (
                        <span>結束販賣 {row.saleEndDate}（{formatDaysLabel(row.daysToSaleEnd)}）</span>
                      ) : null}
                      <span>{row.orderCount} 筆客訂</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="gb-hub-attention-card">
            <div className="gb-hub-attention-head">
              <h3 className="gb-hub-attention-title">
                <span className="gb-hub-attention-icon gb-hub-attention-icon--ship">
                  <Truck className="h-4 w-4" aria-hidden />
                </span>
                即將出貨
              </h3>
              <span className="gb-hub-attention-tag">已抵台</span>
            </div>
            <div className="gb-hub-attention-body">
              {imminentShipping.length === 0 ? (
                <p className="gb-hub-empty">目前無待出貨團務</p>
              ) : (
                imminentShipping.map((row: ImminentShippingRow) => (
                  <div key={row.id} className="gb-hub-list-item">
                    <div className="gb-hub-list-item-head">
                      <span className="gb-hub-list-name">{row.name}</span>
                      <span className="gb-hub-pill gb-hub-pill--sky">待出貨 {row.pendingShip}</span>
                    </div>
                    <div className="gb-hub-list-meta">
                      <span>{row.orderCount} 筆客訂</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="gb-hub-attention-card">
            <div className="gb-hub-attention-head">
              <h3 className="gb-hub-attention-title">
                <span className="gb-hub-attention-icon gb-hub-attention-icon--money">
                  <Wallet className="h-4 w-4" aria-hidden />
                </span>
                待收尾款
              </h3>
              <span className="gb-hub-attention-tag">進行中團</span>
            </div>
            <div className="gb-hub-attention-body gb-hub-attention-body--center">
              <span className="gb-hub-attention-big">
                ${stats.pendingBalanceTotal.toLocaleString()}
              </span>
              <p className="gb-hub-attention-sub">
                {stats.pendingBalanceOrderCount} 筆客訂 · {stats.pendingBalanceCustomerCount} 位客人
              </p>
              <p className="gb-hub-note">訂金已付／尾款待收（與營運總覽相同）</p>
            </div>
          </article>
        </div>
      </section>

      <section className="gb-hub-section gb-hub-work-grid" aria-label="操作區">
        <article className="gb-hub-card">
          <div className="gb-hub-card-head">
            <h2 className="gb-hub-card-title">批次修改狀態</h2>
            <p className="gb-hub-card-desc">先選目前狀態，再勾選要改的團務</p>
          </div>
          <div className="gb-hub-card-body">
            {activeGroups.length === 0 ? (
              <p className="gb-hub-empty">沒有可調整的進行中團務</p>
            ) : (
              <>
                <div className="gb-hub-batch-filters" role="tablist" aria-label="目前狀態">
                  {batchCurrentStatuses.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={batchFilterStatus === s}
                      className={
                        'gb-hub-batch-filter' +
                        (batchFilterStatus === s ? ' is-active' : '') +
                        (!(batchStatusCounts[s] ?? 0) ? ' is-empty' : '')
                      }
                      onClick={() => changeBatchFilter(s)}
                    >
                      <span className="gb-hub-batch-filter-name">{HUB_STATUS_LABELS[s]}</span>
                      <span className="gb-hub-batch-filter-count">{batchStatusCounts[s] ?? 0}</span>
                    </button>
                  ))}
                </div>
                <div className="gb-hub-batch-controls">
                  <button
                    type="button"
                    className="gb-hub-text-btn"
                    onClick={toggleBatchAll}
                    disabled={!visibleBatchGroups.length}
                  >
                    {allVisibleBatchSelected ? '取消全選' : '全選此狀態'}
                  </button>
                  <label className="gb-hub-batch-select">
                    <span>改為</span>
                    <select
                      className="heina-input"
                      value={batchStatus}
                      onChange={(e) => setBatchStatus(e.target.value as V50GroupStatus)}
                    >
                      {HUB_SELECTABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <Btn
                    className="!py-1.5 !text-xs"
                    disabled={batchBusy || !visibleBatchSelectedCount}
                    onClick={() => void applyBatchStatus()}
                  >
                    {batchBusy ? '更新中…' : `套用 ${visibleBatchSelectedCount} 團`}
                  </Btn>
                </div>
                {visibleBatchGroups.length === 0 ? (
                  <p className="gb-hub-empty">此狀態目前沒有團務</p>
                ) : (
                  <ul className="gb-hub-check-list">
                    {visibleBatchGroups.map((g) => (
                      <li key={g.id}>
                        <label className="gb-hub-check-row">
                          <input
                            type="checkbox"
                            checked={batchSelected.has(g.id)}
                            onChange={() => toggleBatch(g.id)}
                          />
                          <span className="gb-hub-list-name">{g.name}</span>
                          <span className="gb-hub-pill gb-hub-pill--violet">
                            {normalizeGroupStatus(g.status)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </article>

        <article className="gb-hub-card gb-hub-card--ship">
          <div className="gb-hub-card-head">
            <h2 className="gb-hub-card-title">批次出貨</h2>
            <p className="gb-hub-card-desc">
              與出貨物流相同佇列：勾選待出貨項目後一次標記已出貨
            </p>
          </div>
          <div className="gb-hub-card-body">
            {pendingShipRows.length === 0 ? (
              <p className="gb-hub-empty">
                出貨物流目前沒有待出貨項目
                <Btn variant="ghost" className="!text-xs mt-2" to="/shipping">
                  前往出貨物流
                  <ArrowRight className="h-3.5 w-3.5" />
                </Btn>
              </p>
            ) : (
              <>
                <div className="gb-hub-batch-controls">
                  <button type="button" className="gb-hub-text-btn" onClick={toggleShipAll}>
                    {shipSelected.size === pendingShipRows.length ? '取消全選' : '全選'}
                  </button>
                  <Btn
                    className="!py-1.5 !text-xs"
                    disabled={shipBusy || !shipSelected.size}
                    onClick={applyBatchShip}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    {shipBusy ? '出貨中…' : `批次出貨 ${shipSelected.size} 筆`}
                  </Btn>
                  <Btn variant="secondary" className="!py-1.5 !text-xs" to="/shipping">
                    出貨物流
                  </Btn>
                </div>
                <ul className="gb-hub-check-list gb-hub-check-list--ship">
                  {pendingShipRows.map((row) => {
                    const name = customerDisplayName(row)
                    return (
                      <li key={row.sh.id}>
                        <label className="gb-hub-check-row">
                          <input
                            type="checkbox"
                            checked={shipSelected.has(row.sh.id)}
                            onChange={() => toggleShip(row.sh.id)}
                          />
                          <span className="gb-hub-ship-main">
                            <span className="gb-hub-list-name">{name}</span>
                            <span className="gb-hub-ship-sub">
                              {row.g?.name || '未分團'}
                              {row.o.lookupCode ? ` · ${row.o.lookupCode}` : ''}
                            </span>
                          </span>
                          <span className="gb-hub-pill gb-hub-pill--sky">待出貨</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </article>

        <article className="gb-hub-card">
          <div className="gb-hub-card-head">
            <h2 className="gb-hub-card-title">Excel 工具</h2>
            <p className="gb-hub-card-desc">團務客訂與團務管理共用同一後端資料</p>
          </div>
          <div className="gb-hub-card-body">
            <div className="gb-hub-excel-groups">
              <div>
                <div className="gb-hub-excel-group-title">團務客訂</div>
                <div className="gb-hub-action-list">
                  <button type="button" className="gb-hub-action" onClick={() => setExcelModal('exportFull')}>
                    <span className="gb-hub-action-icon"><Archive className="h-4 w-4" aria-hidden /></span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">完整團務備份</span>
                      <span className="gb-hub-action-desc">主檔＋客訂明細，可含已結束團</span>
                    </span>
                  </button>
                  <button type="button" className="gb-hub-action" onClick={() => setExcelModal('export')}>
                    <span className="gb-hub-action-icon"><FileDown className="h-4 w-4" aria-hidden /></span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">匯出團務客訂</span>
                      <span className="gb-hub-action-desc">勾選團務，每團一工作表</span>
                    </span>
                  </button>
                  <button type="button" className="gb-hub-action" onClick={() => setExcelModal('import')}>
                    <span className="gb-hub-action-icon"><FileUp className="h-4 w-4" aria-hidden /></span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">匯入團務客訂</span>
                      <span className="gb-hub-action-desc">多團同檔，確認後才寫入</span>
                    </span>
                  </button>
                  <button type="button" className="gb-hub-action" onClick={() => downloadV50OrderTemplateXlsx()}>
                    <span className="gb-hub-action-icon gb-hub-action-icon--muted">
                      <Download className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">下載客訂範本</span>
                      <span className="gb-hub-action-desc">與匯出欄位一致</span>
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <div className="gb-hub-excel-group-title">其他匯出</div>
                <div className="gb-hub-action-list">
                  <button type="button" className="gb-hub-action" onClick={() => exportAllV50OrdersXlsx(groups)}>
                    <span className="gb-hub-action-icon gb-hub-action-icon--muted">
                      <ClipboardList className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">客單管理匯出</span>
                      <span className="gb-hub-action-desc">全部團務客訂一表</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="gb-hub-action"
                    onClick={openPaymentExportModal}
                  >
                    <span className="gb-hub-action-icon gb-hub-action-icon--muted">
                      <Receipt className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">付款回報（已確認）</span>
                      <span className="gb-hub-action-desc">可選日期區間再匯出</span>
                    </span>
                  </button>
                  <button type="button" className="gb-hub-action" onClick={() => exportCustomersXlsx(customers)}>
                    <span className="gb-hub-action-icon gb-hub-action-icon--muted">
                      <Users className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="gb-hub-action-text">
                      <span className="gb-hub-action-name">客人列表匯出</span>
                      <span className="gb-hub-action-desc">姓名、LINE、備註等</span>
                    </span>
                  </button>
                </div>
                <div className="gb-hub-import-row">
                  <input
                    ref={customerFileRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => void onCustomerImport(e.target.files?.[0] ?? null)}
                  />
                  <Btn variant="secondary" className="!text-xs w-full sm:w-auto" onClick={() => customerFileRef.current?.click()}>
                    <FileUp className="h-3.5 w-3.5" />
                    客人列表匯入
                  </Btn>
                  {customerImportMsg ? <p className="gb-hub-import-msg">{customerImportMsg}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      {excelModal === 'export' ? (
        <V50GroupExcelModal mode="export" groups={groups} onClose={() => setExcelModal(null)} />
      ) : null}
      {excelModal === 'exportFull' ? (
        <V50GroupExcelModal mode="exportFull" groups={groups} onClose={() => setExcelModal(null)} />
      ) : null}
      {excelModal === 'import' ? (
        <V50GroupExcelModal
          mode="import"
          groups={groups}
          onClose={() => setExcelModal(null)}
          onImport={(updates, summary) => void applyExcelImport(updates, summary)}
        />
      ) : null}

      <Modal open={paymentExportOpen} title="匯出付款回報（已確認）" onClose={() => setPaymentExportOpen(false)}>
        <p className="mb-3 text-sm text-ds-text-secondary">
          依確認日篩選（無確認日則用匯款日）。留空起迄＝不限制該端。
        </p>
        <div className="gb-hub-pay-export-range">
          <label>
            <span>起始日</span>
            <input type="date" value={paymentFrom} onChange={(e) => setPaymentFrom(e.target.value)} />
          </label>
          <label>
            <span>結束日</span>
            <input type="date" value={paymentTo} onChange={(e) => setPaymentTo(e.target.value)} />
          </label>
        </div>
        <div className="gb-hub-pay-export-presets">
          <button
            type="button"
            className="gb-hub-pay-export-chip"
            onClick={() => {
              setPaymentFrom(todayIso())
              setPaymentTo(todayIso())
            }}
          >
            今日
          </button>
          <button
            type="button"
            className="gb-hub-pay-export-chip"
            onClick={() => {
              setPaymentFrom(daysAgoIso(6))
              setPaymentTo(todayIso())
            }}
          >
            近 7 日
          </button>
          <button
            type="button"
            className="gb-hub-pay-export-chip"
            onClick={() => {
              setPaymentFrom(monthStartIso())
              setPaymentTo(todayIso())
            }}
          >
            本月
          </button>
          <button
            type="button"
            className="gb-hub-pay-export-chip"
            onClick={() => {
              setPaymentFrom('')
              setPaymentTo('')
            }}
          >
            不限區間
          </button>
        </div>
        <p className="mb-4 text-sm font-semibold text-ds-text">
          符合筆數：{paymentExportPreviewCount}
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => runPaymentReportExport(false)} disabled={paymentExportPreviewCount === 0}>
            <Download className="h-4 w-4" />
            匯出此區間
          </Btn>
          <Btn variant="secondary" onClick={() => runPaymentReportExport(true)}>
            匯出全部已確認
          </Btn>
          <Btn variant="ghost" onClick={() => setPaymentExportOpen(false)}>
            取消
          </Btn>
        </div>
      </Modal>
    </PageLayout>
  )
}
