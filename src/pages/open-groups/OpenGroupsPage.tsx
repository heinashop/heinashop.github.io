import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { GroupBuyAppData, GroupBuyGroup, GroupBuySavePayload, PublicGroupCatalogItem } from '../../api/types'
import { getAdminToken, isAdminSessionValid } from '../../auth/adminSession'
import { hasRemoteGas } from '../../config/gasEndpoint'
import { useApi } from '../../context/useApi'
import { useDaigouStore } from '../../daigou/store'
import { normalizeGroupChannel } from '../../modules/groupbuy/groupBuyHubAnalytics'
import { localTodayIso } from '../../modules/groupbuy/v50Utils'
import { OpenGroupCard } from './OpenGroupCard'
import {
  classifyOpenGroupTab,
  matchesOpenGroupChannel,
  matchesOpenGroupSearch,
  OPEN_GROUP_CHANNELS,
  OPEN_GROUP_SORT_OPTIONS,
  OPEN_GROUP_TABS,
  OPEN_GROUPS_PAGE_SIZE,
  parseChannelQuery,
  sortOpenGroupsBy,
  type OpenGroupChannelFilter,
  type OpenGroupSortKey,
  type OpenGroupTab,
} from './openGroupsUtils'
import { HOME_OPEN_GROUP_PIN_LIMIT } from '../customer-portal/mergePortal'
import './open-groups.css'

type Props = {
  embedded?: boolean
  /** public＝客人開團專區（預設）；admin＝後台開團專區管理 */
  variant?: 'public' | 'admin'
}

