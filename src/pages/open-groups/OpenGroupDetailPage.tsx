import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { GroupBuyAppData, GroupBuyChannel, GroupBuySavePayload, PublicGroupCatalogItem } from '../../api/types'
import { getAdminToken, isAdminSessionValid } from '../../auth/adminSession'
import { hasRemoteGas } from '../../config/gasEndpoint'
import { GroupImageGalleryEditor } from '../../components/groups/GroupImageGalleryEditor'
import { useApi } from '../../context/useApi'
import { useDaigouStore } from '../../daigou/store'
import { isInGroupOps, isMailOrderChannel, isOpsActive } from '../../modules/groupbuy/groupLifecycle'
import { V50_GROUP_STATUSES, formatYmd, normalizeGroupStatus } from '../../modules/groupbuy/v50Utils'
import { normalizeGroupImageUrls, primaryGroupImageUrl } from './openGroupImages'
import { groupOpsHref } from './openGroupsUtils'
import { GroupImageSwipe } from './GroupImageSwipe'
import './open-groups.css'

type Props = {
  embedded?: boolean
}

type PortalEditForm = {
  name: string
  description: string
  imageUrls: string[]
  closingDate: string
  officialShipDate: string
  status: string
  remarks: string
  channel: '' | GroupBuyChannel
}

function dash(v: string | undefined) {
  const s = String(v || '').trim()
  return s || '—'
}

function toEditForm(group: PublicGroupCatalogItem): PortalEditForm {
  const channel: '' | GroupBuyChannel =
    group.channel === '場販' || group.channel === '通販' ? group.channel : ''
  return {
    name: group.name || '',
    description: group.description || '',
    imageUrls: normalizeGroupImageUrls(group.imageUrls, group.coverImageUrl),
    closingDate: formatYmd(group.closingDate),
    officialShipDate: formatYmd(group.officialShipDate),
    status: normalizeGroupStatus(group.status),
    remarks: group.remarks || '',
    channel,
  }
}

