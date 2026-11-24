import type { GroupBuyChannel, GroupBuyGroup, PublicGroupCatalogItem } from '../../api/types'
import { normalizeGroupChannel } from '../../modules/groupbuy/groupBuyHubAnalytics'
import { isPortalListed } from '../../modules/groupbuy/groupLifecycle'
import { compareOfficialShipDate } from '../../modules/groupbuy/shipDateText'
import { daysUntil, localTodayIso, normalizeGroupStatus } from '../../modules/groupbuy/v50Utils'
import { normalizeGroupImageUrls, primaryGroupImageUrl, openGroupDetailHref } from './openGroupImages'

/** 客人主分類：場販／通販 */
export const OPEN_GROUP_CHANNELS = ['全部', '場販', '通販'] as const
export type OpenGroupChannelFilter = (typeof OPEN_GROUP_CHANNELS)[number]

/** 次要進度篩選 */
export const OPEN_GROUP_TABS = ['未結單', '已結單', '已結束'] as const
export type OpenGroupTab = (typeof OPEN_GROUP_TABS)[number]

export const OPEN_GROUPS_PAGE_SIZE = 12

export function classifyOpenGroupTab(
  status?: string,
  closingDate?: string,
  today = localTodayIso(),
): OpenGroupTab {
  const s = normalizeGroupStatus(status)
  if (s === '已結束') return '已結束'
  if (s === '已下單') return '已結單'
  // 已過結單日 → 視為已結單（尚未標記已結束者）
  const left = closingDate ? daysUntil(closingDate, today) : null
  if (left !== null && left < 0) return '已結單'
  return '未結單'
}

export function matchesOpenGroupChannel(
  group: Pick<PublicGroupCatalogItem, 'channel'>,
  filter: OpenGroupChannelFilter,
): boolean {
  if (filter === '全部') return true
  return normalizeGroupChannel(group.channel) === filter
}

export function openGroupHref(
  groupId: string,
  fromLookupQuery?: string,
  fromLookupOrderId?: string,
): string {
  return openGroupDetailHref(groupId, {
    fromLookupQuery: fromLookupQuery || undefined,
    fromLookupOrderId: fromLookupOrderId || undefined,
  })
}

export function openGroupsListHref(channel?: OpenGroupChannelFilter): string {
  if (!channel || channel === '全部') return '/open-groups'
  return `/open-groups?channel=${encodeURIComponent(channel)}`
}

/** 團務管理對應團（同一 group id） */
export function groupOpsHref(groupId: string): string {
  return `/groups?group=${encodeURIComponent(groupId)}`
}

/** 後台開團專區對應團 */
export function openGroupManageHref(groupId: string): string {
  return `${openGroupDetailHref(groupId)}?manage=1`
}

export function mapGroupToCatalogItem(g: GroupBuyGroup): PublicGroupCatalogItem {
  const imageUrls = normalizeGroupImageUrls(g.imageUrls, g.coverImageUrl)
  return {
    id: g.id,
    name: g.name,
    status: normalizeGroupStatus(g.status),
    closingDate: g.closingDate || '',
    officialShipDate: g.officialShipDate || '',
    description: String(g.description || '').trim(),
    coverImageUrl: primaryGroupImageUrl(imageUrls, g.coverImageUrl),
    imageUrls,
    remarks: String(g.remarks || '').trim(),
    channel: normalizeGroupChannel(g.channel),
    opsActive: g.opsActive,
    portalListed: g.portalListed,
  }
}

export function listPortalCatalogGroups(groups: GroupBuyGroup[]): PublicGroupCatalogItem[] {
  return groups.filter(isPortalListed).map(mapGroupToCatalogItem)
}

export function matchesOpenGroupSearch(group: PublicGroupCatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    group.name,
    group.description,
    group.remarks,
    group.status,
    group.closingDate,
    group.officialShipDate,
    group.channel,
  ]
  return fields.some((v) => String(v || '').toLowerCase().includes(q))
}

