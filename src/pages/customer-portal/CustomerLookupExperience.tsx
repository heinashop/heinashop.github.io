import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, KeyRound, Search } from 'lucide-react'
import type { CustomerLookupMatch, PortalLookupMembership, PreorderLookupMatch } from '../../api/types'
import {
  classifyDaigouOrder,
  countOrderBuckets,
  ORDER_BUCKET_LABELS,
  type DaigouOrderBucket,
} from '../../modules/groupbuy/v50Utils'
import { isValidLookupPin, normalizeLookupPin } from '../../daigou/portalLookupAuth'
import { useApi } from '../../context/useApi'
import { StaffLookupMemberPreview } from '../staffLookup/StaffLookupMemberPreview'
import '../staffLookup/StaffLookupMemberPreview.css'
import {
  countPortalPendingShipOrders,
  customerLookupMatchesToPreview,
} from './customerLookupPreviewAdapter'
import { CustomerPaymentReportPanel } from './CustomerPaymentReportPanel'

export type CustomerLookupExperienceProps = {
  query: string
  setQuery: (v: string) => void
  lookupPin: string
  setLookupPin: (v: string) => void
  loading: boolean
  error: string
  searched: boolean
  matchesGroupbuy: CustomerLookupMatch[]
  matchesPreorder: PreorderLookupMatch[]
  totalMatches: number
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onSearch: () => void
  onBackHome?: () => void
  membership?: PortalLookupMembership | null
  extraNote?: string
  /** 查詢訂單標題下方說明（後台可編） */
  lookupDesc?: string
  autoSync?: 'idle' | 'checking' | 'updated' | 'error'
}

