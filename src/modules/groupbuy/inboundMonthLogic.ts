import type { GroupBuyGroup } from '../../api/types'
import { isInGroupOps } from './groupLifecycle'
import { compareOfficialShipDate, parseShipDateText } from './shipDateText'
import { normalizeGroupStatus, type V50GroupStatus } from './v50Utils'

export type YearMonth = { year: number; month: number }

export type OfficialShipParse = {
  raw: string
  year: number | null
  month: number | null
  kind: 'exact' | 'month-only' | 'unset'
}

export type InboundBucket = 'expected' | 'inWarehouse' | 'leftWarehouse'

export type InboundMonthLists = {
  expected: GroupBuyGroup[]
  inWarehouse: GroupBuyGroup[]
  leftWarehouse: GroupBuyGroup[]
  overdue: GroupBuyGroup[]
  unset: GroupBuyGroup[]
}

export function ymFromDate(d = new Date()): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function shiftYearMonth(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function formatYearMonthLabel(ym: YearMonth): string {
  return `${ym.year}年${ym.month}月`
}

export function yearMonthKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`
}

export function parseYearMonthKey(raw: string | null | undefined): YearMonth | null {
  const m = String(raw || '').trim().match(/^(\d{4})-(\d{1,2})$/)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year: Number(m[1]), month }
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month
}

export function parseOfficialShipMonth(raw: string | undefined): OfficialShipParse {
  const parsed = parseShipDateText(raw)
  if (parsed.unset || parsed.month == null) {
    return { raw: parsed.raw, year: null, month: null, kind: 'unset' }
  }
  return {
    raw: parsed.raw,
    year: parsed.year,
    month: parsed.month,
    kind: parsed.year == null ? 'month-only' : 'exact',
  }
}

export function matchesOfficialShipMonth(parsed: OfficialShipParse, ym: YearMonth): boolean {
  if (parsed.kind === 'unset' || parsed.month == null) return false
  if (parsed.month !== ym.month) return false
  if (parsed.year == null) return true
  return parsed.year === ym.year
}

export function inboundBucket(status?: string): InboundBucket {
  const s: V50GroupStatus = normalizeGroupStatus(status)
  if (s === '已集運') return 'inWarehouse'
  if (s === '已抵台' || s === '已結束') return 'leftWarehouse'
  return 'expected'
}

function resolvedShipYm(parsed: OfficialShipParse, fallbackYear: number): YearMonth | null {
  if (parsed.month == null) return null
  return { year: parsed.year ?? fallbackYear, month: parsed.month }
}

function sortByShipThenName(a: GroupBuyGroup, b: GroupBuyGroup): number {
  const byDate = compareOfficialShipDate(a.officialShipDate, b.officialShipDate)
  if (byDate !== 0) return byDate
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant')
}

/** 官方出貨月＝該月：預計進日本倉／已在倉／已離倉；本月另外列出逾期未進倉與未填出貨月 */
export function listInboundForMonth(
  groups: GroupBuyGroup[],
  ym: YearMonth,
  todayYm = ymFromDate(),
): InboundMonthLists {
  const lists: InboundMonthLists = {
    expected: [],
    inWarehouse: [],
    leftWarehouse: [],
    overdue: [],
    unset: [],
  }
  const viewingCurrent = compareYearMonth(ym, todayYm) === 0

  for (const group of groups) {
    if (!isInGroupOps(group)) continue
    const parsed = parseOfficialShipMonth(group.officialShipDate)
    const bucket = inboundBucket(group.status)

    if (parsed.kind === 'unset') {
      if (viewingCurrent) lists.unset.push(group)
      continue
    }

    if (matchesOfficialShipMonth(parsed, ym)) {
      lists[bucket].push(group)
      continue
    }

    if (viewingCurrent && bucket === 'expected') {
      const shipYm = resolvedShipYm(parsed, todayYm.year)
      if (shipYm && compareYearMonth(shipYm, todayYm) < 0) lists.overdue.push(group)
    }
  }

  lists.expected.sort(sortByShipThenName)
  lists.inWarehouse.sort(sortByShipThenName)
  lists.leftWarehouse.sort(sortByShipThenName)
  lists.overdue.sort(sortByShipThenName)
  lists.unset.sort(sortByShipThenName)
  return lists
}

export function countExpectedInboundThisMonth(groups: GroupBuyGroup[], todayYm = ymFromDate()): number {
  const lists = listInboundForMonth(groups, todayYm, todayYm)
  return lists.expected.length + lists.overdue.length
}