export function OpenGroupsPage({ embedded = false, variant = 'public' }: Props) {
  const api = useApi()
  const navigate = useNavigate()
  const authEnabled = useDaigouStore((s) => s.settings.adminAuthEnabled !== false)
  const staffOk = hasRemoteGas()
    ? isAdminSessionValid() && Boolean(getAdminToken())
    : authEnabled
      ? isAdminSessionValid()
      : true
  const canEdit = variant === 'admin' && staffOk
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('group')?.trim() || ''

  const [groups, setGroups] = useState<PublicGroupCatalogItem[]>([])
  const [homePins, setHomePins] = useState<string[]>([])
  const [pinMsg, setPinMsg] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState<OpenGroupChannelFilter>(() =>
    parseChannelQuery(searchParams.get('channel')),
  )
  const [statusTab, setStatusTab] = useState<OpenGroupTab | '全部進度'>('全部進度')
  const [sortKey, setSortKey] = useState<OpenGroupSortKey>('default')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.call<{ groups: PublicGroupCatalogItem[]; homeOpenGroupIds?: string[] }>({
        module: 'groupbuy',
        action: 'listPublicGroups',
      })
      setGroups(data.groups || [])
      setHomePins(
        (data.homeOpenGroupIds || [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
          .slice(0, HOME_OPEN_GROUP_PIN_LIMIT),
      )
    } catch (e) {
      console.error(e)
      setError('讀取開團資料失敗，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }, [api])

  async function toggleHomePin(groupId: string) {
    if (!canEdit) return
    const next = homePins.includes(groupId)
      ? homePins.filter((id) => id !== groupId)
      : homePins.length >= HOME_OPEN_GROUP_PIN_LIMIT
        ? homePins
        : [...homePins, groupId]
    if (!homePins.includes(groupId) && homePins.length >= HOME_OPEN_GROUP_PIN_LIMIT) {
      setPinMsg(`顧客首頁最多釘選 ${HOME_OPEN_GROUP_PIN_LIMIT} 團，請先取消其中一團`)
      return
    }
    setPinSaving(true)
    setPinMsg('')
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      const payload: GroupBuySavePayload = {
        groups: data.groups || [],
        bankJournal: data.bankJournal || [],
        exchangeRate: data.exchangeRate ?? 0.22,
        portalConfig: {
          ...(data.portalConfig || {
            title: '',
            intro: '',
            websiteUrl: '',
            groupUrl: '',
            extraNote: '',
          }),
          homeOpenGroupIds: next,
        },
        paymentReports: data.paymentReports,
      }
      await api.call({ module: 'groupbuy', action: 'saveAppData', payload })
      setHomePins(next)
      setPinMsg(
        next.length
          ? `已更新首頁釘選（${next.length}/${HOME_OPEN_GROUP_PIN_LIMIT}）`
          : '已清除首頁釘選',
      )
    } catch (e) {
      console.error(e)
      setPinMsg('釘選儲存失敗，請稍後再試')
    } finally {
      setPinSaving(false)
      window.setTimeout(() => setPinMsg(''), 2400)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setChannel(parseChannelQuery(searchParams.get('channel')))
  }, [searchParams])

  useEffect(() => {
    if (!highlightId || !groups.length) return
    const g = groups.find((x) => x.id === highlightId)
    if (!g) return
    const ch = normalizeGroupChannel(g.channel)
    if (ch) setChannel(ch)
  }, [highlightId, groups])

  useEffect(() => {
    setPage(1)
  }, [search, channel, statusTab, sortKey])

  useEffect(() => {
    if (!highlightId || loading) return
    const el = document.getElementById(`og-${highlightId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, loading, groups, channel])

  function selectChannel(next: OpenGroupChannelFilter) {
    setChannel(next)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === '全部') p.delete('channel')
        else p.set('channel', next)
        return p
      },
      { replace: true },
    )
  }

  async function createPreviewListing() {
    if (!canEdit || creating) return
    const name = window.prompt('開團預告名稱（客人會看到）')
    if (!name?.trim()) return
    const pickChannel =
      channel === '場販' || channel === '通販'
        ? channel
        : window.confirm('要標成「場販」嗎？（取消＝通販）')
          ? '場販'
          : '通販'
    setCreating(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      const today = localTodayIso()
      const id = `g_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
      const ng: GroupBuyGroup = {
        id,
        name: name.trim(),
        status: '已登記',
        channel: pickChannel,
        opsActive: false,
        portalListed: true,
        closingDate: today,
        saleEndDate: today,
        officialShipDate: '',
        purchaseDate: '',
        creditCard: '',
        jpyAmount: 0,
        purchaseCosts: [],
        orderId: '',
        logisticsId: '',
        purchaseLink: '',
        description: '',
        imageUrls: [],
        coverImageUrl: '',
        remarks: '',
        orders: [],
      }
      const payload: GroupBuySavePayload = {
        groups: [ng, ...(data.groups || [])],
        bankJournal: data.bankJournal || [],
        exchangeRate: data.exchangeRate ?? 0.22,
        portalConfig: data.portalConfig,
      }
      await api.call({ module: 'groupbuy', action: 'saveAppData', payload })
      navigate(`/open-groups/${encodeURIComponent(id)}?manage=1&edit=1`)
    } catch (e) {
      console.error(e)
      window.alert('建立開團預告失敗')
    } finally {
      setCreating(false)
    }
  }

  const channelCounts = useMemo(() => {
    const counts: Record<OpenGroupChannelFilter, number> = { 全部: 0, 場販: 0, 通販: 0 }
    for (const g of groups) {
      if (!matchesOpenGroupSearch(g, search)) continue
      if (statusTab !== '全部進度' && classifyOpenGroupTab(g.status, g.closingDate) !== statusTab) continue
      counts.全部 += 1
      const ch = normalizeGroupChannel(g.channel)
      if (ch === '場販') counts.場販 += 1
      if (ch === '通販') counts.通販 += 1
    }
    return counts
  }, [groups, search, statusTab])

  const filtered = useMemo(() => {
    const rows = groups
      .filter((g) => matchesOpenGroupChannel(g, channel))
      .filter((g) => (statusTab === '全部進度' ? true : classifyOpenGroupTab(g.status, g.closingDate) === statusTab))
      .filter((g) => matchesOpenGroupSearch(g, search))
    return sortOpenGroupsBy(rows, sortKey)
  }, [groups, channel, statusTab, search, sortKey])

  const totalPages = Math.max(1, Math.ceil(filtered.length / OPEN_GROUPS_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * OPEN_GROUPS_PAGE_SIZE, safePage * OPEN_GROUPS_PAGE_SIZE)

  const channelTitle =
    channel === '全部' ? '全部開團' : channel === '場販' ? '場販開團' : '通販開團'

  return (
    <div className={'og' + (embedded ? ' og--embedded' : '')}>
      <header className="og-header">
        <div className="og-header-inner">
          {!embedded ? (
            <Link to="/lookup" className="og-header-link og-header-link--back">
              ← 訂單查詢
            </Link>
          ) : null}
          <div className="og-header-text">
            <p className="og-eyebrow">Heina Shop</p>
            <h1 className="og-title">{canEdit ? '開團專區' : '開團專區(場販+通販)'}</h1>
            {!canEdit ? (
              <p className="og-lead">
                這裡可一目瞭然查看開團資訊；喊單請前往記事本留言，也可用關鍵字搜尋團務。
              </p>
            ) : null}
          </div>
          {canEdit ? (
            <div className="og-header-actions">
              <button
                type="button"
                className="og-header-link og-header-link--solid"
                disabled={creating}
                onClick={() => void createPreviewListing()}
              >
                {creating ? '建立中…' : '＋ 新增開團預告'}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="og-main">
        <div className="og-channel-hero" role="tablist" aria-label="場販或通販">
          {OPEN_GROUP_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              role="tab"
              aria-selected={channel === ch}
              className={
                'og-channel-pill' +
                (channel === ch ? ' og-channel-pill--active' : '') +
                (ch === '全部' ? ' og-channel-pill--all' : '') +
                (ch === '場販' ? ' og-channel-pill--venue' : '') +
                (ch === '通販' ? ' og-channel-pill--mail' : '')
              }
              onClick={() => selectChannel(ch)}
            >
              <span className="og-channel-pill-label">{ch === '全部' ? '全部' : ch}</span>
              <span className="og-channel-pill-count">{channelCounts[ch]}</span>
              {ch === '場販' ? <span className="og-channel-pill-hint">現場／店舖採購</span> : null}
              {ch === '通販' ? <span className="og-channel-pill-hint">網路下單採購</span> : null}
            </button>
          ))}
        </div>

        <div className="og-toolbar">
          <input
            className="og-search"
            placeholder="搜尋團名、說明、備註…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜尋開團"
          />
          <div className="og-tabs og-tabs--status" role="tablist" aria-label="開團進度">
            <button
              type="button"
              role="tab"
              aria-selected={statusTab === '全部進度'}
              className={'og-tab' + (statusTab === '全部進度' ? ' og-tab--active' : '')}
              onClick={() => setStatusTab('全部進度')}
            >
              全部進度
            </button>
            {OPEN_GROUP_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={statusTab === t}
                className={'og-tab' + (statusTab === t ? ' og-tab--active' : '')}
                onClick={() => setStatusTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="og-sort-row" role="group" aria-label="排序方式">
          <span className="og-sort-label">排序</span>
          <div className="og-sort-pills">
            {OPEN_GROUP_SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={'og-sort-pill' + (sortKey === opt.key ? ' is-active' : '')}
                aria-pressed={sortKey === opt.key}
                onClick={() => setSortKey(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <p className="og-section-caption" aria-live="polite">
          正在瀏覽：<strong>{channelTitle}</strong>
          {filtered.length ? ` · ${filtered.length} 團` : null}
        </p>

        {canEdit && (pinMsg || pinSaving) ? (
          <p className="og-pin-banner-msg" role="status">
            {pinSaving ? '儲存中…' : pinMsg}
          </p>
        ) : null}

        {loading ? <p className="og-state">載入中…</p> : null}
        {error ? (
          <p className="og-state og-state--error" role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error && pageItems.length === 0 ? (
          <p className="og-state">
            {channel === '全部'
              ? '目前沒有符合的開團。'
              : `目前沒有「${channel}」開團${statusTab !== '全部進度' ? `（${statusTab}）` : ''}。`}
            {canEdit && channel !== '全部' ? (
              <span className="og-state-hint"> 可在開團小卡編輯裡設定場販／通販。</span>
            ) : null}
          </p>
        ) : null}

        {!loading && !error && pageItems.length > 0 ? (
          <>
            <div className="og-grid">
              {pageItems.map((g) => (
                <OpenGroupCard
                  key={g.id}
                  group={g}
                  highlighted={highlightId === g.id}
                  showEditAction={canEdit}
                  pinned={homePins.includes(g.id)}
                  pinDisabled={pinSaving || (homePins.length >= HOME_OPEN_GROUP_PIN_LIMIT && !homePins.includes(g.id))}
                  onTogglePin={canEdit ? () => void toggleHomePin(g.id) : undefined}
                />
              ))}
            </div>
            {totalPages > 1 ? (
              <nav className="og-pager" aria-label="分頁">
                <button
                  type="button"
                  className="og-pager-btn"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一頁
                </button>
                <span className="og-pager-info">
                  第 {safePage} / {totalPages} 頁 · 共 {filtered.length} 團
                </span>
                <button
                  type="button"
                  className="og-pager-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一頁
                </button>
              </nav>
            ) : null}
          </>
        ) : null}
      </main>

      {!embedded ? (
        <footer className="og-footer">
          <Link to="/lookup" className="og-footer-link">
            查詢我的訂單
          </Link>
        </footer>
      ) : null}
    </div>
  )
}