export function CustomerLookupExperience({
  query,
  setQuery,
  lookupPin,
  setLookupPin,
  loading,
  error,
  searched,
  matchesGroupbuy,
  matchesPreorder,
  totalMatches,
  expandedId,
  onSearch,
  onBackHome,
  membership = null,
  extraNote = '',
  lookupDesc = '',
  autoSync = 'idle',
}: CustomerLookupExperienceProps) {
  const api = useApi()
  const [orderBucketTab, setOrderBucketTab] = useState<DaigouOrderBucket>('pending')
  const [showChangePin, setShowChangePin] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinMsg, setPinMsg] = useState('')
  const [pinErr, setPinErr] = useState('')

  const previewData = useMemo(
    () => customerLookupMatchesToPreview(matchesGroupbuy, matchesPreorder),
    [matchesGroupbuy, matchesPreorder],
  )

  useEffect(() => {
    if (!expandedId || !previewData.orders.length) return
    const order = previewData.orders.find((o) => o.id === expandedId)
    if (!order) return
    const g = previewData.groupsById.get(order.groupId)
    const bucket = classifyDaigouOrder(order.paymentStatus, g?.internalNotes, order.orderStatus)
    setOrderBucketTab(bucket)
  }, [expandedId, previewData.orders, previewData.groupsById])

  const bucketCounts = useMemo(
    () => countOrderBuckets(previewData.orders, previewData.groupsById),
    [previewData.orders, previewData.groupsById],
  )

  const bucketOrders = useMemo(() => {
    return previewData.orders.filter((o) => {
      const g = previewData.groupsById.get(o.groupId)
      return classifyDaigouOrder(o.paymentStatus, g?.internalNotes, o.orderStatus) === orderBucketTab
    })
  }, [previewData.orders, previewData.groupsById, orderBucketTab])

  const lineDisplayName =
    matchesGroupbuy[0]?.order.customerName || matchesPreorder[0]?.order.customerName || '—'

  const pendingShipCount = useMemo(
    () => countPortalPendingShipOrders(bucketOrders, previewData.groupsById),
    [bucketOrders, previewData.groupsById],
  )

  const hasResults = searched && !loading && totalMatches > 0
  const pinReady = isValidLookupPin(normalizeLookupPin(lookupPin))
  const canSearch = query.trim().length > 0 && pinReady

  function handleSearch() {
    setOrderBucketTab('pending')
    onSearch()
  }

  async function submitChangePin() {
    setPinErr('')
    setPinMsg('')
    const name = query.trim()
    if (!name) {
      setPinErr('請先填寫查詢名稱（社群暱稱）')
      return
    }
    setPinBusy(true)
    try {
      const res = await api.call<{ ok: boolean; message?: string; lookupPin?: string }>({
        module: 'groupbuy',
        action: 'changeLookupPin',
        payload: {
          customerName: name,
          currentPin,
          newPin,
          confirmPin,
        },
      })
      if (!res.ok) {
        setPinErr(res.message || '修改失敗')
        return
      }
      setPinMsg(res.message || '查單密碼已更新')
      if (res.lookupPin) setLookupPin(res.lookupPin)
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setShowChangePin(false)
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : '修改失敗，請稍後再試')
    } finally {
      setPinBusy(false)
    }
  }

  return (
    <div className="lk-content">
      <section className="lk-card lk-search-card lk-search-card--sticker">
        <h2 className="lk-card-title">查詢訂單</h2>
        <p className="lk-card-desc">
          {lookupDesc?.trim() ||
            '請輸入在社群裡的名字。若有改名或無法查詢請私訊官方 LINE。查單密碼為 4 位數字，可自行修改。'}
        </p>
        <form
          className="lk-search-form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSearch()
          }}
        >
          <div className="lk-search-pill">
            <Search className="lk-search-pill-icon" aria-hidden strokeWidth={2.5} />
            <input
              id="lk-query"
              className="lk-search-pill-input"
              placeholder="請輸入群裡的名字"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="請輸入群裡的名字"
            />
          </div>
          <label className="lk-pin-field">
            <span className="lk-pin-label">查單密碼（4 位數）</span>
            <input
              id="lk-pin"
              className="lk-pin-input"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="••••"
              value={lookupPin}
              onChange={(e) => setLookupPin(normalizeLookupPin(e.target.value))}
              autoComplete="off"
              aria-label="查單密碼"
            />
          </label>
          <button type="submit" className="lk-search-submit" disabled={loading || !canSearch}>
            {loading ? '查詢中…' : '開始查詢'}
            <ArrowRight aria-hidden strokeWidth={2.5} />
          </button>
        </form>

        <div className="lk-pin-change">
          <button
            type="button"
            className="lk-pin-change-toggle"
            onClick={() => {
              setShowChangePin((v) => !v)
              setPinErr('')
              setPinMsg('')
            }}
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            {showChangePin ? '收起修改密碼' : '修改查單密碼'}
          </button>
          {pinMsg ? <p className="lk-pin-change-ok">{pinMsg}</p> : null}
          {showChangePin ? (
            <div className="lk-pin-change-panel">
              <p className="lk-pin-change-hint">
                請確認上方「查詢名稱」正確，輸入目前密碼後設定新的 4 位數密碼（修改後後台會同步更新）。
              </p>
              <label className="lk-pin-field">
                <span className="lk-pin-label">目前密碼</span>
                <input
                  className="lk-pin-input"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(normalizeLookupPin(e.target.value))}
                />
              </label>
              <label className="lk-pin-field">
                <span className="lk-pin-label">新密碼</span>
                <input
                  className="lk-pin-input"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(normalizeLookupPin(e.target.value))}
                />
              </label>
              <label className="lk-pin-field">
                <span className="lk-pin-label">確認新密碼</span>
                <input
                  className="lk-pin-input"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(normalizeLookupPin(e.target.value))}
                />
              </label>
              {pinErr ? <p className="lk-pin-change-err">{pinErr}</p> : null}
              <button
                type="button"
                className="lk-search-submit"
                disabled={pinBusy}
                onClick={() => void submitChangePin()}
              >
                {pinBusy ? '更新中…' : '確認修改'}
              </button>
            </div>
          ) : null}
        </div>

        <p className="lk-search-note">
          {extraNote?.trim() || '付款後請回傳後五碼；金額疑問請先聯絡代購主再匯款。'}
        </p>
      </section>

      {error ? (
        <div className="lk-alert lk-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {searched && !loading && !error && totalMatches === 0 ? (
        <div className="lk-card lk-empty-card">
          <p className="lk-empty-title">查無符合的訂單</p>
          <p className="lk-empty-desc">請確認名稱、編號或手機末三碼是否正確，或聯絡代購主協助查詢。</p>
          {onBackHome ? (
            <button type="button" className="lk-back-home-btn" onClick={onBackHome}>
              返回首頁
            </button>
          ) : null}
        </div>
      ) : null}

      {hasResults ? (
        <section className="lk-results lk-results--preview" aria-label="查詢結果">
          {autoSync !== 'idle' ? (
            <p className="lk-auto-sync" role="status">
              {autoSync === 'checking' ? '資料更新中…' : autoSync === 'updated' ? '已自動更新為最新資料' : '暫時無法確認最新版本'}
            </p>
          ) : null}
          <div className="lk-results-toolbar">
            {onBackHome ? (
              <button type="button" className="lk-back-home-btn lk-back-home-btn--inline" onClick={onBackHome}>
                ← 返回首頁
              </button>
            ) : null}
          </div>
          {membership ? (
            <div className="lk-member-preview-note">
              <strong>會員禮遇 · {membership.tierLabel}</strong>
              <ul>
                {membership.benefits.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="lk-order-bucket-tabs" role="tablist" aria-label="訂單分類">
            {(Object.keys(ORDER_BUCKET_LABELS) as DaigouOrderBucket[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={orderBucketTab === key}
                className={'lk-order-bucket-tab' + (orderBucketTab === key ? ' is-active' : '')}
                onClick={() => setOrderBucketTab(key)}
              >
                {ORDER_BUCKET_LABELS[key]}
                <span className="lk-order-bucket-count">（{bucketCounts[key]}）</span>
              </button>
            ))}
          </div>

          {bucketOrders.length === 0 ? (
            <p className="slmp-empty lk-bucket-empty">
              沒有{ORDER_BUCKET_LABELS[orderBucketTab]}，請切換其他分頁查看。
            </p>
          ) : (
            <>
              {orderBucketTab === 'pending' ? (
                <CustomerPaymentReportPanel
                  customerName={lineDisplayName}
                  lookupPin={lookupPin}
                  orders={bucketOrders}
                  groupsById={previewData.groupsById}
                  onSubmitted={() => void onSearch()}
                />
              ) : null}

              <StaffLookupMemberPreview
                lineDisplayName={lineDisplayName}
                orders={bucketOrders}
                groupsById={previewData.groupsById}
                orderBucket={orderBucketTab}
                pendingShipCount={pendingShipCount}
                lookupQuery={query.trim()}
                initialExpandedId={expandedId}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
