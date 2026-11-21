import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Btn, Card, PageHeader } from '../components/ui'
import { useApi } from '../context/useApi'
import { isSheetEditing, mergeGroupList } from '../sync/sheetSync'
import { useRemoteSlice } from '../sync/SheetSyncBridge'
import type {
  ConfirmPaymentReportPayload,
  CustomerPaymentReport,
  CustomerPaymentReportLine,
  DeletePaymentReportPayload,
  GroupBuyAppData,
  RevertPaymentReportPayload,
  SupplementPaymentReportPayload,
  UpdatePaymentReportLineFlagsPayload,
} from '../api/types'
import {
  findGroupBuyOrder,
  lineExpectedDeposit,
  sumPaymentReportDeposits,
} from '../modules/groupbuy/paymentReportLogic'
import { syncV50OrderToDaigou } from '../modules/groupbuy/v50DaigouSync'
import { REMITTANCE_BANK_OPTIONS } from '../modules/groupbuy/v50Utils'
import {
  collectPaymentReportGroups,
  paymentReportMatchesQuery,
  sortPaymentReports,
  type PaymentReportSortMode,
  type PaymentReportSourceFilter,
} from '../modules/groupbuy/paymentReportListUtils'
import { useDaigouStore } from '../daigou/store'
import { BalanceMemoCollapsible } from '../components/customers/CustomerBalanceMemoPanel'
import { formatMemoAmount } from '../daigou/customerBalanceMemo'
import '../modules/groupbuy/groupbuy.css'
import '../modules/groupbuy/v50GroupCard.css'
import './paymentReportPage.css'

type ActionResult = { ok: boolean; message?: string }
type ReportTab = 'pending' | 'confirmed'

function sumReportMemoAmounts(memos: { amountTwd: number }[] | undefined): number {
  return (memos || []).reduce((sum, m) => sum + (Number(m.amountTwd) || 0), 0)
}

function reportBalanceMemoIds(report: CustomerPaymentReport): string[] {
  return (report.balanceMemos || []).map((m) => m.id).filter(Boolean)
}

function settleReportBalanceMemos(report: CustomerPaymentReport) {
  const ids = reportBalanceMemoIds(report)
  if (!ids.length) return
  useDaigouStore.getState().settleBalanceMemosByIds(ids, '付款回報抵銷')
}

function reopenReportBalanceMemos(report: CustomerPaymentReport) {
  const ids = reportBalanceMemoIds(report)
  if (!ids.length) return
  useDaigouStore.getState().reopenBalanceMemosByIds(ids)
}

type SupplementTarget = {
  reportId: string
  orderId: string
  line: CustomerPaymentReportLine
}

function initDepositMap(
  reports: GroupBuyAppData['paymentReports'],
  groups?: GroupBuyAppData['groups'],
): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {}
  for (const report of reports || []) {
    if (report.status !== 'pending') continue
    map[report.id] = {}
    for (const line of report.lines) {
      const live = findGroupBuyOrder(groups, line.orderId)
      const expected = lineExpectedDeposit(line, live)
      const stored = Number(line.deposit) || 0
      map[report.id][line.orderId] = stored > 0 ? stored : expected
    }
  }
  return map
}

function initSelectedMap(reports: GroupBuyAppData['paymentReports']): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const report of reports || []) {
    if (report.status !== 'pending') continue
    map[report.id] = [...report.orderIds]
  }
  return map
}

function customerReportedTotal(report: CustomerPaymentReport): number {
  return report.reportedTotalAmount ?? report.totalAmount
}

function syncReportOrders(report: CustomerPaymentReport, groups: GroupBuyAppData['groups'], orderIds?: string[]) {
  const ids = orderIds ?? report.orderIds
  for (const g of groups || []) {
    for (const o of g.orders || []) {
      if (ids.includes(o.id)) syncV50OrderToDaigou(g, o)
    }
  }
}

