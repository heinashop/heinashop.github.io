import * as XLSX from 'xlsx'
import type { GroupBuyGroup, GroupBuyItem, GroupBuyOrder } from '../../api/types'
import {
  calcItemsTotalTwd,
  calcOrderBalance,
  formatPaymentNoteLabel,
  normalizeGroupStatus,
  suggestDeposit,
} from './v50Utils'

const EXPORT_HEADERS = [
  '訂單ID',
  '名字',
  '商品',
  '數量',
  '日幣單價',
  '日幣總額',
  '台幣單價',
  '台幣小計',
  '訂金',
  '國內運費',
  '國際運費',
  '尾款',
  '付款狀態',
] as const

const KNOWN_PAY_STATUSES = new Set(['未付款', '已付訂金', '已付款', '已結清', '貨到付款'])

function itemLineTwd(item: { twd: number; qty: number }): number {
  return (Number(item.twd) || 0) * (Number(item.qty) || 1)
}

function itemLineJpy(item: { jpy: number; qty: number }): number {
  return (Number(item.jpy) || 0) * (Number(item.qty) || 1)
}

/** 有付款才寫出訂金；未付款、貨到付款留空 */
function paidDepositCell(order: GroupBuyOrder): number | '' {
  const pay = String(order.paymentStatus || '').trim()
  if (pay !== '已付訂金' && pay !== '已付款' && pay !== '已結清') return ''
  return Number(order.deposit) || 0
}

function classifyPayCell(text: string): { status: string; note: string; deposit: number | null } {
  const t = String(text || '').trim()
  if (!t) return { status: '', note: '', deposit: null }
  if (KNOWN_PAY_STATUSES.has(t)) return { status: t, note: '', deposit: null }

  const rules: { re: RegExp; status: string }[] = [
    { re: /貨到付款|貨到付/, status: '貨到付款' },
    { re: /已付訂金|已收訂金|訂金已付|有付訂金|有收訂金|有訂金|付了訂金|收了訂金|付訂金/, status: '已付訂金' },
    { re: /已結清|已付清|全額付清|已付全額/, status: '已結清' },
    { re: /已付款/, status: '已付款' },
    { re: /未付款|尚未付款/, status: '未付款' },
  ]
  for (const rule of rules) {
    const found = t.match(rule.re)
    if (!found || found.index == null) continue
    let rest = `${t.slice(0, found.index)} ${t.slice(found.index + found[0].length)}`
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[（(：:，,、/／\s]+|[）)：:，,、/／\s]+$/g, '')
      .trim()
    const onlyMoney = rest.match(/^(\d+(?:\.\d+)?)(?:元)?$/)
    if (onlyMoney) return { status: rule.status, note: '', deposit: Number(onlyMoney[1]) }
    return { status: rule.status, note: rest, deposit: null }
  }
  return { status: '', note: t, deposit: null }
}

function norm(s: string) {
  return String(s).replace(/\s/g, '').toLowerCase()
}

