import * as XLSX from 'xlsx'
import type { BankJournalRow, CustomerPaymentReport } from '../../api/types'
import { formatYmd } from './v50Utils'

export const JOURNAL_XLSX_HEADER = ['日期', '銀行', '金額', '備註', '後五碼', 'ID'] as const

export function newJournalId(prefix = 'j') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
}

export function normalizeLastFive(raw: string | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length >= 5) return digits.slice(-5)
  return digits
}

export function formatLastFiveDisplay(raw: string | undefined): string {
  const d = normalizeLastFive(raw)
  return d ? `#${d}` : '—'
}

export function journalNoteForPayment(customerName: string, groupNames: string[]): string {
  const groups = [...new Set(groupNames.map((s) => String(s || '').trim()).filter(Boolean))].join('、')
  return [String(customerName || '').trim(), groups].filter(Boolean).join(' ')
}

export function displayJournalNote(row: Pick<BankJournalRow, 'note'>): string {
  let note = String(row.note || '').trim()
  note = note.replace(/\s*後五碼\s*\d{5}\s*$/u, '')
  note = note.replace(/\s*#\d{5}\s*$/u, '')
  return note.trim()
}

export function displayJournalLastFive(row: Pick<BankJournalRow, 'note' | 'lastFive'>): string {
  const stored = normalizeLastFive(row.lastFive)
  if (stored) return stored
  const note = String(row.note || '')
  const hash = note.match(/#(\d{5})/)
  if (hash) return hash[1]
  const label = note.match(/後五碼\s*(\d{5})/)
  return label?.[1] || ''
}

/** 日記帳只顯示年月日，例如 2026/11/26。試算表日期常是 2026-11-25T16:00:00.000Z。 */
export function formatJournalDate(value: string | number | undefined | null): string {
  const ymd = formatYmd(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd.replace(/-/g, '/')
  return ymd
}

export type JournalViewRow = BankJournalRow & {
  sourceId: string
  /** 同一筆匯款拆成多個團務時為 true。刪除仍刪試算表上的那一筆。 */
  split: boolean
}

type JournalOrderSlice = {
  customerName?: string
  deposit?: number
  paymentInfo?: string
}

type JournalGroupSlice = {
  name: string
  orders?: JournalOrderSlice[]
}

function roundedAmount(value: number | undefined): number {
  return Math.round(Number(value) || 0)
}

function groupPartsFromReport(report: CustomerPaymentReport): { name: string; amount: number }[] {
  const totals = new Map<string, number>()
  const order: string[] = []
  for (const line of report.lines || []) {
    const name = String(line.groupName || '').trim()
    if (!name) continue
    const base = roundedAmount(line.deposit) - roundedAmount(line.supplementTotal)
    if (base <= 0) continue
    if (!totals.has(name)) order.push(name)
    totals.set(name, (totals.get(name) || 0) + base)
  }
  return order.map((name) => ({ name, amount: totals.get(name) || 0 }))
}

function partsMatchAmount(parts: { amount: number }[], amount: number): boolean {
  if (parts.length < 2) return false
  const sum = parts.reduce((total, part) => total + part.amount, 0)
  return sum === roundedAmount(amount)
}

function reportMatchesJournal(row: BankJournalRow, report: CustomerPaymentReport): boolean {
  if (report.status !== 'confirmed') return false
  if (report.journalEntryId && report.journalEntryId === row.id) return true
  const note = displayJournalNote(row)
  const five = displayJournalLastFive(row)
  const reportFive = normalizeLastFive(report.lastFive)
  if (five && reportFive && five !== reportFive) return false
  const rowDay = formatYmd(row.date)
  const reportDay = formatYmd(report.remittanceDate)
  if (rowDay && reportDay && rowDay !== reportDay) return false
  const customer = String(report.customerName || '').trim()
  if (customer && !note.includes(customer)) return false
  return (report.lines || []).some((line) => {
    const name = String(line.groupName || '').trim()
    return !!name && note.includes(name)
  })
}

function partsFromOrders(row: BankJournalRow, groups: JournalGroupSlice[] | undefined): { customer: string; parts: { name: string; amount: number }[] } | null {
  const note = displayJournalNote(row)
  const five = displayJournalLastFive(row)
  if (!note || !groups?.length) return null
  const names = [...new Set(groups.map((group) => String(group.name || '').trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  let rest = note
  const found: string[] = []
  for (const name of names) {
    if (!rest.includes(name)) continue
    found.push(name)
    rest = rest.split(name).join(' ')
  }
  if (found.length < 2) return null
  const parts: { name: string; amount: number }[] = []
  const customers = new Set<string>()
  for (const name of found) {
    const group = groups.find((item) => String(item.name || '').trim() === name)
    let amount = 0
    for (const order of group?.orders || []) {
      const customer = String(order.customerName || '').trim()
      if (!customer || !note.includes(customer)) continue
      const info = String(order.paymentInfo || '')
      if (five && !info.includes(five)) continue
      const deposit = roundedAmount(order.deposit)
      if (deposit <= 0) continue
      amount += deposit
      customers.add(customer)
    }
    if (amount > 0) parts.push({ name, amount })
  }
  if (!partsMatchAmount(parts, row.amount) || customers.size !== 1) return null
  return { customer: [...customers][0], parts }
}

function viewFromParts(
  row: BankJournalRow,
  customer: string,
  parts: { name: string; amount: number }[],
): JournalViewRow[] {
  return parts.map((part, index) => ({
    ...row,
    id: `${row.id}::${index}`,
    sourceId: row.id,
    split: true,
    amount: part.amount,
    note: [customer, part.name].filter(Boolean).join(' '),
  }))
}

/** 同一筆匯款含多個團務時，依各團金額拆成多列。加總必須等於原金額，否則維持一列。 */
export function journalViewRows(
  rows: BankJournalRow[],
  reports?: CustomerPaymentReport[],
  groups?: JournalGroupSlice[],
): JournalViewRow[] {
  const reportList = reports || []
  return rows.flatMap((row) => {
    const linked = reportList.filter((report) => reportMatchesJournal(row, report))
    const byId = linked.filter((report) => report.journalEntryId === row.id)
    const matched = (byId.length ? byId : linked)
      .map((report) => ({
        customer: String(report.customerName || '').trim(),
        parts: groupPartsFromReport(report),
      }))
      .filter((item) => partsMatchAmount(item.parts, row.amount))
    if (matched.length === 1) return viewFromParts(row, matched[0].customer, matched[0].parts)
    const fromOrders = partsFromOrders(row, groups)
    if (fromOrders) return viewFromParts(row, fromOrders.customer, fromOrders.parts)
    return [{ ...row, sourceId: row.id, split: false }]
  })
}

export function createPaymentJournalRow(params: {
  date: string
  amount: number
  customerName: string
  groupNames: string[]
  lastFive: string
  bank?: string
}): BankJournalRow {
  const lastFive = normalizeLastFive(params.lastFive)
  return {
    id: newJournalId('j_pr'),
    date: String(params.date || '').trim(),
    bank: params.bank || '待分類',
    type: '收入',
    amount: Math.max(0, Math.round(Number(params.amount) || 0)),
    category: '團購訂金',
    note: journalNoteForPayment(params.customerName, params.groupNames),
    lastFive,
  }
}

export function sortJournalNewest(rows: BankJournalRow[]): BankJournalRow[] {
  return [...rows].sort((a, b) => {
    const da = String(a.date || '')
    const db = String(b.date || '')
    if (da !== db) return db.localeCompare(da)
    return String(b.id).localeCompare(String(a.id))
  })
}

export function journalToXlsxBuffer(rows: BankJournalRow[]): Uint8Array {
  const body = sortJournalNewest(rows).map((row) => [
    formatJournalDate(row.date),
    String(row.bank || '').trim() || '待分類',
    Number(row.amount) || 0,
    displayJournalNote(row),
    formatLastFiveDisplay(displayJournalLastFive(row)),
    row.id || '',
  ])
  const aoa = [Array.from(JOURNAL_XLSX_HEADER), ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '日記帳')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

function headerIndex(header: string[], aliases: string[]): number {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const cells = header.map(norm)
  for (const alias of aliases) {
    const i = cells.indexOf(norm(alias))
    if (i >= 0) return i
  }
  return -1
}

export function journalFromXlsxBuffer(buf: ArrayBuffer): BankJournalRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false })
  if (!aoa.length) return []
  const header = (aoa[0] || []).map((c) => String(c || ''))
  const iDate = headerIndex(header, ['日期', 'date'])
  const iAmount = headerIndex(header, ['金額', 'amount'])
  const iNote = headerIndex(header, ['備註', 'note'])
  const iFive = headerIndex(header, ['後五碼', 'lastfive', '#後五碼'])
  const iId = headerIndex(header, ['ID', 'id'])
  const iBank = headerIndex(header, ['銀行', 'bank'])
  const iType = headerIndex(header, ['類型', 'type'])
  const iCat = headerIndex(header, ['分類', 'category'])

  const out: BankJournalRow[] = []
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const date = String(iDate >= 0 ? row[iDate] : row[0] || '').trim()
    const amount = Math.round(Number(String(iAmount >= 0 ? row[iAmount] : row[1] || '').replace(/,/g, '')) || 0)
    const note = String(iNote >= 0 ? row[iNote] : row[2] || '').trim()
    if (!date && !note && !amount) continue
    const lastFive = normalizeLastFive(String(iFive >= 0 ? row[iFive] : ''))
    out.push({
      id: String(iId >= 0 ? row[iId] : '').trim() || newJournalId('j_imp'),
      date,
      bank: String(iBank >= 0 ? row[iBank] : '待分類').trim() || '待分類',
      type: String(iType >= 0 ? row[iType] : '收入').trim() || '收入',
      amount,
      category: String(iCat >= 0 ? row[iCat] : '手動').trim() || '手動',
      note,
      lastFive,
    })
  }
  return out
}

export function mergeJournalById(existing: BankJournalRow[], incoming: BankJournalRow[]): BankJournalRow[] {
  const map = new Map(existing.map((r) => [r.id, r]))
  for (const row of incoming) {
    map.set(row.id, { ...map.get(row.id), ...row })
  }
  return sortJournalNewest([...map.values()])
}

export function upsertJournalRows(existing: BankJournalRow[], incoming: BankJournalRow[]): BankJournalRow[] {
  if (!incoming.length) return sortJournalNewest(existing)
  const map = new Map(existing.map((r) => [r.id, r]))
  const fresh: BankJournalRow[] = []
  for (const row of incoming) {
    if (!row?.id) continue
    if (map.has(row.id)) map.set(row.id, { ...map.get(row.id), ...row })
    else fresh.push(row)
  }
  return sortJournalNewest([...fresh, ...map.values()])
}

export function journalNoteWithLastFive(row: Pick<BankJournalRow, 'note' | 'lastFive'>): string {
  const five = normalizeLastFive(row.lastFive)
  let note = String(row.note || '').trim()
  if (five && !note.includes(`#${five}`) && !note.includes(`後五碼 ${five}`)) {
    note = note ? `${note} #${five}` : `#${five}`
  }
  return note
}

const JOURNAL_UNDO_KEY = 'heina.journal.undo.v1'
const JOURNAL_UNDO_MAX = 5

type JournalUndoSnap = { at: number; rows: BankJournalRow[] }

function readJournalUndo(): JournalUndoSnap[] {
  try {
    const raw = localStorage.getItem(JOURNAL_UNDO_KEY)
    const parsed = raw ? (JSON.parse(raw) as JournalUndoSnap[]) : []
    return Array.isArray(parsed) ? parsed.filter((s) => Array.isArray(s?.rows)) : []
  } catch {
    return []
  }
}

export function pushJournalUndo(rows: BankJournalRow[]) {
  const stack = readJournalUndo()
  stack.unshift({ at: Date.now(), rows: rows.map((r) => ({ ...r })) })
  localStorage.setItem(JOURNAL_UNDO_KEY, JSON.stringify(stack.slice(0, JOURNAL_UNDO_MAX)))
}

export function peekJournalUndo(): JournalUndoSnap | null {
  return readJournalUndo()[0] || null
}

export function popJournalUndo(): BankJournalRow[] | null {
  const stack = readJournalUndo()
  const first = stack.shift()
  localStorage.setItem(JOURNAL_UNDO_KEY, JSON.stringify(stack))
  return first ? first.rows : null
}