export function PaymentReportPage() {
  const api = useApi()
  const operationIds = useRef<Record<string, string>>({})
  function operationIdFor(key: string) {
    if (!operationIds.current[key]) {
      operationIds.current[key] = `op_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    }
    return operationIds.current[key]
  }
  function clearOperation(key: string) {
    delete operationIds.current[key]
  }
  const [loading, setLoading] = useState(true)
  const [paymentReports, setPaymentReports] = useState<GroupBuyAppData['paymentReports']>([])
  const [groups, setGroups] = useState<GroupBuyAppData['groups']>([])
  const [statusMsg, setStatusMsg] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [supplementingId, setSupplementingId] = useState<string | null>(null)
  useRemoteSlice((slice) => {
    if (isSheetEditing() || confirmingId || supplementingId) return
    if (slice.groups) setGroups((prev) => mergeGroupList(prev || [], slice.groups as GroupBuyAppData['groups']))
    if (slice.paymentReports) setPaymentReports(slice.paymentReports as GroupBuyAppData['paymentReports'])
  })
  const [bankByReport, setBankByReport] = useState<Record<string, string>>({})
  const [depositByReport, setDepositByReport] = useState<Record<string, Record<string, number>>>({})
  const [selectedByReport, setSelectedByReport] = useState<Record<string, string[]>>({})
  const [activeTab, setActiveTab] = useState<ReportTab>('pending')
  const [supplementTarget, setSupplementTarget] = useState<SupplementTarget | null>(null)
  const [supplementAmount, setSupplementAmount] = useState('')
  const [supplementDate, setSupplementDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [supplementBank, setSupplementBank] = useState<string>(REMITTANCE_BANK_OPTIONS[1])
  const [supplementNote, setSupplementNote] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<PaymentReportSortMode>('time_desc')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<PaymentReportSourceFilter>('')
  const [needsSupplementOnly, setNeedsSupplementOnly] = useState(false)
  const [groupFilter, setGroupFilter] = useState('')

  const groupOptions = useMemo(
    () => collectPaymentReportGroups(paymentReports || []),
    [paymentReports],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      const reports = data.paymentReports || []
      const nextGroups = data.groups || []
      setGroups(nextGroups)
      setPaymentReports(reports)
      setDepositByReport(initDepositMap(reports, nextGroups))
      setSelectedByReport(initSelectedMap(reports))
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

  const pendingReports = useMemo(
    () => (paymentReports || []).filter((r) => r.status === 'pending'),
    [paymentReports],
  )

  const confirmedReports = useMemo(
    () => (paymentReports || []).filter((r) => r.status === 'confirmed'),
    [paymentReports],
  )

  const tabReports = activeTab === 'pending' ? pendingReports : confirmedReports

  const visibleReports = useMemo(() => {
    let list = tabReports
    if (searchQuery) {
      list = list.filter((r) => paymentReportMatchesQuery(r, searchQuery))
    }
    if (sourceFilter) {
      list = list.filter((r) => (r.source ?? 'customer') === sourceFilter)
    }
    if (needsSupplementOnly) {
      list = list.filter((r) => r.lines.some((line) => line.needsSupplement))
    }
    if (groupFilter) {
      list = list.filter((r) => r.lines.some((line) => line.groupId === groupFilter))
    }
    return sortPaymentReports(list, sortMode, activeTab)
  }, [
    tabReports,
    searchQuery,
    sourceFilter,
    needsSupplementOnly,
    groupFilter,
    sortMode,
    activeTab,
  ])

  const hasActiveFilters =
    Boolean(searchQuery) || Boolean(sourceFilter) || needsSupplementOnly || Boolean(groupFilter)

  function lineDepositsFor(reportId: string) {
    return depositByReport[reportId] || {}
  }

  function selectedSetFor(report: CustomerPaymentReport) {
    return new Set(selectedByReport[report.id] || report.orderIds)
  }

  function setLineDeposit(reportId: string, orderId: string, value: string) {
    const n = Math.max(0, Math.round(Number(value) || 0))
    setDepositByReport((prev) => ({
      ...prev,
      [reportId]: { ...prev[reportId], [orderId]: n },
    }))
  }

  function toggleLineSelected(reportId: string, orderId: string, checked: boolean) {
    setSelectedByReport((prev) => {
      const current = new Set(prev[reportId] || [])
      if (checked) current.add(orderId)
      else current.delete(orderId)
      return { ...prev, [reportId]: [...current] }
    })
  }

  function toggleAllSelected(report: CustomerPaymentReport, checked: boolean) {
    setSelectedByReport((prev) => ({
      ...prev,
      [report.id]: checked ? [...report.orderIds] : [],
    }))
  }

  function flashStatus(message: string, ms = 2400) {
    setStatusMsg(message)
    setTimeout(() => setStatusMsg(''), ms)
  }

  function runSearch() {
    setSearchQuery(searchDraft.trim())
  }

  function resetFilters() {
    setSearchDraft('')
    setSearchQuery('')
    setSourceFilter('')
    setNeedsSupplementOnly(false)
    setGroupFilter('')
    setSortMode('time_desc')
  }

  async function refreshAfterMutation(data: GroupBuyAppData) {
    const reports = data.paymentReports || []
    const nextGroups = data.groups || []
    setGroups(nextGroups)
    setPaymentReports(reports)
    setDepositByReport(initDepositMap(reports, nextGroups))
    setSelectedByReport(initSelectedMap(reports))
    return data
  }

  async function deleteReport(report: CustomerPaymentReport) {
    const isConfirmed = report.status === 'confirmed'
    const msg = isConfirmed
      ? '確定刪除此筆已確認的回報？訂單會回到未付款，訂金回到審核前記錄的應付金額，付款備註會清空。銀行日記帳的收入會保留，不會自動刪除，也不會自動新增負數沖銷。'
      : '確定刪除此筆付款回報？刪除後客人可重新送出。'
    if (!window.confirm(msg)) return

    setDeletingId(report.id)
    flashStatus('刪除中…', 6000)
    try {
      const res = await api.call<ActionResult>({
        module: 'groupbuy',
        action: 'deletePaymentReport',
        payload: { reportId: report.id } satisfies DeletePaymentReportPayload,
      })
      if (!res.ok) {
        flashStatus(res.message || '刪除失敗')
        return
      }
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      await refreshAfterMutation(data)
      if (isConfirmed) {
        syncReportOrders(report, data.groups)
        reopenReportBalanceMemos(report)
      }
      flashStatus(res.message || '已刪除付款回報')
    } catch (e) {
      console.error(e)
      flashStatus(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setDeletingId(null)
    }
  }

  async function revertReport(report: CustomerPaymentReport) {
    if (
      !window.confirm(
        '確定將此筆回報返回待確認？訂單會回到未付款，訂金回到審核前記錄的應付金額，付款備註會清空，付款回報回到待確認。銀行日記帳的收入會保留，不會自動刪除，也不會自動新增負數沖銷，請另行人工核對。',
      )
    ) {
      return
    }

    setRevertingId(report.id)
    flashStatus('處理中…', 6000)
    try {
      const res = await api.call<ActionResult>({
        module: 'groupbuy',
        action: 'revertPaymentReport',
        payload: { reportId: report.id, operationId: operationIdFor(`revert:${report.id}`) } satisfies RevertPaymentReportPayload,
      })
      if (!res.ok) {
        flashStatus(res.message || '返回失敗')
        return
      }
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      await refreshAfterMutation(data)
      syncReportOrders(report, data.groups)
      reopenReportBalanceMemos(report)
      clearOperation(`revert:${report.id}`)
      setActiveTab('pending')
      flashStatus(res.message || '已返回待確認')
    } catch (e) {
      console.error(e)
      flashStatus(e instanceof Error ? e.message : '返回失敗')
    } finally {
      setRevertingId(null)
    }
  }

  async function toggleNeedsSupplement(
    report: CustomerPaymentReport,
    line: CustomerPaymentReportLine,
    needsSupplement: boolean,
  ) {
    try {
      const res = await api.call<ActionResult>({
        module: 'groupbuy',
        action: 'updatePaymentReportLineFlags',
        payload: {
          reportId: report.id,
          orderId: line.orderId,
          needsSupplement,
        } satisfies UpdatePaymentReportLineFlagsPayload,
      })
      if (!res.ok) {
        flashStatus(res.message || '更新失敗')
        return
      }
      setPaymentReports((prev) =>
        (prev || []).map((r) => {
          if (r.id !== report.id) return r
          return {
            ...r,
            lines: r.lines.map((l) =>
              l.orderId === line.orderId ? { ...l, needsSupplement } : l,
            ),
          }
        }),
      )
    } catch (e) {
      console.error(e)
      flashStatus('更新失敗')
    }
  }

  function openSupplement(report: CustomerPaymentReport, line: CustomerPaymentReportLine) {
    const expected = lineExpectedDeposit(line)
    const gap = Math.max(0, expected - line.deposit)
    setSupplementTarget({ reportId: report.id, orderId: line.orderId, line })
    setSupplementAmount(String(gap > 0 ? gap : ''))
    setSupplementDate(new Date().toISOString().slice(0, 10))
    setSupplementBank(report.confirmedBank || REMITTANCE_BANK_OPTIONS[1])
    setSupplementNote('')
  }

  async function submitSupplement() {
    if (!supplementTarget) return
    const amount = Math.round(Number(supplementAmount) || 0)
    if (amount <= 0) {
      flashStatus('請填寫補款金額', 2200)
      return
    }
    setSupplementingId(supplementTarget.orderId)
    flashStatus('補款處理中…', 6000)
    try {
      const res = await api.call<ActionResult>({
        module: 'groupbuy',
        action: 'supplementPaymentReport',
        payload: {
          reportId: supplementTarget.reportId,
          orderId: supplementTarget.orderId,
          amount,
          remittanceDate: supplementDate,
          remittanceBank: supplementBank,
          note: supplementNote.trim() || undefined,
          operationId: operationIdFor(`supplement:${supplementTarget.reportId}:${supplementTarget.orderId}:${amount}`),
        } satisfies SupplementPaymentReportPayload,
      })
      if (!res.ok) {
        flashStatus(res.message || '補款失敗')
        return
      }
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      await refreshAfterMutation(data)
      syncReportOrders(
        { orderIds: [supplementTarget.orderId] } as CustomerPaymentReport,
        data.groups,
        [supplementTarget.orderId],
      )
      clearOperation(`supplement:${supplementTarget.reportId}:${supplementTarget.orderId}:${amount}`)
      setSupplementTarget(null)
      flashStatus(res.message || '補款已入帳')
    } catch (e) {
      console.error(e)
      flashStatus(e instanceof Error ? e.message : '補款失敗')
    } finally {
      setSupplementingId(null)
    }
  }

  async function confirmReport(reportId: string) {
    const pending = pendingReports.find((r) => r.id === reportId)
    if (!pending) return
    const selectedIds = selectedByReport[reportId] || []
    if (selectedIds.length === 0) {
      flashStatus('請至少勾選一筆團務', 2200)
      return
    }
    const lineDeposits = lineDepositsFor(reportId)
    const selected = new Set(selectedIds)
    const totalIn = sumPaymentReportDeposits(pending.lines, lineDeposits, selected)
    if (totalIn <= 0) {
      flashStatus('勾選團務的訂金合計需大於 0', 2200)
      return
    }
    setConfirmingId(reportId)
    flashStatus('確認中…', 6000)
    try {
      const bank = bankByReport[reportId] || REMITTANCE_BANK_OPTIONS[1]
      const res = await api.call<ActionResult>({
        module: 'groupbuy',
        action: 'confirmPaymentReport',
        payload: {
          reportId,
          remittanceBank: bank,
          lineDeposits,
          selectedOrderIds: selectedIds,
          operationId: operationIdFor(`confirm:${reportId}`),
        } satisfies ConfirmPaymentReportPayload,
      })
      if (!res.ok) {
        flashStatus(res.message || '確認失敗')
        return
      }
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      await refreshAfterMutation(data)
      setActiveTab('confirmed')
      syncReportOrders(pending, data.groups, selectedIds)
      settleReportBalanceMemos(pending)
      clearOperation(`confirm:${reportId}`)
      flashStatus(res.message || '已確認付款')
    } catch (e) {
      console.error(e)
      flashStatus(e instanceof Error ? e.message : '確認失敗')
    } finally {
      setConfirmingId(null)
    }
  }

  if (loading) {
    return <div className="gb-loading">付款回報資料載入中…</div>
  }

  return (
    <div className="nickname-search-page payment-report-page space-y-6">
      <div className="pr-page">
      {statusMsg ? <div className="gb-toast">{statusMsg}</div> : null}

      <PageHeader
        title="付款回報"
        action={
          <div className="pr-header-actions">
            <Btn variant="secondary" className="pr-reload-btn" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              重新載入
            </Btn>
            <Btn variant="secondary" className="pr-review-shortcut" to="/payment-review">
              付款審核
            </Btn>
          </div>
        }
      />

      <Card className="nickname-search-panel pr-search-panel space-y-4 !p-4 md:!p-5">
        <div>
          <label className="pr-search-label" htmlFor="pr-search-input">搜尋付款回報</label>
          <input
            id="pr-search-input"
            className="pr-search-input mt-2 w-full"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder="客人名字、後五碼、匯款日、團務名、訂單編號"
            aria-label="搜尋付款回報"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn type="button" onClick={runSearch}>
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
          <div className="grid gap-3 border-t border-[var(--oc-line)] pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-meta font-semibold text-ds-text-secondary">
              來源
              <select
                className="mt-2 w-full"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as PaymentReportSourceFilter)}
                aria-label="篩選來源"
              >
                <option value="">全部來源</option>
                <option value="customer">客人回報</option>
                <option value="admin_review">付款審核</option>
              </select>
            </label>
            <label className="block text-meta font-semibold text-ds-text-secondary">
              團務
              <select
                className="mt-2 w-full"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                aria-label="篩選團務"
              >
                <option value="">全部團務</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1 text-meta font-semibold text-ds-text-secondary">
              <input
                type="checkbox"
                checked={needsSupplementOnly}
                onChange={(e) => setNeedsSupplementOnly(e.target.checked)}
              />
              僅顯示需補款
            </label>
          </div>
        ) : null}
        <p className="pr-search-note">
          支援部分比對；可搜尋客人名字、後五碼、匯款日、團務名稱或訂單編號。
        </p>
      </Card>

      <div className="pr-tabs" role="tablist" aria-label="付款回報分類">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pending'}
          className={'pr-tab pr-tab--pending' + (activeTab === 'pending' ? ' is-active' : '')}
          onClick={() => setActiveTab('pending')}
        >
          待確認
          <span className="pr-tab-count">（{pendingReports.length}）</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'confirmed'}
          className={'pr-tab pr-tab--confirmed' + (activeTab === 'confirmed' ? ' is-active' : '')}
          onClick={() => setActiveTab('confirmed')}
        >
          已確認
          <span className="pr-tab-count">（{confirmedReports.length}）</span>
        </button>
      </div>

      <div className="pr-toolbar">
        <select
          className="pr-sort"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as PaymentReportSortMode)}
          aria-label="排序方式"
        >
          <option value="time_desc">依時間（新→舊）</option>
          <option value="time_asc">依時間（舊→新）</option>
          <option value="amount_desc">依入帳金額（高→低）</option>
          <option value="amount_asc">依入帳金額（低→高）</option>
          <option value="remittance_desc">依匯款日（新→舊）</option>
          <option value="remittance_asc">依匯款日（舊→新）</option>
          <option value="name_asc">依客人名字（A→Z）</option>
          <option value="name_desc">依客人名字（Z→A）</option>
        </select>
        <span className="pr-result-count">
          本頁 {visibleReports.length} 筆
          {hasActiveFilters ? `（${tabReports.length} 筆中）` : ''}
        </span>
      </div>

      {visibleReports.length === 0 ? (
        <div className={'pr-empty' + (activeTab === 'pending' ? ' pr-empty--pending' : ' pr-empty--confirmed')}>
          {hasActiveFilters
            ? '查無符合條件的付款回報，請調整搜尋或篩選。'
            : activeTab === 'pending'
              ? '目前沒有待確認的付款回報。'
              : '尚無已確認的付款回報。'}
        </div>
      ) : (
        <div className="pr-list">
          {visibleReports.map((report) => {
            const isPending = report.status === 'pending'
            const isBusy =
              deletingId === report.id ||
              confirmingId === report.id ||
              revertingId === report.id
            const bank = bankByReport[report.id] ?? report.confirmedBank ?? REMITTANCE_BANK_OPTIONS[1]
            const lineDeposits = isPending ? lineDepositsFor(report.id) : undefined
            const selected = isPending ? selectedSetFor(report) : undefined
            const liveTotal = isPending
              ? sumPaymentReportDeposits(report.lines, lineDeposits, selected)
              : report.totalAmount
            const submitted = new Date(report.submittedAt).toLocaleString('zh-TW', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
            const confirmedLabel = report.confirmedAt
              ? new Date(report.confirmedAt).toLocaleString('zh-TW', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : null
            const allSelected =
              isPending &&
              report.orderIds.length > 0 &&
              (selectedByReport[report.id]?.length ?? 0) === report.orderIds.length

            return (
              <article
                key={report.id}
                className={'pr-card' + (isPending ? ' pr-card--pending' : ' pr-card--confirmed')}
              >
                {isPending ? (
                  <>
                    <header className="pr-card-head">
                      <div className="min-w-0">
                        <div className="pr-card-title-row">
                          <span className="pr-badge pr-badge--pending">待確認</span>
                          <h2 className="pr-card-name">{report.customerName}</h2>
                        </div>
                        <div className="pr-meta">
                          <span className="pr-chip pr-chip--time">送出 {submitted}</span>
                          <span className="pr-chip pr-chip--date">匯款日 {report.remittanceDate}</span>
                          <span className="pr-chip pr-chip--code">後五碼 {report.lastFive}</span>
                        </div>
                      </div>

                      <div className="pr-head-side">
                        <div className="pr-amount-grid">
                          <div className="pr-amount-box pr-amount-box--reported">
                            <p className="pr-amount-label">客人回報總額</p>
                            <p className="pr-amount-value">
                              NT$ {customerReportedTotal(report).toLocaleString('zh-TW')}
                            </p>
                          </div>
                          <div className="pr-amount-box pr-amount-box--primary">
                            <p className="pr-amount-label">本次合計入帳</p>
                            <p className="pr-amount-value">NT$ {liveTotal.toLocaleString('zh-TW')}</p>
                          </div>
                        </div>
                        <div className="pr-head-actions">
                          <button
                            type="button"
                            className="pr-btn pr-btn--danger"
                            disabled={isBusy}
                            onClick={() => void deleteReport(report)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            刪除
                          </button>
                        </div>
                      </div>
                    </header>

                    <div className="pr-orders">
                      <div className="pr-select-all">
                        <label className="pr-check-label">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(e) => toggleAllSelected(report, e.target.checked)}
                          />
                          全選團務（僅勾選的會沖銷入帳）
                        </label>
                      </div>
                      <div className="pr-orders-head pr-orders-head--pending">
                        <span>勾選</span>
                        <span>團務</span>
                        <span>應收訂金</span>
                        <span>實收訂金</span>
                      </div>
                      {report.lines.map((line) => {
                        const live = findGroupBuyOrder(groups, line.orderId)
                        const expected = lineExpectedDeposit(line, live)
                        const received = lineDeposits?.[line.orderId] ?? (Number(line.deposit) || expected)
                        const checked = selected?.has(line.orderId) ?? false
                        return (
                          <div
                            key={line.orderId}
                            className={
                              'pr-order-row pr-order-row--pending' + (checked ? ' is-selected' : '')
                            }
                          >
                            <label className="pr-check-label pr-order-check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  toggleLineSelected(report.id, line.orderId, e.target.checked)
                                }
                              />
                            </label>
                            <div className="pr-order-main">
                              <strong>{line.groupName}</strong>
                              <span className="pr-order-code">{line.lookupCode}</span>
                            </div>
                            <div className="pr-order-amount pr-order-col-num">
                              NT$ {expected.toLocaleString('zh-TW')}
                            </div>
                            <label className="pr-order-input-wrap pr-order-col-num">
                              <input
                                type="number"
                                className="v50-order-input pr-order-input"
                                min={0}
                                step={1}
                                value={received}
                                aria-label={`${line.groupName} 實收訂金`}
                                onChange={(e) => setLineDeposit(report.id, line.orderId, e.target.value)}
                              />
                            </label>
                          </div>
                        )
                      })}
                    </div>

                    {(report.balanceMemos || []).length > 0 ? (
                      <BalanceMemoCollapsible
                        title="帳務備註（確認後改為已抵銷）"
                        summary={`${report.balanceMemos!.length} 筆 · 合計 ${formatMemoAmount(sumReportMemoAmounts(report.balanceMemos))}`}
                        className="pr-balance-memos"
                        storageKey={`heina.pr.cbm.${report.id}`}
                      >
                        <ul className="pr-balance-memos-list">
                          {(report.balanceMemos || []).map((m) => (
                            <li key={m.id}>
                              <span>{formatMemoAmount(m.amountTwd)}</span>
                              <span className="pr-balance-memos-hint">
                                {m.amountTwd > 0 ? '客人欠我' : m.amountTwd < 0 ? '可抵扣' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </BalanceMemoCollapsible>
                    ) : null}

                    <footer className="pr-footer">
                      <div className="pr-footer-bank">
                        <label>
                          入帳銀行
                          <select
                            value={bank}
                            onChange={(e) =>
                              setBankByReport((m) => ({
                                ...m,
                                [report.id]: e.target.value,
                              }))
                            }
                          >
                            {REMITTANCE_BANK_OPTIONS.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="pr-footer-actions">
                        <button
                          type="button"
                          className="v50-order-btn-save min-h-11 px-6"
                          disabled={isBusy}
                          onClick={() => void confirmReport(report.id)}
                        >
                          {confirmingId === report.id ? '處理中…' : '已確認'}
                        </button>
                      </div>
                    </footer>
                  </>
                ) : (
                  <>
                    <header className="pr-card-head pr-card-head--confirmed">
                      <div className="pr-confirmed-head-main">
                        <div className="pr-confirmed-title-block">
                          <div className="pr-card-title-row">
                            <span className="pr-badge pr-badge--confirmed">已確認</span>
                            {report.source === 'admin_review' ? (
                              <span className="pr-badge pr-badge--admin">付款審核</span>
                            ) : null}
                            <h2 className="pr-card-name">{report.customerName}</h2>
                          </div>
                          <div className="pr-meta pr-meta--confirmed">
                            <span className="pr-chip pr-chip--date">匯款 {report.remittanceDate}</span>
                            <span className="pr-chip pr-chip--code">#{report.lastFive}</span>
                            {report.confirmedBank ? (
                              <span className="pr-chip pr-chip--bank">{report.confirmedBank}</span>
                            ) : null}
                            {confirmedLabel ? (
                              <span className="pr-chip pr-chip--ok">確認 {confirmedLabel}</span>
                            ) : null}
                            <span className="pr-chip pr-chip--time">送出 {submitted}</span>
                          </div>
                        </div>

                        <div className="pr-confirmed-summary">
                          <div className="pr-confirmed-sum-item">
                            <span className="pr-confirmed-sum-label">客人回報</span>
                            <span className="pr-confirmed-sum-value">
                              NT$ {customerReportedTotal(report).toLocaleString('zh-TW')}
                            </span>
                          </div>
                          <div className="pr-confirmed-sum-item pr-confirmed-sum-item--main">
                            <span className="pr-confirmed-sum-label">本次入帳</span>
                            <span className="pr-confirmed-sum-value">
                              NT$ {liveTotal.toLocaleString('zh-TW')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pr-confirmed-actions">
                        <button
                          type="button"
                          className="pr-btn pr-btn--warn"
                          disabled={isBusy}
                          onClick={() => void revertReport(report)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          返回待確認
                        </button>
                        <button
                          type="button"
                          className="pr-btn pr-btn--danger"
                          disabled={isBusy}
                          onClick={() => void deleteReport(report)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          刪除
                        </button>
                      </div>
                    </header>

                    <div className="pr-orders pr-orders--confirmed">
                      <div className="pr-confirmed-table">
                        <div className="pr-confirmed-table-head">
                          <span>團務</span>
                          <span>應收訂金</span>
                          <span>實收訂金</span>
                          <span>補款</span>
                        </div>
                        {report.lines.map((line) => {
                          const expected = lineExpectedDeposit(line)
                          const received = line.deposit
                          const supplementGap = Math.max(0, expected - received)
                          return (
                            <div
                              key={line.orderId}
                              className={
                                'pr-confirmed-table-row' +
                                (supplementGap > 0 ? ' has-gap' : '') +
                                (line.needsSupplement ? ' needs-supplement' : '')
                              }
                            >
                              <div className="pr-confirmed-col-group">
                                <strong>{line.groupName}</strong>
                                <span className="pr-order-code">{line.lookupCode}</span>
                                {line.supplementTotal ? (
                                  <span className="pr-order-supplement-tag">
                                    已補款 NT$ {line.supplementTotal.toLocaleString('zh-TW')}
                                  </span>
                                ) : null}
                              </div>
                              <div className="pr-confirmed-col-num">
                                NT$ {expected.toLocaleString('zh-TW')}
                              </div>
                              <div className="pr-confirmed-col-num">
                                <span>NT$ {received.toLocaleString('zh-TW')}</span>
                                {supplementGap > 0 ? (
                                  <span className="pr-order-gap">短收 {supplementGap}</span>
                                ) : null}
                              </div>
                              <div className="pr-confirmed-col-sup">
                                <label className="pr-check-label pr-check-label--sup">
                                  <input
                                    type="checkbox"
                                    checked={line.needsSupplement ?? false}
                                    onChange={(e) =>
                                      void toggleNeedsSupplement(report, line, e.target.checked)
                                    }
                                  />
                                  需補款
                                </label>
                                {line.needsSupplement ? (
                                  <button
                                    type="button"
                                    className="pr-btn pr-btn--ghost pr-btn--sup"
                                    disabled={supplementingId === line.orderId}
                                    onClick={() => openSupplement(report, line)}
                                  >
                                    補款
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {(report.balanceMemos || []).length > 0 ? (
                        <BalanceMemoCollapsible
                          title="帳務備註（已隨回報抵銷）"
                          summary={`${report.balanceMemos!.length} 筆 · 合計 ${formatMemoAmount(sumReportMemoAmounts(report.balanceMemos))}`}
                          className="pr-balance-memos pr-balance-memos--confirmed"
                          storageKey={`heina.pr.cbm.confirmed.${report.id}`}
                          defaultCollapsed
                        >
                          <ul className="pr-balance-memos-list">
                            {(report.balanceMemos || []).map((m) => (
                              <li key={m.id}>
                                <span>{formatMemoAmount(m.amountTwd)}</span>
                                <span className="pr-balance-memos-hint">已抵銷</span>
                              </li>
                            ))}
                          </ul>
                        </BalanceMemoCollapsible>
                      ) : null}
                    </div>
                  </>
                )}
              </article>
            )
          })}
        </div>
      )}

      {supplementTarget ? (
        <div className="pr-modal-backdrop" onClick={() => setSupplementTarget(null)}>
          <div className="pr-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pr-modal-title">補款入帳 · {supplementTarget.line.groupName}</h3>
            <p className="pr-modal-desc">
              應收 NT$ {lineExpectedDeposit(supplementTarget.line).toLocaleString('zh-TW')}，
              已收 NT$ {supplementTarget.line.deposit.toLocaleString('zh-TW')}
            </p>
            <label className="pr-modal-field">
              補款金額
              <input
                type="number"
                className="v50-order-input"
                min={1}
                value={supplementAmount}
                onChange={(e) => setSupplementAmount(e.target.value)}
              />
            </label>
            <label className="pr-modal-field">
              匯款日
              <input
                type="date"
                className="v50-order-input"
                value={supplementDate}
                onChange={(e) => setSupplementDate(e.target.value)}
              />
            </label>
            <label className="pr-modal-field">
              銀行
              <select className="v50-order-input" value={supplementBank} onChange={(e) => setSupplementBank(e.target.value)}>
                {REMITTANCE_BANK_OPTIONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="pr-modal-field">
              備註／後五碼
              <input
                className="v50-order-input"
                placeholder="選填"
                value={supplementNote}
                onChange={(e) => setSupplementNote(e.target.value)}
              />
            </label>
            <div className="pr-modal-actions">
              <button type="button" className="pr-btn pr-btn--ghost" onClick={() => setSupplementTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="v50-order-btn-save"
                disabled={supplementingId === supplementTarget.orderId}
                onClick={() => void submitSupplement()}
              >
                {supplementingId === supplementTarget.orderId ? '處理中…' : '確認補款'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="pr-footnote">
        主動對帳請至 <Link to="/payment-review">付款審核</Link>。
      </p>
      </div>
    </div>
  )
}
