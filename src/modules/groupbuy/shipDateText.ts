export type ShipDateText = {
  raw: string
  year: number | null
  month: number | null
  day: number | null
  /** 1 上旬、2 中旬、3 下旬；0 沒有旬別 */
  part: 0 | 1 | 2 | 3
  unset: boolean
}

const CN_MONTH: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
}

function toAsciiDate(raw: string): string {
  return raw
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/／/g, '/')
    .replace(/[．。]/g, '.')
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '')
}

function partOf(s: string): 0 | 1 | 2 | 3 {
  if (/上旬|月初|上半月/.test(s)) return 1
  if (/中旬|月中/.test(s)) return 2
  if (/下旬|月底|月末|下半月/.test(s)) return 3
  return 0
}

/** 官方出貨日是文字。認 2026/10、2027/02月、2026-10-15、2026年10月、11月下旬。 */
export function parseShipDateText(value: string | number | undefined | null): ShipDateText {
  const raw = String(value ?? '').trim()
  const s = toAsciiDate(raw)
  if (!s || /未定|待定|不明|tbd|n\/a/i.test(s)) {
    return { raw, year: null, month: null, day: null, part: 0, unset: true }
  }
  const part = partOf(s)
  const ymd = s.match(/(\d{4})[./\-年](\d{1,2})(?:[./\-月](\d{1,2}))?/)
  if (ymd) {
    const month = Number(ymd[2])
    const day = ymd[3] ? Number(ymd[3]) : null
    if (month >= 1 && month <= 12 && (day == null || (day >= 1 && day <= 31))) {
      return { raw, year: Number(ymd[1]), month, day, part, unset: false }
    }
  }
  const numMonth = s.match(/(\d{1,2})月/)
  if (numMonth) {
    const month = Number(numMonth[1])
    if (month >= 1 && month <= 12) {
      return { raw, year: null, month, day: null, part, unset: false }
    }
  }
  const cnMonth = s.match(/(十二|十一|十|[一二三四五六七八九])月/)
  if (cnMonth) {
    const month = CN_MONTH[cnMonth[1]]
    if (month) return { raw, year: null, month, day: null, part, unset: false }
  }
  return { raw, year: null, month: null, day: null, part: 0, unset: true }
}

export function officialShipSortKey(value: string | number | undefined | null): number {
  const parsed = parseShipDateText(value)
  if (parsed.unset || parsed.month == null) return Number.POSITIVE_INFINITY
  const year = parsed.year ?? 9998
  const day = parsed.day ?? (parsed.part === 1 ? 5 : parsed.part === 2 ? 15 : parsed.part === 3 ? 25 : 0)
  return year * 10000 + parsed.month * 100 + day
}

export function compareOfficialShipDate(
  a: string | number | undefined | null,
  b: string | number | undefined | null,
): number {
  const ka = officialShipSortKey(a)
  const kb = officialShipSortKey(b)
  const aOpen = !Number.isFinite(ka)
  const bOpen = !Number.isFinite(kb)
  if (aOpen && bOpen) return 0
  if (aOpen) return 1
  if (bOpen) return -1
  return ka - kb
}

export function officialShipBucketLabel(value: string | number | undefined | null): string {
  const parsed = parseShipDateText(value)
  if (parsed.unset || parsed.month == null) return '未填或未定'
  if (parsed.year == null) return `${parsed.month}月（未寫年份）`
  return `${parsed.year}年${parsed.month}月`
}
