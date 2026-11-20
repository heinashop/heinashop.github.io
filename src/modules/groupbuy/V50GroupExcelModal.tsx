import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupBuyGroup } from '../../api/types'
import { normalizeGroupStatus } from './v50Utils'
import {
  exportV50GroupsFullBackupXlsx,
  exportV50GroupsToXlsx,
  previewV50WorkbookImport,
  type V50WorkbookImportPreview,
} from './v50ExcelBridge'
import './v50GroupExcelModal.css'

type ExportProps = {
  mode: 'export'
  groups: GroupBuyGroup[]
  onClose: () => void
}

type ExportFullProps = {
  mode: 'exportFull'
  groups: GroupBuyGroup[]
  onClose: () => void
}

type ImportProps = {
  mode: 'import'
  groups: GroupBuyGroup[]
  onClose: () => void
  onImport: (
    updates: { groupId: string; orders: GroupBuyGroup['orders'] }[],
    summary: string,
  ) => void
}

type Props = ExportProps | ExportFullProps | ImportProps

function activeGroups(groups: GroupBuyGroup[]) {
  return groups.filter((g) => normalizeGroupStatus(g.status) !== '已結束')
}

function eligibleGroups(mode: Props['mode'], groups: GroupBuyGroup[]) {
  if (mode === 'exportFull') return groups
  return activeGroups(groups)
}

export function V50GroupExcelModal(props: Props) {
  const eligible = useMemo(() => eligibleGroups(props.mode, props.groups), [props.mode, props.groups])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((g) => g.id)))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [preview, setPreview] = useState<V50WorkbookImportPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelected(new Set(eligible.map((g) => g.id)))
  }, [eligible])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === eligible.length) setSelected(new Set())
    else setSelected(new Set(eligible.map((g) => g.id)))
  }

  function handleExport() {
    const picked = eligible.filter((g) => selected.has(g.id))
    if (!picked.length) {
      setMessage('請至少選擇一個團務')
      return
    }
    if (props.mode === 'exportFull') {
      exportV50GroupsFullBackupXlsx(picked)
      setMessage(`已匯出 ${picked.length} 個團務的完整備份`)
      return
    }
    exportV50GroupsToXlsx(picked)
    setMessage(`已匯出 ${picked.length} 個團務的客訂資料`)
  }

  async function handleImportFile(file: File | null) {
    if (!file || props.mode !== 'import') return
    setBusy(true)
    setMessage('')
    setWarnings([])
    setPreview(null)
    try {
      const ab = await file.arrayBuffer()
      const next = previewV50WorkbookImport(ab, eligible)
      setPreview(next)
      setWarnings(next.warnings)
      setMessage(`可新增 ${next.addable} 筆、失敗 ${next.failed} 筆${next.updatable ? `、可更新 ${next.updatable} 筆` : ''}`)
    } catch (e) {
      console.error(e)
      setMessage('讀取檔案失敗，請確認為 .xlsx 格式')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function confirmImport() {
    if (props.mode !== 'import' || !preview) return
    const updates = preview.plans
      .filter((p) => p.groupId && (p.added > 0 || p.updated > 0))
      .map((p) => ({ groupId: p.groupId, orders: p.orders }))
    if (!updates.length) {
      setMessage('沒有可匯入的客訂')
      return
    }
    const summary = `已匯入：新增 ${preview.addable} 筆${preview.updatable ? `、更新 ${preview.updatable} 筆` : ''}${preview.failed ? `、失敗 ${preview.failed} 筆` : ''}`
    props.onImport(updates, summary)
    props.onClose()
  }

  const isExportPick = props.mode === 'export' || props.mode === 'exportFull'

  const title =
    props.mode === 'exportFull'
      ? '匯出完整團務備份'
      : props.mode === 'export'
        ? '匯出 Excel'
        : '匯入 Excel'

  const subtitle =
    props.mode === 'exportFull'
      ? '勾選要備份的團務（含已結束）。每團一工作表：團務主檔＋客訂明細；台幣售價為數量×單價。僅供本機備份，請勿用於匯入。'
      : props.mode === 'export'
        ? '選擇要匯出的團務（不含已結束）。同一客戶多品項會分多列；續列名字請留空。付款狀態寫日期與後五碼，例如 11/20 #66666，沒有則空白。'
        : '上傳 Excel 後先預覽。每個工作表名稱需與團務名稱相同，可一次匯入多團。確認後才會寫入。'

  const emptyText =
    props.mode === 'exportFull'
      ? '目前沒有任何團務可匯出。'
      : '目前沒有可操作的團務（已結束以外的團務為空）。'

  return (
    <div className="v50-order-backdrop" onClick={props.onClose}>
      <div className="v50-excel-card" onClick={(e) => e.stopPropagation()}>
        <div className="v50-excel-head">
          <h3 className="v50-excel-title">{title}</h3>
          <button type="button" className="v50-excel-close" onClick={props.onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <p className="v50-excel-sub">{subtitle}</p>

        {eligible.length === 0 ? (
          <p className="v50-excel-empty">{emptyText}</p>
        ) : isExportPick ? (
          <>
            <div className="v50-excel-toolbar">
              <button type="button" className="v50-excel-link" onClick={toggleAll}>
                {selected.size === eligible.length ? '取消全選' : '全選'}
              </button>
              <span className="v50-excel-count">已選 {selected.size} / {eligible.length}</span>
            </div>
            <ul className="v50-excel-list">
              {eligible.map((g) => {
                const checked = selected.has(g.id)
                const orderCount = (g.orders || []).length
                return (
                  <li key={g.id}>
                    <label className="v50-excel-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(g.id)}
                      />
                      <span className="v50-excel-row-name">{g.name}</span>
                      <span className="v50-excel-row-meta">
                        {normalizeGroupStatus(g.status)} · {orderCount} 筆客訂
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="v50-excel-actions">
              <button type="button" className="v50-excel-btn v50-excel-btn--ghost" onClick={props.onClose}>
                取消
              </button>
              <button
                type="button"
                className="v50-excel-btn v50-excel-btn--primary"
                onClick={handleExport}
                disabled={!selected.size}
              >
                下載 Excel
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)}
            />
            {preview ? (
              <ul className="v50-excel-list">
                {preview.plans.map((p) => (
                  <li key={`${p.sheetName}-${p.groupId || 'miss'}`}>
                    <div className="v50-excel-row">
                      <span className="v50-excel-row-name">{p.groupName}</span>
                      <span className="v50-excel-row-meta">
                        {p.groupId
                          ? `可新增 ${p.added}${p.updated ? ` · 可更新 ${p.updated}` : ''} · 失敗 ${p.failed}`
                          : `失敗 ${p.failed}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="v50-excel-empty">尚未選擇檔案。多團請把每個團放在同名工作表。</p>
            )}
            <div className="v50-excel-actions">
              <button type="button" className="v50-excel-btn v50-excel-btn--ghost" onClick={props.onClose}>
                取消
              </button>
              <button
                type="button"
                className="v50-excel-btn v50-excel-btn--ghost"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? '讀取中…' : preview ? '重選檔案' : '選擇 Excel 檔案'}
              </button>
              <button
                type="button"
                className="v50-excel-btn v50-excel-btn--primary"
                disabled={busy || !preview || preview.addable + preview.updatable === 0}
                onClick={confirmImport}
              >
                確認匯入
              </button>
            </div>
          </>
        )}

        {message ? <p className="v50-excel-msg">{message}</p> : null}
        {warnings.length > 0 ? (
          <ul className="v50-excel-warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