function pick(row: Record<string, unknown>, ...candidates: string[]): string {
  const keys = Object.keys(row)
  const idx = new Map<string, string>()
  for (const k of keys) idx.set(norm(k), k)
  for (const c of candidates) {
    const k = idx.get(norm(c))
    if (k != null && row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim()
  }
  return ''
}

function numCell(row: Record<string, unknown>, ...candidates: string[]): number {
  const s = pick(row, ...candidates)
  if (!s) {
    for (const c of candidates) {
      const k = Object.keys(row).find((x) => norm(x) === norm(c))
      if (k != null && typeof row[k] === 'number') return row[k] as number
    }
    return 0
  }
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function isHeaderRow(row: Record<string, unknown>): boolean {
  const id = pick(row, '訂單ID', 'orderId')
  const n = pick(row, '名字', '姓名', '客戶名字')
  const p = pick(row, '商品', '品名', '品項', '商品品項')
  if (id === '訂單ID' || id === 'orderId') return true
  if (n === '名字' || n === '姓名' || n === '客戶名字') return true
  if (p === '商品' || p === '品項' || p === '商品品項') return true
  return false
}

export type V50ImportBlock = {
  orderId: string
  customerName: string
  items: GroupBuyItem[]
  domesticShip: number
  intlShip: number
  /** null＝表上沒填，沿用既有客訂或系統計算 */
  deposit: number | null
  paymentStatus: string
  /** null＝表上沒填付款備註，沿用既有客訂 */
  paymentNote: string | null
}

export type V50ImportParseResult = {
  blocks: V50ImportBlock[]
  warnings: string[]
  sheetName: string
  failed?: number
}

export function exportV50GroupsToXlsx(groups: GroupBuyGroup[], filename?: string) {
  const wb = XLSX.utils.book_new()
  const ts = new Date().toISOString().slice(0, 10)

  for (const group of groups) {
    const rows: (string | number)[][] = [[...EXPORT_HEADERS]]
    for (const order of group.orders || []) {
      const items = order.items || []
      if (!items.length) continue
      items.forEach((item, idx) => {
        rows.push([
          idx === 0 ? order.id : '',
          idx === 0 ? order.customerName : '',
          item.name,
          item.qty,
          item.jpy,
          itemLineJpy(item),
          item.twd,
          itemLineTwd(item),
          idx === 0 ? paidDepositCell(order) : '',
          idx === 0 ? order.domesticShip || 0 : '',
          idx === 0 ? order.intlShip || 0 : '',
          idx === 0 ? (Number.isFinite(Number(order.balance)) ? Number(order.balance) : '') : '',
          idx === 0 ? formatPaymentNoteLabel(order.paymentInfo) : '',
        ])
      })
    }
    const rawName = String(group.name || '團務').trim() || '團務'
    let sheetName = rawName.slice(0, 31).replace(/[\\/*?:\[\]]/g, '_')
    if (!sheetName) sheetName = '團務'
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }

  const name =
    filename ??
    `團務客訂-${ts}${groups.length === 1 ? `-${String(groups[0].name || '').slice(0, 12)}` : ''}.xlsx`
  XLSX.writeFile(wb, name.replace(/[\\/*?:\[\]]/g, '_'))
}

const GROUP_INFO_HEADERS = [
  '團務名稱',
  '團務狀態',
  '結單日',
  '結束販賣日',
  '購買日',
  '官方出貨日',
  '日幣預算總額',
  '信用卡資訊',
  '網站連結',
  '開團說明',
  '備註',
  '開團渠道',
  '開團專區公開',
  '團務管理顯示',
  '缺貨待補',
  '缺貨待補備註',
] as const

const FULL_BACKUP_META_HEADERS = [
  ...GROUP_INFO_HEADERS,
  '訂單編號（舊版團務欄位）',
  '物流編號（舊版團務欄位）',
] as const

const FULL_BACKUP_DETAIL_HEADERS = [
  '客戶名字',
  '訂單ID',
  '品名',
  '數量',
  '日幣單價',
  '日幣總額',
  '台幣售價',
  '訂金',
  '國內運費',
  '國際運費',
  '尾款',
  '支付備註',
] as const

function sheetNameFromGroup(group: GroupBuyGroup): string {
  const rawName = String(group.name || '團務').trim() || '團務'
  let sheetName = rawName.slice(0, 31).replace(/[\\/*?:\[\]]/g, '_')
  if (!sheetName) sheetName = '團務'
  return sheetName
}

function groupInfoValues(group: GroupBuyGroup, includeLegacyIds = false): (string | number)[] {
  const values: (string | number)[] = [
    group.name,
    normalizeGroupStatus(group.status),
    group.closingDate || '',
    group.saleEndDate || '',
    group.purchaseDate || '',
    group.officialShipDate || '',
    group.jpyAmount ?? '',
    group.creditCard || '',
    group.purchaseLink || '',
    group.description || '',
    group.remarks || '',
    group.channel || '',
    group.portalListed === false ? '否' : group.portalListed === true ? '是' : '',
    group.opsActive === false ? '否' : group.opsActive === true ? '是' : '',
    group.stockAlert === false ? '否' : group.stockAlert === true ? '是' : '',
    group.stockAlertNote || '',
  ]
  if (includeLegacyIds) values.push(group.orderId || '', group.logisticsId || '')
  return values
}

export function exportV50GroupInfoXlsx(groups: GroupBuyGroup[], filename?: string) {
  const wb = XLSX.utils.book_new()
  const usedSheetNames = new Set<string>()
  for (const group of groups) {
    let sheetName = sheetNameFromGroup(group)
    if (usedSheetNames.has(sheetName)) {
      let n = 2
      while (usedSheetNames.has(`${sheetName.slice(0, 28)}_${n}`)) n += 1
      sheetName = `${sheetName.slice(0, 28)}_${n}`
    }
    usedSheetNames.add(sheetName)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[...GROUP_INFO_HEADERS], groupInfoValues(group)]),
      sheetName,
    )
  }
  const name = filename ?? `開團資訊-${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(wb, name.replace(/[\\/*?:\[\]]/g, '_'))
}

export function exportV50GroupsFullBackupXlsx(groups: GroupBuyGroup[], filename?: string) {
  const wb = XLSX.utils.book_new()
  const ts = new Date().toISOString().slice(0, 10)
  const usedSheetNames = new Set<string>()

  for (const group of groups) {
    let sheetName = sheetNameFromGroup(group)
    if (usedSheetNames.has(sheetName)) {
      let n = 2
      while (usedSheetNames.has(`${sheetName.slice(0, 28)}_${n}`)) n += 1
      sheetName = `${sheetName.slice(0, 28)}_${n}`
    }
    usedSheetNames.add(sheetName)

    const rows: (string | number)[][] = []
    rows.push([...FULL_BACKUP_META_HEADERS])
    rows.push(groupInfoValues(group, true))
    rows.push([])
    rows.push([...FULL_BACKUP_DETAIL_HEADERS])

    for (const order of group.orders || []) {
      const items = order.items || []
      if (!items.length) {
        rows.push([
          order.customerName,
          order.id,
          '',
          '',
          '',
          '',
          '',
          order.deposit ?? 0,
          order.domesticShip ?? 0,
          order.intlShip ?? 0,
          order.balance ?? 0,
          order.paymentInfo || '',
        ])
        continue
      }
      items.forEach((item, idx) => {
        rows.push([
          idx === 0 ? order.customerName : '',
          idx === 0 ? order.id : '',
          item.name,
          item.qty,
          item.jpy,
          itemLineJpy(item),
          itemLineTwd(item),
          idx === 0 ? order.deposit ?? 0 : '',
          idx === 0 ? order.domesticShip ?? 0 : '',
          idx === 0 ? order.intlShip ?? 0 : '',
          idx === 0 ? order.balance ?? 0 : '',
          idx === 0 ? order.paymentInfo || '' : '',
        ])
      })
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }

  const name = filename ?? `團務完整備份-${ts}.xlsx`
  XLSX.writeFile(wb, name.replace(/[\\/*?:\[\]]/g, '_'))
}

/** 團務客訂匯入範本（與匯出欄位一致） */
export function downloadV50OrderTemplateXlsx() {
  const wb = XLSX.utils.book_new()
  const headers: (string | number)[][] = [
    [...EXPORT_HEADERS],
    ['', '範例客人', '範例商品A', 1, 1999, 1999, 590, 590, 500, 0, 0, 90, '11/20 #66666'],
    ['', '', '範例商品B', 2, 999, 1998, 125, 250, '', '', '', '', ''],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(headers), '登記表')
  const note: (string | number)[][] = [
    ['匯入說明'],
    ['1. 同一客訂：第一列填訂單ID、名字、運費；第二列起品項續填，名字與訂單ID請留空。'],
    ['2. 若每列都重複填名字，會被誤判成多筆客訂；續列品項請勿再填名字。'],
    ['3. 台幣單價=每件；台幣小計=單價×數量。日幣總額=日幣單價×數量（匯出用，匯入可略）。'],
    ['4. 匯入可只填台幣小計或日幣總額，系統會除以數量得單價。'],
    ['5. 訂金請填在該客訂第一列。有填就以表上的為準；留空則沿用既有客訂或由系統計算。'],
    ['6. 付款狀態寫日期與後五碼，例如 8/11 #18615，或訂金欄有金額，匯入會改成已付訂金。若要維持未付款，請在付款狀態填「未付款」，且訂金欄留空。'],
    ['7. 尾款由系統依總額、訂金與運費計算，匯入時可留空。'],
    ['8. 多團同時匯入：每個團務一個工作表，工作表名稱請與團務名稱相同。'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), '說明')
  XLSX.writeFile(wb, '團務客訂匯入範本.xlsx')
}

function sheetToRowRecords(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  if (!aoa.length) return []
  const headerCells = (aoa[0] ?? []).map((c) => String(c ?? '').trim())
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] ?? []
    const row: Record<string, unknown> = {}
    let hasValue = false
    for (let j = 0; j < headerCells.length; j++) {
      const key = headerCells[j]
      if (!key) continue
      const val = line[j] ?? ''
      if (val !== '' && val != null) hasValue = true
      row[key] = val
    }
    if (hasValue) rows.push(row)
  }
  return rows
}

function shouldStartNewImportBlock(
  cur: V50ImportBlock | null,
  orderId: string,
  name: string,
): boolean {
  if (orderId.trim()) return true
  if (!name.trim()) return false
  if (!cur) return true
  if (!cur.customerName.trim()) return true
  return norm(name) !== norm(cur.customerName)
}

function parseRowsToBlocks(rows: Record<string, unknown>[]): V50ImportParseResult {
  const warnings: string[] = []
  if (!rows.length) return { blocks: [], warnings: ['沒有任何列'], sheetName: '' }

  let start = 0
  if (isHeaderRow(rows[0])) start = 1

  const blocks: V50ImportBlock[] = []
  let cur: V50ImportBlock | null = null

  const flush = () => {
    if (cur && cur.items.length) {
      if (!cur.paymentStatus) {
        const noted = Boolean(cur.paymentNote && formatPaymentNoteLabel(cur.paymentNote))
        const paidDeposit = cur.deposit != null && cur.deposit > 0
        if (noted || paidDeposit) cur.paymentStatus = '已付訂金'
      }
      blocks.push(cur)
    }
    cur = null
  }

  for (let i = start; i < rows.length; i++) {
    const row = rows[i]
    const orderId = pick(row, '訂單ID', 'orderId')
    const name = pick(row, '名字', '姓名', '客戶名字', '暱稱')
    const product = pick(row, '商品', '品名', '品項', '商品品項')
    const qtyHint = numCell(row, '數量', 'qty')
    const jpyUnit = numCell(row, '日幣單價', '日幣', 'jpy', '單價')
    const jpyLineTotal = numCell(row, '日幣總額', '日幣小計', '日幣金額')
    const twdUnit = numCell(row, '台幣單價', '台幣售價', 'twd')
    const lineMoney = numCell(row, '台幣小計', '金額', '台幣', '小計', '台幣金額')
    const domesticShip = numCell(row, '國內運費', '國內運', '運費')
    const intlShip = numCell(row, '國際運費', '國際運')

    const empty =
      !orderId &&
      !name &&
      !product &&
      !qtyHint &&
      !jpyUnit &&
      !jpyLineTotal &&
      !twdUnit &&
      !lineMoney &&
      !domesticShip &&
      !intlShip
    if (empty) continue

    if (shouldStartNewImportBlock(cur, orderId, name)) {
      flush()
      cur = {
        orderId: orderId.trim(),
        customerName: name.trim(),
        items: [],
        domesticShip: domesticShip || 0,
        intlShip: intlShip || 0,
        deposit: null,
        paymentStatus: '',
        paymentNote: null,
      }
    } else if (!cur) {
      if (product) warnings.push(`第 ${i + 1} 列：有商品「${product}」但上方尚無客戶，已略過`)
      continue
    }

    if (orderId.trim() && !cur!.orderId) cur!.orderId = orderId.trim()
    if (name.trim() && !cur!.customerName) cur!.customerName = name.trim()
    if (domesticShip > 0) cur!.domesticShip = domesticShip
    if (intlShip > 0) cur!.intlShip = intlShip
    const depositText = pick(row, '訂金')
    if (depositText !== '') cur!.deposit = numCell(row, '訂金')
    const noteCol = pick(row, '付款備註', '支付備註')
    const payCell = classifyPayCell(pick(row, '付款狀態', '支付狀態', '付款情形', '收款狀態'))
    if (payCell.status) cur!.paymentStatus = payCell.status
    if (cur!.deposit == null && payCell.deposit != null) cur!.deposit = payCell.deposit
    const note = noteCol || payCell.note
    if (note) cur!.paymentNote = note

    if (product) {
      const qty = Math.max(1, qtyHint || 1)
      let twd = twdUnit
      if (!twd && lineMoney) twd = qty > 0 ? lineMoney / qty : lineMoney
      let jpy = jpyUnit
      if (!jpy && jpyLineTotal) jpy = qty > 0 ? jpyLineTotal / qty : jpyLineTotal
      cur!.items.push({
        name: product,
        qty,
        jpy: jpy || 0,
        twd: twd || 0,
      })
    }
  }
  flush()

  for (const b of blocks) {
    if (!b.customerName.trim()) {
      warnings.push(`訂單 ${b.orderId || '（無 ID）'}：缺少客戶名字，已略過`)
    }
  }

  const valid = blocks.filter((b) => b.customerName.trim() && b.items.length)
  return { blocks: valid, warnings, sheetName: '', failed: blocks.length - valid.length }
}

export function parseV50ImportWorkbook(
  ab: ArrayBuffer,
  targetGroupName: string,
): V50ImportParseResult {
  const wb = XLSX.read(ab, { type: 'array' })
  const sheetNames = wb.SheetNames || []
  if (!sheetNames.length) return { blocks: [], warnings: ['檔案內沒有工作表'], sheetName: '' }

  const targetNorm = norm(targetGroupName)
  let sheetName =
    sheetNames.find((n) => norm(n) === targetNorm) ??
    sheetNames.find((n) => norm(n).includes(targetNorm) || targetNorm.includes(norm(n))) ??
    sheetNames[0]

  const ws = wb.Sheets[sheetName]
  if (!ws) return { blocks: [], warnings: ['無法讀取工作表'], sheetName }

  const rows = sheetToRowRecords(ws)
  const parsed = parseRowsToBlocks(rows)
  parsed.sheetName = sheetName
  if (sheetNames.length > 1 && norm(sheetName) !== targetNorm) {
    parsed.warnings.unshift(
      `未找到與「${targetGroupName}」同名的工作表，已使用「${sheetName}」分頁`,
    )
  }
  return parsed
}

function finalizeImportedOrder(
  existing: GroupBuyOrder | null,
  block: V50ImportBlock,
  newId: () => string,
): GroupBuyOrder | null {
  if (!block.customerName.trim() || !block.items.length) return null

  const items = block.items
  const domesticShip = block.domesticShip
  const intlShip = block.intlShip
  const totalTwd = calcItemsTotalTwd(items)
  const paymentStatus = block.paymentStatus.trim() || existing?.paymentStatus || '未付款'
  const paymentInfo =
    block.paymentNote != null && block.paymentNote.trim() !== ''
      ? block.paymentNote.trim()
      : (existing?.paymentInfo ?? '')

  let deposit: number
  if (paymentStatus === '貨到付款') deposit = 0
  else if (block.deposit != null) deposit = Math.max(0, block.deposit)
  else if (paymentStatus === '已付款') deposit = totalTwd
  else if (paymentStatus === '已付訂金' && existing) {
    const prev = Number(existing.deposit) || 0
    deposit = prev > 0 ? Math.min(prev, totalTwd) : suggestDeposit(totalTwd)
  } else deposit = suggestDeposit(totalTwd)

  return {
    id: existing?.id ?? (block.orderId.trim() || newId()),
    customerName: block.customerName.trim() || existing?.customerName || '',
    items,
    totalTwd,
    deposit,
    domesticShip,
    intlShip,
    balance: calcOrderBalance(totalTwd, deposit, domesticShip, intlShip),
    paymentStatus,
    paymentInfo,
  }
}

export type V50ImportApplyResult = {
  updated: number
  added: number
  skipped: number
  warnings: string[]
  orders: GroupBuyOrder[]
}

export function applyV50ImportToGroup(
  group: GroupBuyGroup,
  blocks: V50ImportBlock[],
  newId: () => string,
): V50ImportApplyResult {
  const warnings: string[] = []
  let updated = 0
  let added = 0
  let skipped = 0

  const orders = [...(group.orders || [])]
  const byId = new Map(orders.map((o) => [o.id, o]))
  const byName = new Map<string, GroupBuyOrder[]>()
  for (const o of orders) {
    const key = norm(o.customerName)
    const list = byName.get(key) ?? []
    list.push(o)
    byName.set(key, list)
  }

  for (const block of blocks) {
    let existing: GroupBuyOrder | null = null
    const oid = block.orderId.trim()
    if (oid && byId.has(oid)) existing = byId.get(oid)!
    else {
      const key = norm(block.customerName)
      const hits = byName.get(key)
      if (hits?.length === 1) existing = hits[0]
      else if (hits && hits.length > 1) {
        warnings.push(
          `「${block.customerName}」有多筆客訂，請在 Excel 填寫訂單ID 以指定要更新的訂單`,
        )
        skipped += 1
        continue
      }
    }

    const saved = finalizeImportedOrder(existing, block, newId)
    if (!saved) {
      skipped += 1
      continue
    }

    if (existing) {
      const idx = orders.findIndex((o) => o.id === existing!.id)
      if (idx >= 0) orders[idx] = saved
      updated += 1
    } else {
      orders.unshift(saved)
      byId.set(saved.id, saved)
      const key = norm(saved.customerName)
      const list = byName.get(key) ?? []
      list.push(saved)
      byName.set(key, list)
      added += 1
    }
  }

  return { updated, added, skipped, warnings, orders }
}

export type V50GroupImportPlan = {
  groupId: string
  groupName: string
  sheetName: string
  added: number
  updated: number
  failed: number
  warnings: string[]
  orders: GroupBuyOrder[]
  groupPatch?: Partial<GroupBuyGroup>
  /** 系統裡還沒有這個團，確認後會新建 */
  createGroup?: boolean
}

function parseGroupInfoBoolean(value: string): boolean | undefined {
  const normalized = norm(value)
  if (!normalized) return undefined
  if (['是', 'true', '1', 'yes'].includes(normalized)) return true
  if (['否', 'false', '0', 'no'].includes(normalized)) return false
  return undefined
}

function parseGroupInfoRow(ws: XLSX.WorkSheet): Partial<GroupBuyGroup> | null {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  const headerIndex = aoa.findIndex((line) => {
    const cells = (line || []).map((c) => norm(String(c ?? '')))
    return cells.some((c) => c === '團務名稱' || c === '團務id' || c === '結單日')
  })
  if (headerIndex < 0) return null
  const headers = (aoa[headerIndex] || []).map((c) => String(c ?? '').trim())
  const values = aoa[headerIndex + 1] || []
  const cellOf = (...aliases: string[]) => {
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => norm(h) === norm(alias))
      if (idx >= 0) return { found: true, value: String(values[idx] ?? '').trim() }
    }
    return { found: false, value: '' }
  }
  const name = cellOf('團務名稱').value
  const statusText = cellOf('團務狀態', '狀態').value
  const patch: Partial<GroupBuyGroup> = {}
  if (name) patch.name = name
  if (statusText) patch.status = normalizeGroupStatus(statusText)
  const textFields: Array<[string[], keyof GroupBuyGroup]> = [
    [['結單日', '結單日期'], 'closingDate'],
    [['結束販賣日'], 'saleEndDate'],
    [['購買日', '購買日期'], 'purchaseDate'],
    [['官方出貨日'], 'officialShipDate'],
    [['信用卡資訊'], 'creditCard'],
    [['網站連結'], 'purchaseLink'],
    [['團務說明', '開團說明'], 'description'],
    [['備註'], 'remarks'],
    [['訂單編號（舊版團務欄位）', '訂單編號'], 'orderId'],
    [['物流編號（舊版團務欄位）', '物流編號'], 'logisticsId'],
    [['缺貨待補備註'], 'stockAlertNote'],
  ]
  for (const [aliases, key] of textFields) {
    const cell = cellOf(...aliases)
    if (cell.found) (patch as Record<string, unknown>)[key] = cell.value
  }
  const budget = cellOf('日幣預算總額')
  if (budget.found) patch.jpyAmount = budget.value
  const channel = cellOf('開團渠道')
  if (channel.found && (channel.value === '通販' || channel.value === '場販' || channel.value === '')) {
    patch.channel = channel.value as GroupBuyGroup['channel']
  }
  const publicListed = cellOf('開團專區公開')
  const publicListedValue = parseGroupInfoBoolean(publicListed.value)
  if (publicListed.found && publicListedValue !== undefined) patch.portalListed = publicListedValue
  const opsActive = cellOf('團務管理顯示')
  const opsActiveValue = parseGroupInfoBoolean(opsActive.value)
  if (opsActive.found && opsActiveValue !== undefined) patch.opsActive = opsActiveValue
  const stockAlert = cellOf('缺貨待補')
  const stockAlertValue = parseGroupInfoBoolean(stockAlert.value)
  if (stockAlert.found && stockAlertValue !== undefined) patch.stockAlert = stockAlertValue
  return Object.keys(patch).length ? patch : null
}

export type V50WorkbookImportPreview = {
  plans: V50GroupImportPlan[]
  addable: number
  updatable: number
  failed: number
  warnings: string[]
}

function exactImportGroup(name: string, groups: GroupBuyGroup[]): GroupBuyGroup | undefined {
  const key = norm(name)
  if (!key) return undefined
  return groups.find((g) => norm(g.name) === key)
}

function matchImportGroup(sheetName: string, groups: GroupBuyGroup[]): GroupBuyGroup | undefined {
  const key = norm(sheetName)
  return (
    exactImportGroup(sheetName, groups) ??
    groups.find((g) => {
      const n = norm(g.name)
      return n.length >= 2 && (key.includes(n) || n.includes(key))
    })
  )
}

export function materializeImportedGroup(plan: {
  groupId: string
  orders: GroupBuyOrder[]
  groupPatch?: Partial<GroupBuyGroup>
}): GroupBuyGroup {
  const patch = plan.groupPatch || {}
  return {
    id: plan.groupId,
    name: String(patch.name || '').trim() || '未命名團務',
    status: normalizeGroupStatus(String(patch.status || '已登記')),
    channel: patch.channel === '場販' ? '場販' : '通販',
    opsActive: patch.opsActive !== false,
    portalListed: patch.portalListed !== false,
    closingDate: String(patch.closingDate || ''),
    saleEndDate: String(patch.saleEndDate || ''),
    officialShipDate: String(patch.officialShipDate || ''),
    purchaseDate: String(patch.purchaseDate || ''),
    creditCard: String(patch.creditCard || ''),
    jpyAmount: patch.jpyAmount ?? '',
    orderId: String(patch.orderId || ''),
    logisticsId: String(patch.logisticsId || ''),
    purchaseLink: String(patch.purchaseLink || ''),
    description: String(patch.description || ''),
    remarks: String(patch.remarks || ''),
    stockAlert: patch.stockAlert === true,
    stockAlertNote: String(patch.stockAlertNote || ''),
    orders: plan.orders || [],
  }
}

/** 依工作表名稱對應團務，先試算可新增／可更新／失敗，不寫入資料 */
export function previewV50WorkbookImport(
  ab: ArrayBuffer,
  groups: GroupBuyGroup[],
): V50WorkbookImportPreview {
  const wb = XLSX.read(ab, { type: 'array' })
  const sheetNames = (wb.SheetNames || []).filter((n) => norm(n) !== '說明')
  const warnings: string[] = []
  const plans: V50GroupImportPlan[] = []
  let seq = 0
  const newId = () => `o_${Date.now().toString(36)}_${(seq += 1).toString(16)}`

  const dataSheets = sheetNames.filter((n) => wb.Sheets[n])
  const loneGroup = groups.length === 1 ? groups[0] : undefined

  for (const sheetName of dataSheets) {
    const ws = wb.Sheets[sheetName]
    const parsed = parseRowsToBlocks(sheetToRowRecords(ws))
    const groupPatch = parseGroupInfoRow(ws) || undefined
    const patchName = String(groupPatch?.name || '').trim()
    let group =
      exactImportGroup(sheetName, groups) ??
      (patchName ? exactImportGroup(patchName, groups) : undefined)
    if (!group && !patchName && loneGroup && dataSheets.length === 1) {
      group = loneGroup
      warnings.push(`工作表「${sheetName}」未與團名相同，將匯入唯一團務「${group.name}」`)
    }
    if (!group && !groupPatch) group = matchImportGroup(sheetName, groups)
    const rowFailed = parsed.failed || 0
    if (!group && groupPatch) {
      const createdId = `g_imp_${Date.now().toString(36)}_${(seq += 1).toString(16)}`
      const shell = materializeImportedGroup({
        groupId: createdId,
        orders: [],
        groupPatch: { ...groupPatch, name: patchName || sheetName },
      })
      const applied = applyV50ImportToGroup(shell, parsed.blocks, newId)
      plans.push({
        groupId: createdId,
        groupName: shell.name,
        sheetName,
        added: applied.added,
        updated: 0,
        failed: rowFailed + applied.skipped,
        warnings: [...parsed.warnings, ...applied.warnings],
        orders: applied.orders,
        groupPatch: { ...groupPatch, name: shell.name },
        createGroup: true,
      })
      warnings.push(...parsed.warnings, ...applied.warnings)
      continue
    }
    if (!group) {
      const n = parsed.blocks.length + rowFailed || 1
      warnings.push(`工作表「${sheetName}」找不到同名團務，也沒有開團主檔，${n} 筆失敗`)
      plans.push({
        groupId: '',
        groupName: sheetName,
        sheetName,
        added: 0,
        updated: 0,
        failed: n,
        warnings: [`找不到同名團務，也沒有可新建的開團主檔`],
        orders: [],
      })
      continue
    }
    const applied = applyV50ImportToGroup(group, parsed.blocks, newId)
    plans.push({
      groupId: group.id,
      groupName: group.name,
      sheetName,
      added: applied.added,
      updated: applied.updated,
      failed: rowFailed + applied.skipped,
      warnings: [...parsed.warnings, ...applied.warnings],
      orders: applied.orders,
      groupPatch,
    })
    warnings.push(...parsed.warnings, ...applied.warnings)
  }

  if (!dataSheets.length) warnings.push('檔案內沒有可匯入的工作表')

  return {
    plans,
    addable: plans.reduce((s, p) => s + p.added, 0),
    updatable: plans.reduce((s, p) => s + p.updated, 0),
    failed: plans.reduce((s, p) => s + p.failed, 0),
    warnings,
  }
}
