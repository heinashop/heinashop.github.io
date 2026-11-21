import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Boxes, Plus, RefreshCw } from 'lucide-react'
import { Btn, Empty, PageHeader } from '../components/ui'
import { PageLayout } from '../components/app/PageLayout'
import { useApi } from '../context/useApi'
import { useDaigouStore } from '../daigou/store'
import { isSheetEditing, mergeGroupList } from '../sync/sheetSync'
import { useRemoteSlice } from '../sync/SheetSyncBridge'
import { applySavedRevisions, buildGroupSavePayload, type SaveResult } from '../sync/groupSave'
import type {
  ConsolidationShipment,
  GroupBuyAppData,
  GroupBuyGroup,
} from '../api/types'
import {
  createConsolidationShipment,
  formatConsolDate,
  formatWeightKg,
  groupNamesOnShipment,
  listAvailableParcels,
  parcelKey,
  SHIPMENT_STATUS_LABEL,
  sumInboundWeight,
  syncGroupStatusesFromShipments,
  syncShipmentsFromGroupStatuses,
} from '../modules/groupbuy/consolidationLogic'
import { isInGroupOps } from '../modules/groupbuy/groupLifecycle'
import { syncV50GroupOrdersToDaigou } from '../modules/groupbuy/v50DaigouSync'
import './consolidationPage.css'

type Tab = 'ready' | 'open' | 'arrived' | 'ended'