export function sortOpenGroups(a: PublicGroupCatalogItem, b: PublicGroupCatalogItem): number {
  const channelRank = (ch?: string) => {
    const n = normalizeGroupChannel(ch)
    if (n === '場販') return 0
    if (n === '通販') return 1
    return 2
  }
  const cr = channelRank(a.channel) - channelRank(b.channel)
  if (cr !== 0) return cr
  const da = Date.parse(a.closingDate || '') || 0
  const db = Date.parse(b.closingDate || '') || 0
  if (da !== db) return db - da
  return a.name.localeCompare(b.name, 'zh-Hant')
}

export type OpenGroupSortKey = 'default' | 'closing' | 'officialShip' | 'name'

export const OPEN_GROUP_SORT_OPTIONS: { key: OpenGroupSortKey; label: string }[] = [
  { key: 'default', label: '預設' },
  { key: 'closing', label: '結單日' },
  { key: 'officialShip', label: '官方出貨日' },
  { key: 'name', label: '名字' },
]

function dateSortAsc(raw?: string): number {
  const ms = Date.parse(String(raw || '').trim() || '')
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

export function sortOpenGroupsBy(
  list: PublicGroupCatalogItem[],
  key: OpenGroupSortKey,
): PublicGroupCatalogItem[] {
  const copy = [...list]
  if (key === 'closing') {
    return copy.sort((a, b) => {
      const d = dateSortAsc(a.closingDate) - dateSortAsc(b.closingDate)
      if (d !== 0) return d
      return a.name.localeCompare(b.name, 'zh-Hant')
    })
  }
  if (key === 'officialShip') {
    return copy.sort((a, b) => {
      const d = compareOfficialShipDate(a.officialShipDate, b.officialShipDate)
      if (d !== 0) return d
      return a.name.localeCompare(b.name, 'zh-Hant')
    })
  }
  if (key === 'name') {
    return copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }
  return copy.sort(sortOpenGroups)
}

/** 顧客首頁：近 N 日內即將結單（含今日），依結單日由近到遠 */
export function listClosingSoonPublicGroups(
  groups: PublicGroupCatalogItem[],
  withinDays = 5,
  today = localTodayIso(),
): PublicGroupCatalogItem[] {
  return groups
    .filter((g) => classifyOpenGroupTab(g.status, g.closingDate, today) === '未結單')
    .filter((g) => {
      const left = daysUntil(g.closingDate, today)
      return left !== null && left >= 0 && left <= withinDays
    })
    .sort((a, b) => {
      const da = daysUntil(a.closingDate, today) ?? 999
      const db = daysUntil(b.closingDate, today) ?? 999
      if (da !== db) return da - db
      return a.name.localeCompare(b.name, 'zh-Hant')
    })
}

/** 顧客專區首頁：優先顯示釘選團（含已結單仍公開者），不足再以未結單預設排序補滿 */
export function pickHomeOpenGroupPreview(
  groups: PublicGroupCatalogItem[],
  pinnedIds: string[] | undefined,
  limit = 2,
  today = localTodayIso(),
): PublicGroupCatalogItem[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const openSorted = groups
    .filter((g) => classifyOpenGroupTab(g.status, g.closingDate, today) === '未結單')
    .sort(sortOpenGroups)
  const picked: PublicGroupCatalogItem[] = []
  const seen = new Set<string>()
  for (const id of pinnedIds || []) {
    const g = byId.get(id)
    if (!g || seen.has(g.id)) continue
    picked.push(g)
    seen.add(g.id)
    if (picked.length >= limit) return picked
  }
  for (const g of openSorted) {
    if (seen.has(g.id)) continue
    picked.push(g)
    seen.add(g.id)
    if (picked.length >= limit) return picked
  }
  const rest = groups.filter((g) => !seen.has(g.id)).sort(sortOpenGroups)
  for (const g of rest) {
    picked.push(g)
    seen.add(g.id)
    if (picked.length >= limit) break
  }
  return picked
}

export function parseChannelQuery(raw: string | null): OpenGroupChannelFilter {
  const v = (raw || '').trim()
  if (v === '場販' || v === '通販') return v
  if (v === '市場飯') return '場販'
  return '全部'
}

export type { GroupBuyChannel }