export function OpenGroupDetailPage({ embedded = false }: Props) {
  const { groupId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const api = useApi()
  const authEnabled = useDaigouStore((s) => s.settings.adminAuthEnabled !== false)
  /** 客人公開頁不顯示管理；僅帶 manage=1 且具後台身分時才開啟 */
  const staffOk = hasRemoteGas()
    ? isAdminSessionValid() && Boolean(getAdminToken())
    : authEnabled
      ? isAdminSessionValid()
      : true
  const canEdit = staffOk && searchParams.get('manage') === '1'

  const [group, setGroup] = useState<PublicGroupCatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState<PortalEditForm | null>(null)

  const load = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    setError('')
    try {
      const data = await api.call<{ groups: PublicGroupCatalogItem[] }>({
        module: 'groupbuy',
        action: 'listPublicGroups',
      })
      const found = (data.groups || []).find((g) => g.id === groupId) || null
      if (!found) {
        setGroup(null)
        setError('找不到此開團，可能已下架或連結有誤。')
      } else {
        setGroup(found)
        setForm(toEditForm(found))
      }
    } catch (e) {
      console.error(e)
      setError('讀取開團資料失敗，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }, [api, groupId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchParams.get('edit') !== '1' || !canEdit || !group) return
    setEditing(true)
    setForm(toEditForm(group))
  }, [searchParams, canEdit, group])

  const images = useMemo(
    () => (group ? normalizeGroupImageUrls(group.imageUrls, group.coverImageUrl) : []),
    [group],
  )

  async function saveEdits() {
    if (!group || !form || !canEdit) return
    const name = form.name.trim()
    if (!name) {
      setSaveMsg('請填寫團務名稱')
      return
    }
    setSaving(true)
    setSaveMsg('')
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      const imageUrls = form.imageUrls
      const coverImageUrl = primaryGroupImageUrl(imageUrls)
      const channel: GroupBuyChannel | '' =
        form.channel === '場販' || form.channel === '通販' ? form.channel : ''
      const groups = (data.groups || []).map((g) => {
        if (g.id !== group.id) return g
        return {
          ...g,
          name,
          description: form.description.trim(),
          imageUrls,
          coverImageUrl,
          closingDate: form.closingDate,
          officialShipDate: form.officialShipDate.trim(),
          status: normalizeGroupStatus(form.status),
          remarks: form.remarks.trim(),
          channel,
          /** 場販不進團務管理 */
          ...(channel === '場販' ? { opsActive: false as const } : {}),
        }
      })
      const payload: GroupBuySavePayload = {
        groups,
        bankJournal: data.bankJournal || [],
        exchangeRate: data.exchangeRate ?? 0.22,
        portalConfig: data.portalConfig,
      }
      await api.call({ module: 'groupbuy', action: 'saveAppData', payload })
      const updated: PublicGroupCatalogItem = {
        ...group,
        name,
        description: form.description.trim(),
        imageUrls,
        coverImageUrl,
        closingDate: form.closingDate,
        officialShipDate: form.officialShipDate.trim(),
        status: normalizeGroupStatus(form.status),
        remarks: form.remarks.trim(),
        channel,
        ...(channel === '場販' ? { opsActive: false } : {}),
      }
      setGroup(updated)
      setForm(toEditForm(updated))
      setEditing(false)
      setSaveMsg('已儲存開團專區內容')
    } catch (e) {
      console.error(e)
      const detail = e instanceof Error && e.message ? e.message : ''
      setSaveMsg(
        detail.includes('儲存') || detail.includes('圖片') || detail.includes('空間')
          ? detail
          : '儲存失敗，請稍後再試' + (detail ? `（${detail}）` : ''),
      )
    } finally {
      setSaving(false)
    }
  }

  async function activateOps() {
    if (!group || !canEdit) return
    if (!isMailOrderChannel(group)) {
      setSaveMsg('場販開團不使用團務管理，請在開團專區維護即可')
      return
    }
    if (!window.confirm(`確定將「${group.name}」建立為團務？之後會出現在團務管理，狀態兩邊同步。`)) return
    setSaving(true)
    setSaveMsg('')
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData', payload: { groupScope: 'all' } })
      const groups = (data.groups || []).map((g) => {
        if (g.id !== group.id) return g
        return { ...g, opsActive: true, portalListed: true, channel: '通販' as const }
      })
      const payload: GroupBuySavePayload = {
        groups,
        bankJournal: data.bankJournal || [],
        exchangeRate: data.exchangeRate ?? 0.22,
        portalConfig: data.portalConfig,
      }
      await api.call({ module: 'groupbuy', action: 'saveAppData', payload })
      setGroup({ ...group, opsActive: true, portalListed: true, channel: '通販' })
      setSaveMsg('已成團，正在前往團務管理…')
      navigate(`/groups?group=${encodeURIComponent(group.id)}`)
    } catch (e) {
      console.error(e)
      setSaveMsg('建立團務失敗，請稍後再試')
    } finally {
      setSaving(false)
    }
  }

  const status = group ? normalizeGroupStatus(group.status) : '已登記'
  const formed = group ? isOpsActive(group) : false
  const mailOrder = group ? isMailOrderChannel(group) : false

  const fromLookup = searchParams.get('from') === 'lookup'
  const lookupReturnQ = searchParams.get('q')?.trim() || ''
  const lookupReturnOrder = searchParams.get('order')?.trim() || ''
  const lookupReturnHref = (() => {
    if (!lookupReturnQ) return '/lookup'
    const params = new URLSearchParams()
    params.set('q', lookupReturnQ)
    if (lookupReturnOrder) params.set('order', lookupReturnOrder)
    params.set('resume', '1')
    return `/lookup?${params.toString()}`
  })()

  const adminListHref = '/open-groups-preview'

  function goBack() {
    if (fromLookup) {
      navigate(lookupReturnHref)
      return
    }
    if (canEdit) {
      navigate(adminListHref)
      return
    }
    navigate(-1)
  }

  return (
    <div className={'og' + (embedded ? ' og--embedded' : '') + ' og-detail-page'}>
      <header className="og-header">
        <div className="og-header-inner">
          <div>
            <p className="og-eyebrow">Heina Shop · 開團專區</p>
            <h1 className="og-title">{group?.name || '開團詳情'}</h1>
          </div>
          {canEdit && group && isInGroupOps(group) ? (
            <div className="og-header-actions">
              <Link to={groupOpsHref(group.id)} className="og-header-link og-header-link--solid">
                團務管理
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <main className="og-main og-detail-main">
        <button
          type="button"
          className={'og-detail-back' + (canEdit ? ' og-detail-back--admin' : '')}
          onClick={goBack}
        >
          <ArrowLeft size={canEdit ? 14 : 16} aria-hidden />
          {canEdit ? '返回開團專區' : fromLookup ? '返回查單' : '返回'}
        </button>

        {loading ? <p className="og-state">載入中…</p> : null}
        {error ? (
          <p className="og-state og-state--error" role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error && group ? (
          <article className="og-detail">
            {images.length ? (
              <div className="og-detail-gallery og-detail-gallery--swipe">
                <GroupImageSwipe
                  images={images}
                  emptyLabel={group.name.charAt(0) || '團'}
                  size="detail"
                />
              </div>
            ) : (
              <div className="og-detail-gallery og-detail-gallery--empty">{group.name.charAt(0) || '團'}</div>
            )}

            <div className="og-detail-body">
              <div className="og-detail-head">
                <h2 className="og-detail-name">{group.name}</h2>
                <div className="og-detail-head-tags">
                  <span className={'og-card-status og-card-status--' + status}>{status}</span>
                  {group.channel === '場販' || group.channel === '通販' ? (
                    <span
                      className={
                        group.channel === '場販' ? 'og-card-channel og-card-channel--venue' : 'og-card-channel og-card-channel--mail'
                      }
                    >
                      {group.channel}
                    </span>
                  ) : null}
                  {canEdit && mailOrder ? (
                    <span className={'og-card-lifecycle' + (formed ? ' og-card-lifecycle--formed' : ' og-card-lifecycle--preview')}>
                      {formed ? '已成團 · 團務同步中' : '開團預告 · 尚未建團務'}
                    </span>
                  ) : null}
                </div>
              </div>

              {!editing ? (
                <>
                  <dl className="og-detail-meta">
                    <div>
                      <dt>結單日期</dt>
                      <dd>{dash(formatYmd(group.closingDate))}</dd>
                    </div>
                    <div>
                      <dt>官方出貨日</dt>
                      <dd>{dash(formatYmd(group.officialShipDate))}</dd>
                    </div>
                    <div>
                      <dt>團務狀態</dt>
                      <dd>{status}</dd>
                    </div>
                  </dl>

                  <section className="og-detail-section">
                    <h3 className="og-detail-label">團務說明</h3>
                    {group.description ? (
                      <p className="og-detail-desc">{group.description}</p>
                    ) : (
                      <p className="og-detail-muted">尚無說明</p>
                    )}
                  </section>

                  {group.remarks ? (
                    <section className="og-detail-section">
                      <h3 className="og-detail-label">備註</h3>
                      <p className="og-detail-remarks">{group.remarks}</p>
                    </section>
                  ) : null}

                  {canEdit ? (
                    <div className="og-detail-admin-bar">
                      {mailOrder ? (
                        !formed ? (
                          <button
                            type="button"
                            className="og-detail-save-btn"
                            disabled={saving}
                            onClick={() => void activateOps()}
                          >
                            {saving ? '處理中…' : '建立團務（成團）'}
                          </button>
                        ) : (
                          <Link to={groupOpsHref(group.id)} className="og-detail-edit-btn">
                            前往團務管理
                          </Link>
                        )
                      ) : (
                        <p className="og-detail-sync-hint">場販開團僅在開團專區管理，不會進入團務管理。</p>
                      )}
                      <button type="button" className="og-detail-edit-btn" onClick={() => setEditing(true)}>
                        編輯開團專區內容
                      </button>
                      {saveMsg ? <p className="og-detail-save-msg">{saveMsg}</p> : null}
                      {mailOrder ? (
                        <p className="og-detail-sync-hint">
                          團務狀態與此頁共用同一筆資料：這邊改狀態，團務管理也會同步。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : form ? (
                <form
                  className="og-detail-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void saveEdits()
                  }}
                >
                  <label className="og-detail-field">
                    <span className="og-detail-label">團務名稱</span>
                    <input
                      className="og-detail-input"
                      value={form.name}
                      onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                      placeholder="例：XX 週邊代購"
                      required
                      maxLength={120}
                    />
                  </label>

                  <label className="og-detail-field">
                    <span className="og-detail-label">團務照片</span>
                    <GroupImageGalleryEditor
                      imageUrls={form.imageUrls}
                      onChange={(imageUrls) => setForm((f) => (f ? { ...f, imageUrls } : f))}
                    />
                  </label>

                  <label className="og-detail-field">
                    <span className="og-detail-label">團務說明</span>
                    <textarea
                      className="og-detail-textarea"
                      rows={10}
                      value={form.description}
                      onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
                      placeholder="完整開團說明、品項、注意事項…"
                    />
                  </label>

                  <div className="og-detail-form-row">
                    <label className="og-detail-field">
                      <span className="og-detail-label">結單日期</span>
                      <input
                        type="date"
                        className="og-detail-input"
                        value={form.closingDate}
                        onChange={(e) => setForm((f) => (f ? { ...f, closingDate: e.target.value } : f))}
                      />
                    </label>
                    <label className="og-detail-field">
                      <span className="og-detail-label">官方出貨日</span>
                      <input
                        className="og-detail-input"
                        value={form.officialShipDate}
                        onChange={(e) => setForm((f) => (f ? { ...f, officialShipDate: e.target.value } : f))}
                        placeholder="例：7月下旬、未定"
                      />
                    </label>
                  </div>

                  <label className="og-detail-field">
                    <span className="og-detail-label">採購管道（場販／通販）</span>
                    <select
                      className="og-detail-input"
                      value={form.channel}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, channel: e.target.value as PortalEditForm['channel'] } : f,
                        )
                      }
                      required
                    >
                      <option value="" disabled>
                        請選擇場販或通販
                      </option>
                      <option value="場販">場販</option>
                      <option value="通販">通販</option>
                    </select>
                  </label>

                  <label className="og-detail-field">
                    <span className="og-detail-label">團務狀態</span>
                    <select
                      className="og-detail-input"
                      value={form.status}
                      onChange={(e) => setForm((f) => (f ? { ...f, status: e.target.value } : f))}
                    >
                      {V50_GROUP_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="og-detail-field">
                    <span className="og-detail-label">備註</span>
                    <textarea
                      className="og-detail-textarea og-detail-textarea-sm"
                      rows={4}
                      value={form.remarks}
                      onChange={(e) => setForm((f) => (f ? { ...f, remarks: e.target.value } : f))}
                      placeholder="補充說明、出貨提醒…"
                    />
                  </label>

                  <div className="og-detail-form-actions">
                    <button
                      type="button"
                      className="og-pager-btn"
                      onClick={() => {
                        if (group) setForm(toEditForm(group))
                        setEditing(false)
                        setSaveMsg('')
                      }}
                    >
                      取消
                    </button>
                    <button type="submit" className="og-detail-save-btn" disabled={saving}>
                      {saving ? '儲存中…' : '儲存'}
                    </button>
                  </div>
                  {saveMsg ? <p className="og-detail-save-msg">{saveMsg}</p> : null}
                </form>
              ) : null}
            </div>
          </article>
        ) : null}
      </main>
    </div>
  )
}
