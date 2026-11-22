import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupBuyGroup } from '../../api/types'
import { normalizeGroupStatus } from './v50Utils'
import {
  exportV50GroupInfoXlsx,
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
    updates: {
      groupId: string
      orders: GroupBuyGroup['orders']
      groupPatch?: Partial<GroupBuyGroup>
    }[],
    summary: string,
  ) => void
}

type Props = ExportProps | ExportFullProps | ImportProps

function importPlanKey(plan: V50WorkbookImportPreview['plans'][number]) {
  return `${plan.sheetName}::${plan.groupId}`
}

function planHasChanges(plan: V50WorkbookImportPreview['plans'][number]) {
  return !!plan.groupId && (plan.added > 0 || plan.updated > 0 || !!plan.groupPatch)
}

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
  const [selectedImportPlans, setSelectedImportPlans] = useState<Set<string>>(new Set())
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

  function handleExportInfo() {
    const picked = eligible.filter((g) => selected.has(g.id))
    if (!picked.length) {
      setMessage('請至少選擇一個團務')
      return
    }
    exportV50GroupInfoXlsx(picked)
    setMessage(`已匯出 ${picked.length} 個團務的開團資訊`)
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
      setSelectedImportPlans(new Set(next.plans.filter(planHasChanges).map(importPlanKey)))
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
    const selectedPlans = preview.plans.filter(
      (plan) => planHasChanges(plan) && selectedImportPlans.has(importPlanKey(plan)),
    )
    if (!selectedPlans.length) {
      setMessage('請至少選擇一個可匯入的團務')
      return
    }
    const selectedGroupIds = selectedPlans.map((plan) => plan.groupId)
    if (new Set(selectedGroupIds).size !== selectedGroupIds.length) {
      setMessage('多個工作表對應同一團務，請一次只選取該團的一個工作表')
      return
    }
    const updates = selectedPlans.map((plan) => ({
      groupId: plan.groupId,
      orders: plan.orders,
      groupPatch: plan.groupPatch,
    }))
    const addable = selectedPlans.reduce((sum, plan) => sum + plan.added, 0)
    const updatable = selectedPlans.reduce((sum, plan) => sum + plan.updated, 0)
    const failed = selectedPlans.reduce((sum, plan) => sum + plan.failed, 0)
    const infoCount = selectedPlans.filter((plan) => plan.groupPatch).length
    const summary = `已匯入：新增 ${addable} 筆${updatable ? `、更新 ${updatable} 筆` : ''}${infoCount ? `、開團資訊 ${infoCount} 筆` : ''}${failed ? `、失敗 ${failed} 筆` : ''}`
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
      ? '勾選要備份的團務（含已結束）。每團一工作表，包含開團主檔欄位與客訂明細；圖片仍在開團專區管理。也可下載僅含開團資訊、可逐團匯入的精簡檔。'
      : props.mode === 'export'
        ? '選擇要匯出的團務（不含已結束）。同一客戶多品項會分多列；續列名字請留空。付款狀態寫日期與後五碼，例如 11/20 #66666，沒有則空白。'
        : '上傳 Excel 後先預覽。每個工作表名稱需與團務名稱相同；可勾選要匯入的團務，逐團選擇後再確認。若含開團主檔列，團務資訊也會更新並同步到開團專區。'

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
                className="v50-excel-btn v50-excel-btn--ghost"
                onClick={handleExportInfo}
                disabled={!selected.size}
              >
                匯出開團資訊
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
                {preview.plans.map((p) => {
                  const canImport = planHasChanges(p)
                  const key = importPlanKey(p)
                  return (
                    <li key={key}>
                      <label className="v50-excel-row">
                        <input
                          type="checkbox"
                          checked={canImport && selectedImportPlans.has(key)}
                          disabled={!canImport}
                          onChange={() => {
                            setSelectedImportPlans((prev) => {
                              const next = new Set(prev)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          }}
                        />
                        <span className="v50-excel-row-name">{p.groupName}</span>
                        <span className="v50-excel-row-meta">
                          {p.groupId
                            ? `可新增 ${p.added}${p.updated ? ` · 可更新 ${p.updated}` : ''}${p.groupPatch ? ' · 開團資訊' : ''} · 失敗 ${p.failed}`
                            : `失敗 ${p.failed}`}
                        </span>
                      </label>
                    </li>
                  )
                })}
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
                disabled={busy || !preview || (preview.addable + preview.updatable === 0 && !preview.plans.some((p) => p.groupPatch))}
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