export function ConsolidationPage() {
  const { shipmentId } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const addToast = useDaigouStore((s) => s.addToast)

  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupBuyGroup[]>([])
  const baseGroupsRef = useRef<GroupBuyGroup[]>([])
  const [shipments, setShipments] = useState<ConsolidationShipment[]>([])
  const [appRest, setAppRest] = useState<Pick<
    GroupBuyAppData,
    'bankJournal' | 'exchangeRate' | 'portalConfig' | 'paymentReports'
  > | null>(null)

  const [tab, setTab] = useState<Tab>('ready')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ billedWeightKg: '', intlFeeTwd: '', intlTrackingNo: '', carrier: '', note: '' })

  useRemoteSlice((slice) => {
    if (isSheetEditing() || busy || draft.billedWeightKg || draft.intlFeeTwd || draft.intlTrackingNo || draft.carrier || draft.note) return
    if (slice.groups) {
      const incoming = slice.groups as GroupBuyGroup[]
      setGroups((prev) => mergeGroupList(prev, incoming))
      baseGroupsRef.current = mergeGroupList(baseGroupsRef.current, incoming)
    }
    if (slice.paymentReports) setAppRest((prev) => (prev ? { ...prev, paymentReports: slice.paymentReports as GroupBuyAppData['paymentReports'] } : prev))
    if (slice.bankJournal) setAppRest((prev) => (prev ? { ...prev, bankJournal: slice.bankJournal as GroupBuyAppData['bankJournal'] } : prev))
  })

  const opsGroups = useMemo(() => groups.filter(isInGroupOps), [groups])
  const available = useMemo(() => listAvailableParcels(opsGroups, shipments), [opsGroups, shipments])
  const openShips = useMemo(
    () => shipments.filter((s) => s.status === 'consolidating').sort((a, b) => b.updatedAt - a.updatedAt),
    [shipments],
  )
  const arrivedShips = useMemo(
    () => shipments.filter((s) => s.status === 'arrived').sort((a, b) => b.updatedAt - a.updatedAt),
    [shipments],
  )
  const endedShips = useMemo(
    () => shipments.filter((s) => s.status === 'ended').sort((a, b) => b.updatedAt - a.updatedAt),
    [shipments],
  )
  const viewShip = shipmentId ? shipments.find((s) => s.id === shipmentId) : null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      const rawGroups = data.groups || []
      const rawShips = data.consolidationShipments || []
      const nextShips = syncShipmentsFromGroupStatuses(rawGroups, rawShips)
      const rest = {
        bankJournal: data.bankJournal || [],
        exchangeRate: data.exchangeRate ?? 0.22,
        portalConfig: data.portalConfig,
        paymentReports: data.paymentReports || [],
      }
      setGroups(rawGroups)
      baseGroupsRef.current = rawGroups
      setShipments(nextShips)
      setAppRest(rest)
      if (nextShips !== rawShips) {
        const syncedGroups = syncGroupStatusesFromShipments(rawGroups, nextShips)
        const { payload, mutationMode } = buildGroupSavePayload(rawGroups, syncedGroups, {
          bankJournal: rest.bankJournal,
          exchangeRate: rest.exchangeRate,
          portalConfig: rest.portalConfig || {
            title: '訂單自助查詢',
            intro: '',
            websiteUrl: '',
            groupUrl: '',
            extraNote: '',
          },
          paymentReports: rest.paymentReports,
          consolidationShipments: nextShips,
        })
        const saved = await api.call<SaveResult>({ module: 'groupbuy', action: 'saveAppData', payload })
        const committed = mutationMode ? applySavedRevisions(syncedGroups, saved) : syncedGroups
        baseGroupsRef.current = committed
        setGroups(committed)
        for (const g of committed) syncV50GroupOrdersToDaigou(g)
      }
    } catch (e) {
      console.error(e)
      addToast('讀取集運資料失敗', 'err')
    } finally {
      setLoading(false)
    }
  }, [api, addToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!viewShip) return
    setDraft({
      billedWeightKg: viewShip.billedWeightKg || '',
      intlFeeTwd: viewShip.intlFeeTwd || '',
      intlTrackingNo: viewShip.intlTrackingNo || '',
      carrier: viewShip.carrier || '',
      note: viewShip.note || '',
    })
  }, [viewShip?.id])

  async function persist(nextGroups: GroupBuyGroup[], nextShips: ConsolidationShipment[]) {
    if (!appRest) return
    const shipsSynced = syncShipmentsFromGroupStatuses(nextGroups, nextShips)
    const synced = syncGroupStatusesFromShipments(nextGroups, shipsSynced)
    const { payload, mutationMode } = buildGroupSavePayload(baseGroupsRef.current, synced, {
      bankJournal: appRest.bankJournal,
      exchangeRate: appRest.exchangeRate,
      portalConfig: appRest.portalConfig || {
        title: '訂單自助查詢',
        intro: '',
        websiteUrl: '',
        groupUrl: '',
        extraNote: '',
      },
      paymentReports: appRest.paymentReports,
      consolidationShipments: shipsSynced,
    })
    const saved = await api.call<SaveResult>({ module: 'groupbuy', action: 'saveAppData', payload })
    const committed = mutationMode ? applySavedRevisions(synced, saved) : synced
    baseGroupsRef.current = committed
    setGroups(committed)
    setShipments(shipsSynced)
    for (const g of committed) syncV50GroupOrdersToDaigou(g)
  }

  const allAvailableSelected = available.length > 0 && available.every((p) => selected.has(parcelKey(p)))

  function toggleParcel(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function createFromSelection() {
    const parcels = available.filter((p) => selected.has(parcelKey(p)))
    if (!parcels.length) {
      addToast('請先勾選要集運的物流編號', 'err')
      return
    }
    setBusy(true)
    try {
      const ship = createConsolidationShipment(parcels)
      const nextShips = [ship, ...shipments]
      await persist(groups, nextShips)
      setSelected(new Set())
      addToast(`已建立集運單（${parcels.length} 包），團務改為已集運`, 'ok')
      navigate(`/consolidation/${ship.id}`)
    } catch (e) {
      console.error(e)
      addToast('建立集運單失敗', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function saveDetail() {
    if (!viewShip) return
    setBusy(true)
    try {
      const nextShips = shipments.map((s) =>
        s.id === viewShip.id
          ? {
              ...s,
              ...draft,
              billedWeightKg: draft.billedWeightKg.trim(),
              intlFeeTwd: draft.intlFeeTwd.trim(),
              intlTrackingNo: draft.intlTrackingNo.trim(),
              carrier: draft.carrier.trim(),
              note: draft.note.trim(),
              updatedAt: Date.now(),
            }
          : s,
      )
      await persist(groups, nextShips)
      addToast('已儲存合箱重量與運費', 'ok')
    } catch (e) {
      console.error(e)
      addToast('儲存失敗', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function setShipmentArrived(ship: ConsolidationShipment, arrived: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const nextShips = shipments.map((s) =>
        s.id === ship.id
          ? {
              ...s,
              status: arrived ? ('arrived' as const) : ('consolidating' as const),
              arrivedAt: arrived ? new Date().toISOString().slice(0, 10) : undefined,
              updatedAt: Date.now(),
            }
          : s,
      )
      await persist(groups, nextShips)
      addToast(arrived ? '已標記抵台，團務同步為已抵台' : '已改回已集運，團務同步為已集運', 'ok')
      if (arrived && tab === 'open') setTab('arrived')
    } catch (e) {
      console.error(e)
      addToast('更新抵台狀態失敗', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function cancelShipment() {
    if (!viewShip) return
    if (!window.confirm('取消此集運單？勾選的包會回到可集運，團務退回官方已發貨（若沒有其他進行中集運）。')) return
    setBusy(true)
    try {
      const nextShips = shipments.filter((s) => s.id !== viewShip.id)
      await persist(groups, nextShips)
      addToast('已取消集運單', 'ok')
      navigate('/consolidation')
    } catch (e) {
      console.error(e)
      addToast('取消失敗', 'err')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="gb-loading">集運資料載入中…</div>
  }

  if (shipmentId && !viewShip) {
    return (
      <PageLayout className="consol-page px-4 py-6 sm:px-6">
        <Empty title="找不到這張集運單" description="可能已被取消。" action={<Btn to="/consolidation">回集運列表</Btn>} />
      </PageLayout>
    )
  }

  if (viewShip) {
    const inbound = sumInboundWeight(viewShip.parcels)
    const names = groupNamesOnShipment(viewShip)
    return (
      <PageLayout className="consol-page px-4 py-6 sm:px-6">
        <PageHeader
          title="集運明細"
          subtitle={SHIPMENT_STATUS_LABEL[viewShip.status]}
          action={
            <Btn variant="secondary" to="/consolidation">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Btn>
          }
        />
        <div className="consol-panel">
          <p className="consol-hint">
            這一票 {names.length} 個團務、{viewShip.parcels.length} 個物流編號。入庫重量含外箱，僅供核對；合箱實重等集運商確認後再填，可隨時修改。
          </p>
          <ul className="consol-list">
            {viewShip.parcels.map((p) => (
              <li key={parcelKey(p)}>
                <div className="consol-row" style={{ cursor: 'default' }}>
                  <Boxes className="h-4 w-4" aria-hidden style={{ color: '#5b4a8a' }} />
                  <div className="consol-row-main">
                    <span className="consol-row-name">{p.groupName || p.groupId}</span>
                    <span className="consol-row-sub">{p.logisticsId}</span>
                  </div>
                  <span className="consol-weight">入庫 {p.inboundWeight || '—'} kg</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="consol-ref-box">
            <p className="consol-ref-title">入庫合計（含外箱，不是計費重）</p>
            <p>{inbound == null ? '尚未完整填寫入庫重量' : `${inbound} kg`}</p>
            <p className="consol-warn">集運商拆箱合箱後重量會變，請以下方合箱實重為準。</p>
          </div>
          <div className="consol-form">
            <label className="consol-field">
              <span>合箱實重（kg）</span>
              <input
                className="heina-input"
                inputMode="decimal"
                placeholder="等集運商確認後填入"
                value={draft.billedWeightKg}
                onChange={(e) => setDraft((d) => ({ ...d, billedWeightKg: e.target.value }))}
              />
            </label>
            <label className="consol-field">
              <span>國際運費（TWD）</span>
              <input
                className="heina-input"
                inputMode="numeric"
                placeholder="可後補"
                value={draft.intlFeeTwd}
                onChange={(e) => setDraft((d) => ({ ...d, intlFeeTwd: e.target.value }))}
              />
            </label>
            <label className="consol-field">
              <span>國際單號</span>
              <input
                className="heina-input"
                placeholder="可後補"
                value={draft.intlTrackingNo}
                onChange={(e) => setDraft((d) => ({ ...d, intlTrackingNo: e.target.value }))}
              />
            </label>
            <label className="consol-field">
              <span>集運商／備註</span>
              <input
                className="heina-input"
                placeholder="集運商"
                value={draft.carrier}
                onChange={(e) => setDraft((d) => ({ ...d, carrier: e.target.value }))}
              />
            </label>
            <label className="consol-field">
              <span>內部備註</span>
              <textarea
                className="heina-input"
                rows={2}
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="consol-actions">
            <Btn disabled={busy} onClick={() => void saveDetail()}>
              {busy ? '儲存中…' : '儲存重量與運費'}
            </Btn>
            {viewShip.status === 'consolidating' ? (
              <>
                <Btn variant="secondary" disabled={busy} onClick={() => void setShipmentArrived(viewShip, true)}>
                  標記抵台
                </Btn>
                <button type="button" className="consol-text-btn" disabled={busy} onClick={() => void cancelShipment()}>
                  取消此單
                </button>
              </>
            ) : viewShip.status === 'ended' ? (
              <span className="consol-hint" style={{ margin: 0 }}>
                相關團務已結束。抵台日 {viewShip.arrivedAt || '—'}
              </span>
            ) : (
              <span className="consol-hint" style={{ margin: 0 }}>
                抵台日 {viewShip.arrivedAt || '—'}
              </span>
            )}
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout className="consol-page px-4 py-6 sm:px-6">
      <PageHeader
        title="集運"
        subtitle="官方已發貨且已填物流編號的包會出現在可集運。儲存集運單後團務改為已集運，合箱實重可之後再改。"
        action={
          <Btn variant="secondary" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            重新載入
          </Btn>
        }
      />
      <div className="consol-tabs" role="tablist">
        {(
          [
            ['ready', `可集運 ${available.length}`],
            ['open', `已集運 ${openShips.length}`],
            ['arrived', `已抵台 ${arrivedShips.length}`],
            ['ended', `已結束 ${endedShips.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={'consol-tab' + (tab === id ? ' is-active' : '')}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ready' ? (
        <div className="consol-panel">
          {available.length === 0 ? (
            <Empty
              title="目前沒有可集運的包"
              description="請到團務管理把狀態改成「官方已發貨」，並在成本列填物流編號。"
              action={
                <Btn variant="secondary" to="/groups">
                  前往團務管理
                </Btn>
              }
            />
          ) : (
            <>
              <p className="consol-hint">先打勾要合箱的物流編號，再建立集運單。打勾當下不會改團務狀態。</p>
              <div className="consol-actions">
                <button
                  type="button"
                  className="consol-text-btn"
                  onClick={() =>
                    setSelected(
                      allAvailableSelected ? new Set() : new Set(available.map((p) => parcelKey(p))),
                    )
                  }
                >
                  {allAvailableSelected ? '取消全選' : '全選'}
                </button>
                <Btn disabled={busy || !selected.size} onClick={() => void createFromSelection()}>
                  <Plus className="h-4 w-4" />
                  {busy ? '建立中…' : `建立集運單（${selected.size} 包）`}
                </Btn>
              </div>
              <ul className="consol-list">
                {available.map((p) => {
                  const key = parcelKey(p)
                  return (
                    <li key={key}>
                      <label className="consol-row">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggleParcel(key)} />
                        <div className="consol-row-main">
                          <span className="consol-row-name">{p.groupName}</span>
                          <span className="consol-row-sub">{p.logisticsId}</span>
                        </div>
                        <span className="consol-weight">入庫 {p.inboundWeight || '未填'} kg</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="consol-panel">
          {(tab === 'open' ? openShips : tab === 'ended' ? endedShips : arrivedShips).length === 0 ? (
            <p className="consol-hint">
              {tab === 'open'
                ? '還沒有進行中的集運單。'
                : tab === 'ended'
                  ? '還沒有已結束的集運單。團務管理改為「已結束」後會自動移到這裡。'
                  : '還沒有已抵台的集運單。'}
            </p>
          ) : (
            <>
              {tab === 'open' ? (
                <p className="consol-hint">勾選「抵台」後，這張集運單與相關團務會同步改成已抵台。</p>
              ) : tab === 'ended' ? (
                <p className="consol-hint">這些集運單的相關團務已全部結束，由團務狀態自動同步。</p>
              ) : null}
              <div className="consol-cards">
              {(tab === 'open' ? openShips : tab === 'ended' ? endedShips : arrivedShips).map((s) => {
                const inbound = sumInboundWeight(s.parcels)
                const arrived = s.status === 'arrived' || s.status === 'ended'
                const ended = s.status === 'ended'
                return (
                  <article key={s.id} className="consol-card">
                    <div className="consol-card-row">
                      {ended ? (
                        <span className="consol-card-ended-badge">結束</span>
                      ) : (
                        <label
                          className="consol-card-check"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={arrived}
                            disabled={busy}
                            onChange={(e) => void setShipmentArrived(s, e.target.checked)}
                            aria-label="抵台"
                          />
                          <span className="consol-card-check-label">抵台</span>
                        </label>
                      )}
                      <Link className="consol-card-body" to={`/consolidation/${s.id}`}>
                        <h2 className="consol-card-title">{groupNamesOnShipment(s).join('、') || '集運單'}</h2>
                        <dl className="consol-card-stats">
                          <div className="consol-card-stat">
                            <dt>集運日期</dt>
                            <dd>{formatConsolDate(s.createdAt)}</dd>
                          </div>
                          <div className="consol-card-stat">
                            <dt>包裹總重量</dt>
                            <dd>{inbound == null ? '尚未填' : `${inbound} kg`}</dd>
                          </div>
                          <div className="consol-card-stat">
                            <dt>合箱後重量</dt>
                            <dd>{formatWeightKg(s.billedWeightKg)}</dd>
                          </div>
                        </dl>
                      </Link>
                    </div>
                  </article>
                )
              })}
              </div>
            </>
          )}
        </div>
      )}
    </PageLayout>
  )
}
