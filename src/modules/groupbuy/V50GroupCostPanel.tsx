import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { GroupBuyGroup, GroupBuyPurchaseCost } from '../../api/types'
import { Btn } from '../../components/ui'

export type GroupCostRowDraft = {
  id: string
  orderNumber: string
  jpyCost: string
  jpyShipping: string
  jpyTotal: string
  twdCost: string
  logisticsId: string
  weight: string
}

export type GroupCostSavePatch = {
  purchaseCosts: GroupBuyPurchaseCost[]
}

function newRowId() {
  return `pc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
}

function emptyRow(): GroupCostRowDraft {
  return {
    id: newRowId(),
    orderNumber: '',
    jpyCost: '',
    jpyShipping: '',
    jpyTotal: '',
    twdCost: '',
    logisticsId: '',
    weight: '',
  }
}

function calcJpyTotal(cost: string, shipping: string): string {
  const c = parseNum(cost)
  const s = parseNum(shipping)
  if (c === '' && s === '') return ''
  return String((Number(c) || 0) + (Number(s) || 0))
}

function strField(v: string | number | undefined): string {
  return v != null && v !== '' ? String(v) : ''
}

function rowFromCost(entry: GroupBuyPurchaseCost): GroupCostRowDraft {
  const jpyCost = strField(entry.jpyCost)
  const jpyShipping = strField(entry.jpyShipping)
  return {
    id: entry.id || newRowId(),
    orderNumber: entry.orderNumber != null ? String(entry.orderNumber) : '',
    jpyCost,
    jpyShipping,
    jpyTotal: strField(entry.jpyTotal) || calcJpyTotal(jpyCost, jpyShipping),
    twdCost: strField(entry.twdCost),
    logisticsId: entry.logisticsId?.trim() ?? '',
    weight: strField(entry.weight),
  }
}

function legacyRowFromGroup(group: GroupBuyGroup): GroupCostRowDraft | null {
  const jpyCost = strField(group.jpyCost)
  const jpyShipping = strField(group.jpyShipping)
  const twdCost = strField(group.twdCost)
  const weight = strField(group.weight)
  const logisticsId = group.logisticsId?.trim() ?? ''
  if (!jpyCost && !jpyShipping && !twdCost && !weight && !logisticsId) return null
  return {
    id: newRowId(),
    orderNumber: '',
    jpyCost,
    jpyShipping,
    jpyTotal: strField(group.jpyTotal) || calcJpyTotal(jpyCost, jpyShipping),
    twdCost,
    logisticsId,
    weight,
  }
}

function toRows(group: GroupBuyGroup): GroupCostRowDraft[] {
  if (group.purchaseCosts?.length) {
    return group.purchaseCosts.map(rowFromCost)
  }
  const legacy = legacyRowFromGroup(group)
  return legacy ? [legacy] : [emptyRow()]
}

function parseNum(v: string): number | '' {
  const t = v.trim()
  if (!t) return ''
  const n = Number(t)
  return Number.isFinite(n) ? n : ''
}

function resolvedJpyTotal(row: GroupCostRowDraft): string {
  const manual = row.jpyTotal.trim()
  if (manual) return manual
  return calcJpyTotal(row.jpyCost, row.jpyShipping)
}

function rowToCost(row: GroupCostRowDraft): GroupBuyPurchaseCost {
  const jpyTotal = resolvedJpyTotal(row)
  return {
    id: row.id,
    orderNumber: row.orderNumber.trim(),
    jpyCost: parseNum(row.jpyCost),
    jpyShipping: parseNum(row.jpyShipping),
    jpyTotal: parseNum(jpyTotal),
    twdCost: parseNum(row.twdCost),
    logisticsId: row.logisticsId.trim(),
    weight: row.weight.trim(),
  }
}

function isRowEmpty(row: GroupCostRowDraft) {
  return (
    !row.orderNumber.trim() &&
    !row.jpyCost.trim() &&
    !row.jpyShipping.trim() &&
    !row.twdCost.trim() &&
    !row.logisticsId.trim() &&
    !row.weight.trim()
  )
}

type Props = {
  group: GroupBuyGroup
  saving?: boolean
  onSave: (patch: GroupCostSavePatch) => void | Promise<void>
}

export function V50GroupCostPanel({ group, saving, onSave }: Props) {
  const [rows, setRows] = useState<GroupCostRowDraft[]>(() => toRows(group))
  const [dirty, setDirty] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setRows(toRows(group))
    setDirty(false)
  }, [group.id, group.purchaseCosts, group.jpyCost, group.jpyShipping, group.jpyTotal, group.twdCost, group.logisticsId, group.weight])

  function patchRow(id: string, key: keyof GroupCostRowDraft, value: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, [key]: value }
        if (key === 'jpyCost' || key === 'jpyShipping') {
          next.jpyTotal = calcJpyTotal(
            key === 'jpyCost' ? value : row.jpyCost,
            key === 'jpyShipping' ? value : row.jpyShipping,
          )
        }
        return next
      }),
    )
    setDirty(true)
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
    setDirty(true)
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return next.length ? next : [emptyRow()]
    })
    setDirty(true)
  }

  async function submit() {
    const purchaseCosts = rows.map(rowToCost).filter((_, i) => !isRowEmpty(rows[i]))
    await onSave({ purchaseCosts: purchaseCosts.length ? purchaseCosts : [] })
    setDirty(false)
  }

  return (
    <div className={'v50-group-cost-panel mb-4' + (collapsed ? ' is-collapsed' : '')}>
      <div className="v50-group-cost-panel-head">
        <div>
          <p className="v50-group-cost-title">下單成本</p>
          <p className="v50-group-cost-hint">同一團可分多次下單。每筆金額分開記，團務搜尋輸入刷卡金額就能找到這團。</p>
        </div>
        <div className="v50-group-cost-actions">
          <button
            type="button"
            className="v50-group-cost-toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
            {collapsed ? '展開' : '收合'}
          </button>
          <Btn variant="secondary" className="!min-h-9 !px-3 !py-2 text-sm" type="button" onClick={addRow}>
            <Plus className="h-4 w-4" />
            新增下單筆
          </Btn>
        </div>
      </div>

      <div className="v50-group-cost-list">
        {rows.map((row, index) => (
          <div key={row.id} className="v50-group-cost-row">
            <div className="v50-group-cost-row-label">
              <span className="v50-group-cost-row-index">第 {index + 1} 筆</span>
              {rows.length > 1 ? (
                <button type="button" className="v50-group-cost-remove" onClick={() => removeRow(row.id)} aria-label="刪除此筆">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="v50-group-cost-fields">
              <label className="v50-group-cost-field v50-group-cost-field--order-number">
                <span className="v50-group-cost-label">訂單編號</span>
                <div className="v50-group-cost-input-wrap v50-group-cost-input-wrap--text">
                  <input
                    className="v50-group-cost-input v50-group-cost-input--text"
                    type="text"
                    placeholder="採購單號"
                    maxLength={30}
                    size={12}
                    value={row.orderNumber}
                    onChange={(e) => patchRow(row.id, 'orderNumber', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--amount v50-group-cost-field--digits6">
                <span className="v50-group-cost-label">日幣成本</span>
                <div className="v50-group-cost-input-wrap">
                  <span className="v50-group-cost-prefix">¥</span>
                  <input
                    className="v50-group-cost-input"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    maxLength={6}
                    size={6}
                    placeholder="0"
                    value={row.jpyCost}
                    onChange={(e) => patchRow(row.id, 'jpyCost', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--amount v50-group-cost-field--digits4">
                <span className="v50-group-cost-label">日幣運費</span>
                <div className="v50-group-cost-input-wrap">
                  <span className="v50-group-cost-prefix">¥</span>
                  <input
                    className="v50-group-cost-input"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    maxLength={4}
                    size={4}
                    placeholder="0"
                    value={row.jpyShipping}
                    onChange={(e) => patchRow(row.id, 'jpyShipping', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--amount v50-group-cost-field--amount-total v50-group-cost-field--digits6">
                <span className="v50-group-cost-label">日幣總額</span>
                <div className="v50-group-cost-input-wrap">
                  <span className="v50-group-cost-prefix">¥</span>
                  <input
                    className="v50-group-cost-input"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    maxLength={6}
                    size={6}
                    placeholder="0"
                    value={row.jpyTotal}
                    onChange={(e) => patchRow(row.id, 'jpyTotal', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--amount v50-group-cost-field--digits6">
                <span className="v50-group-cost-label">台幣成本</span>
                <div className="v50-group-cost-input-wrap">
                  <span className="v50-group-cost-prefix">$</span>
                  <input
                    className="v50-group-cost-input"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    maxLength={6}
                    size={6}
                    placeholder="0"
                    value={row.twdCost}
                    onChange={(e) => patchRow(row.id, 'twdCost', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--logistics">
                <span className="v50-group-cost-label">物流編號</span>
                <div className="v50-group-cost-input-wrap v50-group-cost-input-wrap--text">
                  <input
                    className="v50-group-cost-input v50-group-cost-input--text"
                    type="text"
                    placeholder="追蹤單號"
                    maxLength={15}
                    size={15}
                    value={row.logisticsId}
                    onChange={(e) => patchRow(row.id, 'logisticsId', e.target.value)}
                  />
                </div>
              </label>
              <label className="v50-group-cost-field v50-group-cost-field--weight">
                <span className="v50-group-cost-label">入庫重量(kg)</span>
                <div className="v50-group-cost-input-wrap v50-group-cost-input-wrap--text">
                  <input
                    className="v50-group-cost-input v50-group-cost-input--text"
                    type="text"
                    inputMode="decimal"
                    maxLength={4}
                    size={4}
                    placeholder="0"
                    value={row.weight}
                    onChange={(e) => patchRow(row.id, 'weight', e.target.value)}
                  />
                </div>
              </label>
            </div>
          </div>
        ))}
      </div>

      {dirty ? (
        <div className="v50-group-cost-footer">
          <Btn className="!min-h-9 !px-4 !py-2 text-sm" disabled={saving} onClick={() => void submit()}>
            {saving ? '儲存中…' : '儲存'}
          </Btn>
        </div>
      ) : null}
    </div>
  )
}
