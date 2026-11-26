import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileUp, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { Btn, Empty, PageHeader } from '../components/ui'
import { PageLayout } from '../components/app/PageLayout'
import { useApi } from '../context/useApi'
import { isSheetEditing } from '../sync/sheetSync'
import { useRemoteSlice } from '../sync/SheetSyncBridge'
import type { BankJournalRow, CustomerPaymentReport, GroupBuyGroup } from '../api/types'
import { localTodayIso, REMITTANCE_BANK_OPTIONS } from '../modules/groupbuy/v50Utils'
import {
  displayJournalLastFive,
  displayJournalNote,
  formatJournalDate,
  formatLastFiveDisplay,
  journalFromXlsxBuffer,
  journalToXlsxBuffer,
  journalViewRows,
  mergeJournalById,
  newJournalId,
  normalizeLastFive,
  peekJournalUndo,
  popJournalUndo,
  pushJournalUndo,
  sortJournalNewest,
  type JournalViewRow,
} from '../modules/groupbuy/journalLogic'
import './journalPage.css'

function money(n: number) {
  return `NT$ ${Math.round(n || 0).toLocaleString('zh-TW')}`
}

function bankLabel(bank: string | undefined) {
  const name = String(bank || '').trim()
  return name || '待分類'
}

function uniqueSourceIds(list: { sourceId: string }[]) {
  return [...new Set(list.map((row) => row.sourceId))]
}

function groupJournalByBank(list: JournalViewRow[]) {
  const map = new Map<string, JournalViewRow[]>()
  for (const row of list) {
    const key = bankLabel(row.bank)
    const bucket = map.get(key) || []
    bucket.push(row)
    map.set(key, bucket)
  }
  const preferred = [...REMITTANCE_BANK_OPTIONS, '待分類']
  return [...map.keys()]
    .sort((a, b) => {
      const ia = preferred.indexOf(a as (typeof preferred)[number])
      const ib = preferred.indexOf(b as (typeof preferred)[number])
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'zh-Hant')
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    .map((bank) => ({ bank, rows: map.get(bank) || [] }))
}

function SelectBox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <label className="journal-check">
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  )
}

