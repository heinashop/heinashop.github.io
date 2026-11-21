import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  ImagePlus,
  Plus,
  Radio,
  Trash2,
  Truck,
  Upload,
} from 'lucide-react'
import { Btn, PageHeader } from '../components/ui'
import { useDaigouStore } from '../daigou/store'
import {
  downloadLiveImportTemplateXlsx,
  exportLiveSessionXlsx,
  liveImportRowsToLines,
  parseLiveImportWorkbook,
} from '../modules/live/liveExcelBridge'
import { liveCodSummary } from '../modules/live/liveSync'
import { newLiveLineId, useLiveStore } from '../modules/live/liveStore'
import {
  groupLiveLinesByCustomer,
  liveLineBalance,
  liveSessionTotals,
  resolveCustomerPhotoUrls,
} from '../modules/live/liveTypes'
import './livePage.css'

function money(n: number) {
  return `$${Math.round(n || 0).toLocaleString('zh-TW')}`
}

function formatTime(ts?: number) {
  if (!ts) return '尚未同步'
  return new Date(ts).toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function filesToDataUrls(files: FileList | File[]): Promise<string[]> {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 8)
  const out: string[] = []
  for (const file of list) {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    if (url) out.push(url)
  }
  return out
}

export function LiveManagePage() {
  const sessions = useLiveStore((s) => s.sessions)
  const addSession = useLiveStore((s) => s.addSession)
  const updateSession = useLiveStore((s) => s.updateSession)
  const renameSession = useLiveStore((s) => s.renameSession)
  const consolidateSessionsByName = useLiveStore((s) => s.consolidateSessionsByName)
  const deleteSession = useLiveStore((s) => s.deleteSession)
  const appendLines = useLiveStore((s) => s.appendLines)
  const updateLine = useLiveStore((s) => s.updateLine)
  const removeLine = useLiveStore((s) => s.removeLine)
  const renameCustomer = useLiveStore((s) => s.renameCustomer)
  const removeCustomer = useLiveStore((s) => s.removeCustomer)
  const addPhotos = useLiveStore((s) => s.addPhotos)
  const removePhoto = useLiveStore((s) => s.removePhoto)
  const addCustomerPhotos = useLiveStore((s) => s.addCustomerPhotos)
  const removeCustomerPhoto = useLiveStore((s) => s.removeCustomerPhoto)
  const syncToShipping = useLiveStore((s) => s.syncToShipping)
  const addToast = useDaigouStore((s) => s.addToast)

  const [activeId, setActiveId] = useState<string | null>(sessions[0]?.id ?? null)
  const [importMsg, setImportMsg] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [photoTarget, setPhotoTarget] = useState<'session' | string>('session')
  const [nameDraft, setNameDraft] = useState('')
  const excelRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null,
    [sessions, activeId],
  )

  useEffect(() => {
    const { mergedCount } = consolidateSessionsByName()
    if (mergedCount > 0) {
      addToast(`已自動合併 ${mergedCount} 場同名連線`, 'ok')
    }
  }, [])

  useEffect(() => {
    setNameDraft(active?.name ?? '')
  }, [active?.id, active?.name])

  const totals = useMemo(() => (active ? liveSessionTotals(active) : null), [active])
  const cod = useMemo(() => (active ? liveCodSummary(active.lines) : null), [active])
  const customerGroups = useMemo(
    () => (active ? groupLiveLinesByCustomer(active.lines) : []),
    [active],
  )

  useEffect(() => {
    if (!active) {
      setExpanded(new Set())
      return
    }
    // 手機／窄版預設收合，避免一屏塞不下
    const narrow =
      typeof window !== 'undefined' &&
      (window.matchMedia('(max-width: 1023px)').matches ||
        document.documentElement.classList.contains('admin-view-mobile') ||
        !!document.querySelector('.admin-shell.admin-view-mobile'))
    if (narrow) {
      setExpanded(new Set())
      return
    }
    setExpanded(new Set(groupLiveLinesByCustomer(active.lines).map((g) => g.key)))
  }, [active?.id])

  const commitSessionName = () => {
    if (!active) return
    const next = nameDraft.trim() || '未命名連線'
    if (next === active.name.trim()) {
      setNameDraft(active.name)
      return
    }
    const result = renameSession(active.id, next)
    setActiveId(result.id)
    setNameDraft(useLiveStore.getState().sessions.find((s) => s.id === result.id)?.name ?? next)
    if (result.merged) addToast(result.message || '已合併同名連線', 'ok')
  }

  const onCreate = () => {
    const name = window.prompt('連線名稱', `連線 ${new Date().toLocaleDateString('zh-TW')}`)
    if (name == null) return
    const display = name.trim() || '未命名連線'
    const willMerge = sessions.some((s) => s.name.trim().toLowerCase() === display.toLowerCase())
    const id = addSession(display)
    setActiveId(id)
    addToast(willMerge ? '已併入同名連線' : '已建立連線場次', 'ok')
  }

  const onImportExcel = async (file: File | null) => {
    if (!file) return
    try {
      const ab = await file.arrayBuffer()
      const parsed = parseLiveImportWorkbook(ab)
      if (!parsed.rows.length) {
        addToast(parsed.warnings[0] || '沒有可匯入的列', 'err')
        setImportMsg(parsed.warnings.join('；') || '沒有可匯入的列')
        return
      }

      const bySession = new Map<string, typeof parsed.rows>()
      for (const row of parsed.rows) {
        const key = row.sessionName.trim() || '未命名連線'
        const arr = bySession.get(key) ?? []
        arr.push(row)
        bySession.set(key, arr)
      }

      let lastId = active?.id ?? null
      let mergedSessions = 0
      const beforeIds = new Set(useLiveStore.getState().sessions.map((s) => s.id))
      for (const [sessionName, rows] of bySession) {
        const lines = liveImportRowsToLines(rows, newLiveLineId)
        const before = useLiveStore.getState().sessions.find(
          (s) => s.name.trim().toLowerCase() === sessionName.trim().toLowerCase(),
        )
        lastId = addSession(sessionName, lines)
        if (before && beforeIds.has(before.id)) mergedSessions += 1
      }

      if (lastId) setActiveId(lastId)
      const warn = parsed.warnings.slice(0, 3).join('；')
      setImportMsg(
        `已匯入 ${parsed.rows.length} 列、${bySession.size} 場連線名稱${mergedSessions ? `（其中 ${mergedSessions} 場併入既有連線）` : ''}${warn ? `（${warn}）` : ''}`,
      )
      addToast(
        mergedSessions
          ? `已匯入並自動合併同名連線（${mergedSessions} 場）`
          : `已匯入 ${parsed.rows.length} 列連線明細`,
        'ok',
      )
      for (const w of parsed.warnings.slice(0, 3)) addToast(w, 'info')
    } catch (e) {
      console.error(e)
      addToast('Excel 解析失敗', 'err')
      setImportMsg('Excel 解析失敗')
    } finally {
      if (excelRef.current) excelRef.current.value = ''
    }
  }

  const openPhotoPicker = (target: 'session' | string) => {
    setPhotoTarget(target)
    requestAnimationFrame(() => photoRef.current?.click())
  }

  const onUploadPhotos = async (files: FileList | null) => {
    if (!active || !files?.length) return
    try {
      const urls = await filesToDataUrls(files)
      if (!urls.length) {
        addToast('請選擇圖片檔', 'info')
        return
      }
      if (photoTarget === 'session') {
        addPhotos(active.id, urls)
      } else {
        const group = customerGroups.find((g) => g.key === photoTarget)
        addCustomerPhotos(active.id, group?.name || photoTarget, urls)
      }
      addToast(`已上傳 ${urls.length} 張照片`, 'ok')
    } catch (e) {
      console.error(e)
      addToast('照片讀取失敗', 'err')
    } finally {
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  const onSync = () => {
    if (!active) return
    if (!active.lines.length) {
      addToast('此連線尚無明細', 'err')
      return
    }
    const result = syncToShipping(active.id)
    addToast(result.message, result.ok ? 'ok' : 'err')
  }

  const onAddCustomer = () => {
    if (!active) return
    const name = window.prompt('客人名字', '')
    if (name == null) return
    const customerName = name.trim() || '未命名客人'
    appendLines(active.id, [
      {
        id: newLiveLineId(),
        customerName,
        productName: '',
        qty: 1,
        jpyUnit: 0,
        twdTotal: 0,
        deposit: 0,
      },
    ])
    setExpanded((prev) => new Set(prev).add(customerName.trim().toLowerCase() || '__empty__'))
  }

  const onAddLineToCustomer = (customerName: string, customerKey: string) => {
    if (!active) return
    appendLines(active.id, [
      {
        id: newLiveLineId(),
        customerName: customerName === '（未填名字）' ? '' : customerName,
        productName: '',
        qty: 1,
        jpyUnit: 0,
        twdTotal: 0,
        deposit: 0,
      },
    ])
    setExpanded((prev) => new Set(prev).add(customerKey))
  }

  const onDeleteSession = () => {
    if (!active) return
    if (!window.confirm(`確定刪除連線「${active.name}」？已同步的客單、出貨資料也會一併刪除。`)) return
    const next = sessions.find((s) => s.id !== active.id)
    const result = deleteSession(active.id)
    setActiveId(next?.id ?? null)
    addToast(result.message, 'info')
  }

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(customerGroups.map((g) => g.key)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="live-page mx-auto max-w-6xl px-3 pb-10 pt-2 sm:px-4">
      <PageHeader title="連線管理" subtitle="現場連線匯入 · 貨到付款 · 訂金尾款 · 同步出貨" />

      <section className="live-hero">
        <div>
          <h2>現場連線訂單</h2>
                  <p>
                    同名連線自動合併；客人多筆商品收成一張小卡，可展開編輯並同步出貨。
                  </p>
        </div>
        <div className="live-actions">
          <Btn variant="secondary" onClick={() => downloadLiveImportTemplateXlsx()}>
            <Download className="h-4 w-4" />
            下載範本
          </Btn>
          <Btn variant="secondary" onClick={() => excelRef.current?.click()}>
            <Upload className="h-4 w-4" />
            匯入 Excel
          </Btn>
          <Btn onClick={onCreate}>
            <Plus className="h-4 w-4" />
            新建連線
          </Btn>
        </div>
        <input
          ref={excelRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => void onImportExcel(e.target.files?.[0] ?? null)}
        />
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void onUploadPhotos(e.target.files)}
        />
      </section>

      {importMsg ? <p className="live-hint mb-3 !mt-0">{importMsg}</p> : null}

      {!sessions.length ? (
        <div className="live-empty live-panel">
          <Radio className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>尚無連線場次。請下載範本填寫後匯入，或先新建一場連線。</p>
        </div>
      ) : (
        <div className="live-layout">
          <aside className="live-session-list">
            {sessions.map((s) => {
              const t = liveSessionTotals(s)
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`live-session-item${active?.id === s.id ? ' is-active' : ''}`}
                  onClick={() => setActiveId(s.id)}
                >
                  <strong>{s.name}</strong>
                  <span>
                    {t.customers} 位 · {t.count} 列 · {money(t.twd)}
                    {s.syncedAt ? ` · 已同步 ${formatTime(s.syncedAt)}` : ' · 未同步'}
                  </span>
                </button>
              )
            })}
          </aside>

          {active && totals && cod ? (
            <div className="live-panel">
              <div className="live-panel-head">
                <div className="min-w-0">
                  <input
                    className="w-full max-w-md rounded-lg border border-[#d5dde5] bg-white px-3 py-2 text-sm font-bold text-[#2f3438]"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitSessionName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    aria-label="連線名稱"
                    title="改成既有同名連線時，會自動合併"
                  />
                  <p className="mt-1 text-xs text-[#7a868e]">
                    {active.syncedAt ? `上次同步：${formatTime(active.syncedAt)}` : '尚未同步到出貨物流'}
                    {` · ${totals.customers} 位客人`}
                    {' · 同名連線會自動合併'}
                  </p>
                </div>
                <div className="live-actions live-actions--panel">
                  <Btn variant="secondary" onClick={onAddCustomer}>
                    <Plus className="h-4 w-4" />
                    <span>新增客人</span>
                  </Btn>
                  <Btn variant="secondary" onClick={() => openPhotoPicker('session')}>
                    <ImagePlus className="h-4 w-4" />
                    <span>場次照片</span>
                  </Btn>
                  <Btn variant="secondary" onClick={() => exportLiveSessionXlsx(active.name, active.lines)}>
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>匯出</span>
                  </Btn>
                  <Btn onClick={onSync}>
                    <Truck className="h-4 w-4" />
                    <span className="live-sync-label-full">同步到出貨物流</span>
                    <span className="live-sync-label-short">同步出貨</span>
                  </Btn>
                  <Btn variant="danger" onClick={onDeleteSession}>
                    <Trash2 className="h-4 w-4" />
                    <span>刪除</span>
                  </Btn>
                </div>
              </div>

              <div className="live-panel-body">
                <div className="live-metrics">
                  <div className="live-metric live-metric--sky">
                    <p className="live-metric-label">台幣總額</p>
                    <p className="live-metric-value">{money(totals.twd)}</p>
                  </div>
                  <div className="live-metric live-metric--amber">
                    <p className="live-metric-label">已收訂金</p>
                    <p className="live-metric-value">{money(totals.deposit)}</p>
                  </div>
                  <div className="live-metric live-metric--cod">
                    <p className="live-metric-label">貨到待收（尾款）</p>
                    <p className="live-metric-value">{money(totals.cod)}</p>
                  </div>
                  <div className="live-metric live-metric--mint">
                    <p className="live-metric-label">客人 / 明細</p>
                    <p className="live-metric-value">
                      {totals.customers}
                      <span className="live-metric-sub"> / {totals.count}</span>
                    </p>
                  </div>
                </div>

                {active.photoUrls.length ? (
                  <div className="live-photos">
                    {active.photoUrls.map((url, i) => (
                      <div key={`${active.id}-p-${i}`} className="live-photo">
                        <img loading="lazy" decoding="async" src={url} alt={`連線照片 ${i + 1}`} />
                        <button
                          type="button"
                          className="live-photo-remove"
                          aria-label="移除照片"
                          onClick={() => removePhoto(active.id, i)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className="mb-3 block text-xs font-semibold text-[#5a646c]">
                  備註
                  <textarea
                    className="mt-1 w-full rounded-lg border border-[#d5dde5] bg-white px-3 py-2 text-sm"
                    rows={2}
                    value={active.notes}
                    onChange={(e) => updateSession(active.id, { notes: e.target.value })}
                    placeholder="例如：部分客人有訂金、取貨注意事項…"
                  />
                </label>

                {!customerGroups.length ? (
                  <div className="live-empty">此連線尚無明細，請匯入 Excel 或新增客人。</div>
                ) : (
                  <>
                    <div className="live-card-toolbar">
                      <p className="live-card-toolbar-label">客人小卡（{customerGroups.length}）</p>
                      <div className="live-actions">
                        <button type="button" className="live-text-btn" onClick={expandAll}>
                          全部展開
                        </button>
                        <button type="button" className="live-text-btn" onClick={collapseAll}>
                          全部收合
                        </button>
                      </div>
                    </div>

                    <div className="live-customer-cards">
                      {customerGroups.map((group) => {
                        const isOpen = expanded.has(group.key)
                        const photos = resolveCustomerPhotoUrls(active, group.key, group.name)
                        const thumb = photos[0]
                        return (
                          <article key={group.key} className={`live-customer-card${isOpen ? ' is-open' : ''}`}>
                            <div
                              className="live-customer-card-head"
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleExpand(group.key)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  toggleExpand(group.key)
                                }
                              }}
                            >
                              <div className="live-customer-card-thumb">
                                {thumb ? (
                                  <img loading="lazy" decoding="async" src={thumb} alt="" />
                                ) : (
                                  <span>{group.name.slice(0, 1) || '?'}</span>
                                )}
                              </div>
                              <div className="live-customer-card-summary min-w-0 flex-1">
                                <div className="live-customer-card-title-row">
                                  <strong className="live-customer-card-name">{group.name}</strong>
                                  {group.synced ? <span className="live-pill live-pill--ok">已同步</span> : null}
                                  {(group.deposit || 0) > 0 ? (
                                    <span className="live-pill live-pill--deposit">訂金+尾款</span>
                                  ) : (
                                    <span className="live-pill live-pill--cod">全額 COD</span>
                                  )}
                                </div>
                                <p className="live-customer-card-meta">
                                  {group.itemCount} 品項 · {group.qtyTotal} 件
                                  {!isOpen && group.deposit > 0 ? ` · 訂金 ${money(group.deposit)}` : ''}
                                </p>
                              </div>
                              <div className="live-customer-card-total">
                                <span className="live-customer-card-total-label">總金額</span>
                                <strong>{money(group.twd)}</strong>
                                {group.cod > 0 ? (
                                  <span className="live-customer-card-cod">尾款 {money(group.cod)}</span>
                                ) : null}
                              </div>
                              <ChevronDown
                                className={`live-customer-card-chevron${isOpen ? ' is-open' : ''}`}
                                aria-hidden
                              />
                            </div>

                            {isOpen ? (
                              <div className="live-customer-card-body" onClick={(e) => e.stopPropagation()}>
                                <div className="live-customer-card-tools">
                                  <label className="live-customer-name-field">
                                    <span>客人名字</span>
                                    <input
                                      value={group.name === '（未填名字）' ? '' : group.name}
                                      placeholder="輸入客人名字"
                                      onChange={(e) => {
                                        const nextName = e.target.value
                                        const nextKey = nextName.trim().toLowerCase() || '__empty__'
                                        renameCustomer(active.id, group.key, nextName)
                                        setExpanded((prev) => {
                                          const next = new Set(prev)
                                          if (next.has(group.key)) {
                                            next.delete(group.key)
                                            next.add(nextKey)
                                          }
                                          return next
                                        })
                                      }}
                                    />
                                  </label>
                                  <div className="live-actions">
                                    <Btn
                                      variant="secondary"
                                      className="!min-h-9 !py-1.5 !text-xs"
                                      onClick={() => openPhotoPicker(group.key)}
                                    >
                                      <ImagePlus className="h-3.5 w-3.5" />
                                      上傳圖片
                                    </Btn>
                                    <Btn
                                      variant="secondary"
                                      className="!min-h-9 !py-1.5 !text-xs"
                                      onClick={() => onAddLineToCustomer(group.name, group.key)}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      新增商品
                                    </Btn>
                                    <Btn
                                      variant="danger"
                                      className="!min-h-9 !py-1.5 !text-xs"
                                      onClick={() => {
                                        if (!window.confirm(`確定刪除客人「${group.name}」的全部明細？`)) return
                                        removeCustomer(active.id, group.key)
                                      }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      刪除客人
                                    </Btn>
                                  </div>
                                </div>

                                <div className="live-customer-totals-inline">
                                  <span>總金額 <strong>{money(group.twd)}</strong></span>
                                  <span>訂金 <strong>{money(group.deposit)}</strong></span>
                                  <span>尾款 COD <strong>{money(group.cod)}</strong></span>
                                </div>

                                {photos.length ? (
                                  <div className="live-photos live-photos--card">
                                    {photos.map((url, i) => (
                                      <div key={`${group.key}-p-${i}`} className="live-photo">
                                        <img loading="lazy" decoding="async" src={url} alt={`${group.name} 照片 ${i + 1}`} />
                                        <button
                                          type="button"
                                          className="live-photo-remove"
                                          aria-label="移除照片"
                                          onClick={() => removeCustomerPhoto(active.id, group.name, i)}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="live-customer-photo-hint">尚未上傳此客人的圖片</p>
                                )}

                                <div className="live-table-wrap live-desktop-only">
                                  <table className="live-table">
                                    <thead>
                                      <tr>
                                        <th>商品</th>
                                        <th>數量</th>
                                        <th>日幣單價</th>
                                        <th>台幣總額</th>
                                        <th>已收訂金</th>
                                        <th>尾款</th>
                                        <th />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.lines.map((line) => {
                                        const bal = liveLineBalance(line)
                                        return (
                                          <tr key={line.id}>
                                            <td>
                                              <input
                                                value={line.productName}
                                                onChange={(e) =>
                                                  updateLine(active.id, line.id, {
                                                    productName: e.target.value,
                                                  })
                                                }
                                              />
                                            </td>
                                            <td style={{ width: '4.5rem' }}>
                                              <input
                                                type="number"
                                                min={1}
                                                value={line.qty}
                                                onChange={(e) =>
                                                  updateLine(active.id, line.id, {
                                                    qty: Math.max(1, Number(e.target.value) || 1),
                                                  })
                                                }
                                              />
                                            </td>
                                            <td style={{ width: '5.5rem' }}>
                                              <input
                                                type="number"
                                                min={0}
                                                value={line.jpyUnit}
                                                onChange={(e) =>
                                                  updateLine(active.id, line.id, {
                                                    jpyUnit: Math.max(0, Number(e.target.value) || 0),
                                                  })
                                                }
                                              />
                                            </td>
                                            <td style={{ width: '5.5rem' }}>
                                              <input
                                                type="number"
                                                min={0}
                                                value={line.twdTotal}
                                                onChange={(e) =>
                                                  updateLine(active.id, line.id, {
                                                    twdTotal: Math.max(0, Number(e.target.value) || 0),
                                                  })
                                                }
                                              />
                                            </td>
                                            <td style={{ width: '5.5rem' }}>
                                              <input
                                                type="number"
                                                min={0}
                                                value={line.deposit}
                                                onChange={(e) => {
                                                  const deposit = Math.max(0, Number(e.target.value) || 0)
                                                  updateLine(active.id, line.id, {
                                                    deposit: Math.min(deposit, line.twdTotal || deposit),
                                                  })
                                                }}
                                              />
                                            </td>
                                            <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                                              {money(bal)}
                                            </td>
                                            <td>
                                              <button
                                                type="button"
                                                className="text-xs font-semibold text-[#9a3b3b]"
                                                onClick={() => removeLine(active.id, line.id)}
                                              >
                                                刪
                                              </button>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="live-line-cards live-mobile-only">
                                  {group.lines.map((line, lineIdx) => {
                                    const bal = liveLineBalance(line)
                                    return (
                                      <div key={line.id} className="live-line-card">
                                        <div className="live-line-card-head">
                                          <span>商品 {lineIdx + 1}</span>
                                          <button
                                            type="button"
                                            className="live-text-btn live-text-btn--danger"
                                            onClick={() => removeLine(active.id, line.id)}
                                          >
                                            刪除
                                          </button>
                                        </div>
                                        <label className="live-line-field live-line-field--full">
                                          <span>商品名稱</span>
                                          <input
                                            value={line.productName}
                                            onChange={(e) =>
                                              updateLine(active.id, line.id, {
                                                productName: e.target.value,
                                              })
                                            }
                                          />
                                        </label>
                                        <div className="live-line-grid">
                                          <label className="live-line-field">
                                            <span>數量</span>
                                            <input
                                              type="number"
                                              min={1}
                                              value={line.qty}
                                              onChange={(e) =>
                                                updateLine(active.id, line.id, {
                                                  qty: Math.max(1, Number(e.target.value) || 1),
                                                })
                                              }
                                            />
                                          </label>
                                          <label className="live-line-field">
                                            <span>日幣單價</span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={line.jpyUnit}
                                              onChange={(e) =>
                                                updateLine(active.id, line.id, {
                                                  jpyUnit: Math.max(0, Number(e.target.value) || 0),
                                                })
                                              }
                                            />
                                          </label>
                                          <label className="live-line-field">
                                            <span>台幣總額</span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={line.twdTotal}
                                              onChange={(e) =>
                                                updateLine(active.id, line.id, {
                                                  twdTotal: Math.max(0, Number(e.target.value) || 0),
                                                })
                                              }
                                            />
                                          </label>
                                          <label className="live-line-field">
                                            <span>已收訂金</span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={line.deposit}
                                              onChange={(e) => {
                                                const deposit = Math.max(0, Number(e.target.value) || 0)
                                                updateLine(active.id, line.id, {
                                                  deposit: Math.min(deposit, line.twdTotal || deposit),
                                                })
                                              }}
                                            />
                                          </label>
                                        </div>
                                        <p className="live-line-balance">
                                          尾款 <strong>{money(bal)}</strong>
                                        </p>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </>
                )}

                <p className="live-hint">
                  同一客人多筆商品會合併成一張小卡；收合時可看總金額，展開後可編輯明細與上傳圖片。
                  全額 COD {cod.pureCod} 列 · 有訂金 {cod.withDeposit} 列 · 訂金合計 {money(cod.depositSum)} · 待收尾款{' '}
                  {money(cod.codBalance)}。
                  {' '}
                  <Link className="font-semibold underline" to="/shipping" style={{ color: '#3d6f96' }}>
                    前往出貨物流
                  </Link>
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