export function JournalPage() {
  const api = useApi()
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<BankJournalRow[]>([])
  const [reports, setReports] = useState<CustomerPaymentReport[]>([])
  const [groups, setGroups] = useState<GroupBuyGroup[]>([])
  const [orderPaid, setOrderPaid] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [draft, setDraft] = useState({
    date: localTodayIso(),
    bank: REMITTANCE_BANK_OPTIONS[0] as string,
    amount: '',
    note: '',
    lastFive: '',
  })

  const refreshUndo = useCallback(() => {
    setCanUndo(!!peekJournalUndo())
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.call<{
        bankJournal?: BankJournalRow[]
        paymentReports?: CustomerPaymentReport[]
        groups?: GroupBuyGroup[]
      }>({
        module: 'groupbuy',
        action: 'getAppData',
        payload: { groupScope: 'all' },
      })
      setRows(sortJournalNewest(data.bankJournal || []))
      setReports(data.paymentReports || [])
      setGroups(data.groups || [])
      const paid = (data.groups || []).reduce(
        (sum, group) => sum + (group.orders || []).reduce((inner, order) => inner + (Number(order.deposit) || 0), 0),
        0,
      )
      setOrderPaid(paid)
      refreshUndo()
    } catch (e) {
      console.error(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [api, refreshUndo])

  useEffect(() => {
    void load()
  }, [load])

  useRemoteSlice((slice) => {
    if (isSheetEditing()) return
    if (slice.bankJournal || slice.groups) void load()
  })

  function flash(msg: string) {
    setStatus(msg)
    window.setTimeout(() => setStatus(''), 2800)
  }

  const persist = useCallback(
    async (next: BankJournalRow[], recordUndo = true, mode: 'replace' | 'upsert' = 'replace') => {
      if (recordUndo) pushJournalUndo(rows)
      const saved = await api.call<{ bankJournal?: BankJournalRow[] }>({
        module: 'groupbuy',
        action: 'saveBankJournal',
        payload: { bankJournal: next, mode },
      })
      setRows(sortJournalNewest(saved?.bankJournal || next))
      refreshUndo()
    },
    [api, rows, refreshUndo],
  )

  async function addManual() {
    const amount = Math.round(Number(draft.amount) || 0)
    const note = draft.note.trim()
    const date = draft.date.trim() || localTodayIso()
    if (!note) {
      flash('請填備註（人名＋團務名稱）')
      return
    }
    if (amount <= 0) {
      flash('金額需大於 0')
      return
    }
    const row: BankJournalRow = {
      id: newJournalId('j_manual'),
      date,
      bank: draft.bank || '待分類',
      type: '收入',
      amount,
      category: '手動',
      note,
      lastFive: normalizeLastFive(draft.lastFive),
    }
    setBusy(true)
    try {
      await persist([row, ...rows], true, 'upsert')
      setDraft({ date: localTodayIso(), bank: draft.bank, amount: '', note: '', lastFive: '' })
      flash('已新增日記帳（不影響團務明細）')
    } catch (e) {
      console.error(e)
      flash('新增失敗')
    } finally {
      setBusy(false)
    }
  }

  async function removeRow(id: string) {
    const parts = viewRows.filter((row) => row.sourceId === id).length
    const message =
      parts > 1
        ? `這筆匯款含 ${parts} 個團務，刪除會一併移除這些分行。訂單、付款回報與對帳不會被改動。`
        : '確定刪除此筆日記帳？訂單、付款回報與對帳不會被改動。'
    if (!window.confirm(message)) return
    setBusy(true)
    pushJournalUndo(rows)
    try {
      const saved = await api.call<{ bankJournal?: BankJournalRow[] }>({
        module: 'groupbuy',
        action: 'deleteBankJournalRows',
        payload: { ids: [id], operationId: `journal_del_${Date.now()}_${Math.random().toString(16).slice(2, 6)}` },
      })
      setRows(sortJournalNewest(saved?.bankJournal || rows.filter((r) => r.id !== id)))
      setSelected((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      refreshUndo()
      flash('已刪除日記帳（對帳與團務明細未改）')
    } catch (e) {
      console.error(e)
      popJournalUndo()
      refreshUndo()
      flash(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setBusy(false)
    }
  }

  async function restorePrevious() {
    const prev = popJournalUndo()
    if (!prev) {
      flash('沒有可還原的版本')
      refreshUndo()
      return
    }
    setBusy(true)
    try {
      const currentIds = new Set(rows.map((r) => r.id))
      const prevIds = new Set(prev.map((r) => r.id))
      const toRestore = prev.filter((r) => !currentIds.has(r.id))
      const deleteIds = rows.filter((r) => !prevIds.has(r.id)).map((r) => r.id)
      const saved = await api.call<{ bankJournal?: BankJournalRow[] }>({
        module: 'groupbuy',
        action: 'restoreBankJournalRows',
        payload: {
          rows: toRestore,
          deleteIds,
          operationId: `journal_restore_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        },
      })
      setRows(sortJournalNewest(saved?.bankJournal || prev))
      flash('已還原上一版日記帳（只處理差異紀錄）')
    } catch (e) {
      console.error(e)
      pushJournalUndo(prev)
      flash(e instanceof Error ? e.message : '還原失敗')
    } finally {
      setBusy(false)
      refreshUndo()
    }
  }

  const viewRows = useMemo(() => journalViewRows(rows, reports, groups), [rows, reports, groups])
  const bankGroups = useMemo(() => groupJournalByBank(viewRows), [viewRows])
  const allSourceIds = useMemo(() => uniqueSourceIds(viewRows), [viewRows])

  function toggleSource(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSources(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function removeSelected() {
    const ids = [...selected]
    const lineCount = viewRows.filter((row) => selected.has(row.sourceId)).length
    if (!ids.length) return
    if (!window.confirm(`刪除勾選的 ${lineCount} 列日記帳？訂單、付款回報與對帳不會被改動。`)) return
    setBusy(true)
    pushJournalUndo(rows)
    try {
      const saved = await api.call<{ bankJournal?: BankJournalRow[] }>({
        module: 'groupbuy',
        action: 'deleteBankJournalRows',
        payload: { ids, operationId: `journal_del_${Date.now()}_${Math.random().toString(16).slice(2, 6)}` },
      })
      const drop = new Set(ids)
      setRows(sortJournalNewest(saved?.bankJournal || rows.filter((row) => !drop.has(row.id))))
      setSelected(new Set())
      refreshUndo()
      flash(`已刪除 ${lineCount} 列日記帳（對帳與團務明細未改）`)
    } catch (e) {
      console.error(e)
      popJournalUndo()
      refreshUndo()
      flash(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setBusy(false)
    }
  }

  function downloadXlsx() {
    const buf = journalToXlsxBuffer(viewRows)
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `日記帳_${localTodayIso()}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    flash('已下載 Excel，可當備份')
  }

  async function uploadXlsx(file: File | null) {
    if (!file) return
    setBusy(true)
    try {
      const incoming = journalFromXlsxBuffer(await file.arrayBuffer())
      if (!incoming.length) {
        flash('檔案沒有可匯入的列')
        return
      }
      const replace = window.confirm(
        `匯入 ${incoming.length} 筆。\n\n確定：整份覆蓋目前日記帳（用備份檔還原時選這個）\n取消：依 ID 合併，不刪現有列`,
      )
      await persist(
        replace ? sortJournalNewest(incoming) : mergeJournalById(rows, incoming),
        true,
        replace ? 'replace' : 'upsert',
      )
      flash(replace ? `已覆蓋為 ${incoming.length} 筆` : `已合併 ${incoming.length} 筆`)
    } catch (e) {
      console.error(e)
      flash('匯入失敗')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows])

  return (
    <PageLayout>
      <div className="journal-page">
        {status ? <div className="gb-toast">{status}</div> : null}
        <PageHeader
          title="日記帳"
          subtitle="獨立帳本：刪除、匯入、還原都只動日記帳，不會改訂單、付款回報或對帳。"
          action={
            <>
              <Btn variant="secondary" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" />
                重新載入
              </Btn>
              <Btn variant="secondary" onClick={() => void restorePrevious()} disabled={!canUndo || busy}>
                <Undo2 className="h-4 w-4" />
                還原上一版
              </Btn>
              <Btn variant="secondary" onClick={downloadXlsx} disabled={!rows.length}>
                <FileDown className="h-4 w-4" />
                匯出 Excel
              </Btn>
              <Btn variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <FileUp className="h-4 w-4" />
                上傳 Excel
              </Btn>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="journal-file"
                onChange={(e) => void uploadXlsx(e.target.files?.[0] || null)}
              />
            </>
          }
        />

        <section className="journal-help">
          <p>
            <strong>核對後可刪：</strong>先匯出 Excel 到自己的表單。日記帳不用一直留，勾選後刪除不會改對帳、訂單或付款狀態。也可按「還原上一版」。
          </p>
          <p>
            <strong>沖銷／付款確認寫錯：</strong>到付款回報「返回待確認」，或在團務明細把付款改回未付款。日記帳那筆請在本頁另外刪除。
          </p>
        </section>

        <section className="journal-add">
          <h2>手動新增</h2>
          <div className="journal-add-grid">
            <label>
              日期
              <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            </label>
            <label>
              銀行
              <select value={draft.bank} onChange={(e) => setDraft((d) => ({ ...d, bank: e.target.value }))} aria-label="銀行">
                {REMITTANCE_BANK_OPTIONS.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </label>
            <label>
              金額
              <input
                type="number"
                min={0}
                placeholder="NT$"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              />
            </label>
            <label className="journal-add-note">
              備註（人名＋團務名稱）
              <input
                value={draft.note}
                placeholder="例：小聖 示範團｜Jump 周邊"
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              />
            </label>
            <label>
              後五碼
              <input
                value={draft.lastFive}
                placeholder="12345"
                maxLength={8}
                onChange={(e) => setDraft((d) => ({ ...d, lastFive: e.target.value }))}
              />
            </label>
            <button type="button" className="journal-add-btn" disabled={busy} onClick={() => void addManual()}>
              <Plus className="h-4 w-4" />
              新增
            </button>
          </div>
        </section>

        <p className="journal-sum">
          原始收入合計 {money(total)}。這是全部日記帳收入相加，包含已撤銷審核但仍保留的收入，不是退款後的淨額。
        </p>
        <p className="journal-sum">目前訂單已付金額 {money(orderPaid)}。這是訂單上的訂金，與原始收入合計分開計算。</p>

        {loading ? <p className="journal-loading">載入中…</p> : null}

        {!loading && !rows.length ? (
          <Empty title="尚無日記帳" hint="確認付款或沖銷後會自動出現，或在上方手動新增。" />
        ) : (
          <>
            <div className="journal-toolbar">
              <SelectBox
                checked={allSourceIds.length > 0 && allSourceIds.every((id) => selected.has(id))}
                indeterminate={selected.size > 0 && !allSourceIds.every((id) => selected.has(id))}
                onChange={() => toggleSources(allSourceIds, !allSourceIds.every((id) => selected.has(id)))}
                label="全選日記帳"
              />
              <span>全選</span>
              <span className="journal-toolbar-count">
                已選 {viewRows.filter((row) => selected.has(row.sourceId)).length} 列
              </span>
              <button type="button" className="journal-delete-selected" disabled={!selected.size || busy} onClick={() => void removeSelected()}>
                <Trash2 className="h-4 w-4" />
                刪除勾選
              </button>
            </div>
            {bankGroups.map((group) => {
              const ids = uniqueSourceIds(group.rows)
              const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
              const someOn = ids.some((id) => selected.has(id))
              const subtotal = group.rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
              return (
                <section key={group.bank} className="journal-bank" aria-label={group.bank}>
                  <header className="journal-bank-head">
                    <SelectBox
                      checked={allOn}
                      indeterminate={someOn && !allOn}
                      onChange={() => toggleSources(ids, !allOn)}
                      label={`全選${group.bank}`}
                    />
                    <h2>{group.bank}</h2>
                    <span>
                      {group.rows.length} 列 · {money(subtotal)}
                    </span>
                  </header>
                  <div className="journal-table" role="table" aria-label={`${group.bank}日記帳`}>
                    <div className="journal-table-head" role="row">
                      <span role="columnheader"> </span>
                      <span role="columnheader">日期</span>
                      <span role="columnheader">金額</span>
                      <span role="columnheader">備註</span>
                      <span role="columnheader">後五碼</span>
                      <span role="columnheader"> </span>
                    </div>
                    {group.rows.map((row) => (
                      <div key={row.id} className="journal-table-row" role="row">
                        <span className="journal-check-cell" role="cell">
                          <SelectBox
                            checked={selected.has(row.sourceId)}
                            onChange={() => toggleSource(row.sourceId)}
                            label={`勾選 ${displayJournalNote(row) || '日記帳'}`}
                          />
                        </span>
                        <span className="journal-date" role="cell">
                          {formatJournalDate(row.date) || '—'}
                        </span>
                        <strong className="journal-amount" role="cell">
                          {money(row.amount)}
                        </strong>
                        <span className="journal-note" role="cell">
                          {displayJournalNote(row) || '—'}
                          {row.operationId ? ` · 操作 ${row.operationId}` : ''}
                          {row.reviewState ? ` · ${row.reviewState}` : ''}
                        </span>
                        <span className="journal-five" role="cell">
                          {formatLastFiveDisplay(displayJournalLastFive(row))}
                        </span>
                        <span className="journal-del-cell" role="cell">
                          <button
                            type="button"
                            className="journal-del"
                            onClick={() => void removeRow(row.sourceId)}
                            aria-label={row.split ? '刪除這筆匯款的全部分行' : '刪除'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </div>
    </PageLayout>
  )
}
