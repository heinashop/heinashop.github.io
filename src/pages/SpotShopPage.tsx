import { useMemo, useState } from 'react'
import { Globe, Minus, Plus, Search, Store } from 'lucide-react'
import { Card, Btn, PageHeader, Chip, Modal, Empty } from '../components/ui'
import { useDaigouStore } from '../daigou/store'
import { useApi } from '../context/useApi'
import { SPOT_STATUS_LABEL } from '../daigou/constants'
import type { SpotListingStatus, SpotProduct } from '../daigou/types'
import { downloadCsv } from '../daigou/csv'

function chipTone(st: SpotListingStatus): 'neutral' | 'ok' | 'warn' | 'bad' | 'info' {
  if (st === 'on_sale') return 'ok'
  if (st === 'paused') return 'warn'
  return 'bad'
}

export function SpotShopPage() {
  const api = useApi()
  const spotProducts = useDaigouStore((s) => s.spotProducts)
  const addSpotProduct = useDaigouStore((s) => s.addSpotProduct)
  const updateSpotProduct = useDaigouStore((s) => s.updateSpotProduct)
  const adjustSpotStock = useDaigouStore((s) => s.adjustSpotStock)
  const addToast = useDaigouStore((s) => s.addToast)
  const [publishing, setPublishing] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | 'all'>('all')
  const [stFilter, setStFilter] = useState<SpotListingStatus | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<SpotProduct>>({
    name: '',
    imageUrl: 'https://picsum.photos/seed/spotnew/240/240',
    sku: '',
    category: '徽章',
    twdPrice: 299,
    stockQty: 5,
    status: 'on_sale',
    shelfCode: '',
    notes: '',
  })

  const categories = useMemo(() => {
    const u = new Set(spotProducts.map((p) => p.category))
    return ['all', ...Array.from(u)]
  }, [spotProducts])

  const filtered = useMemo(() => {
    return spotProducts.filter((p) => {
      const hay = `${p.name}${p.sku}${p.shelfCode}${p.category}`.toLowerCase()
      const okQ = !q || hay.includes(q.toLowerCase())
      const okC = cat === 'all' || p.category === cat
      const okS = stFilter === 'all' || p.status === stFilter
      return okQ && okC && okS
    })
  }, [spotProducts, q, cat, stFilter])

  async function publishToStorefront() {
    setPublishing(true)
    try {
      const res = await api.call<{ ok: boolean; count: number }>({
        module: 'storefront',
        action: 'publishCatalog',
        payload: { products: spotProducts },
      })
      addToast(`已發布 ${res.count} 筆現貨至官網（試算表／本機目錄）`, 'ok')
    } catch (e) {
      addToast(e instanceof Error ? e.message : '發布失敗', 'err')
    } finally {
      setPublishing(false)
    }
  }

  function exportCsv() {
    const rows: (string | number)[][] = [
      ['品名', 'SKU', '分類', '台幣售價', '庫存', '狀態', '倉位', '備註'],
      ...filtered.map((p) => [
        p.name,
        p.sku,
        p.category,
        p.twdPrice,
        p.stockQty,
        SPOT_STATUS_LABEL[p.status],
        p.shelfCode,
        p.notes,
      ]),
    ]
    downloadCsv('現貨商城.csv', rows)
    addToast('已匯出現貨清單', 'ok')
  }

  function submit() {
    if (!form.name?.trim()) {
      addToast('請填品名', 'err')
      return
    }
    addSpotProduct({
      name: form.name!,
      imageUrl: form.imageUrl || '',
      sku: form.sku || `SPOT-${Date.now()}`,
      category: form.category || '其他',
      twdPrice: Number(form.twdPrice) || 0,
      stockQty: Number(form.stockQty) || 0,
      status: (form.status as SpotListingStatus) || 'on_sale',
      shelfCode: form.shelfCode || '—',
      notes: form.notes || '',
    })
    setOpen(false)
    setForm({
      name: '',
      imageUrl: 'https://picsum.photos/seed/spotnew/240/240',
      sku: '',
      category: '徽章',
      twdPrice: 299,
      stockQty: 5,
      status: 'on_sale',
      shelfCode: '',
      notes: '',
    })
  }

  return (
    <div>
      <PageHeader
        title="現貨商城"
        subtitle="與團購／預購分開：台幣標價、庫存與倉位一併管理，可同步官網或 LINE 賣場"
        action={
          <>
            <Btn variant="secondary" disabled={publishing} onClick={() => void publishToStorefront()}>
              <Globe className="h-4 w-4" />
              {publishing ? '發布中…' : '發布至官網'}
            </Btn>
            <Btn variant="secondary" onClick={exportCsv}>
              匯出 CSV
            </Btn>
            <Btn onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              上架現貨
            </Btn>
          </>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 border-indigo-100 bg-indigo-50/40 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
          <Store className="h-5 w-5" />
        </div>
        <p className="text-sm leading-relaxed text-indigo-950/80">
          此區為<strong className="font-semibold">現貨 SKU</strong>。按「發布至官網」後，顧客於 GAS 網址 <code className="rounded bg-white/80 px-1">#/shop</code> 可見上架品項。團務商品請至「商品」頁。
        </p>
      </Card>

      <Card className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="w-full rounded-xl border border-zinc-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="搜尋品名、SKU、倉位、分類…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium"
          value={cat}
          onChange={(e) => setCat(e.target.value as 'all' | string)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? '全部分類' : c}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium"
          value={stFilter}
          onChange={(e) => setStFilter(e.target.value as SpotListingStatus | 'all')}
        >
          <option value="all">全部狀態</option>
          {(Object.keys(SPOT_STATUS_LABEL) as SpotListingStatus[]).map((k) => (
            <option key={k} value={k}>
              {SPOT_STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </Card>

      {filtered.length === 0 ? (
        <Empty title="沒有符合的現貨" hint="上架第一筆現貨商品，或調整篩選條件。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <div className="flex gap-3">
                <img loading="lazy" decoding="async" src={p.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-semibold text-zinc-900">{p.name}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">{p.sku}</p>
                  <p className="mt-1 text-lg font-bold text-indigo-700">NT$ {p.twdPrice.toLocaleString()}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Chip tone={chipTone(p.status)}>{SPOT_STATUS_LABEL[p.status]}</Chip>
                    <Chip tone="neutral">庫存 {p.stockQty}</Chip>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                倉位 <span className="font-semibold text-zinc-700">{p.shelfCode}</span>
                {p.notes ? <span className="ml-2">· {p.notes}</span> : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                <Btn variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => adjustSpotStock(p.id, 1)}>
                  <Plus className="h-3.5 w-3.5" />
                  入庫 +1
                </Btn>
                <Btn variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => adjustSpotStock(p.id, -1)}>
                  <Minus className="h-3.5 w-3.5" />
                  出庫 −1
                </Btn>
                <select
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-2 text-xs font-semibold"
                  value={p.status}
                  onChange={(e) => updateSpotProduct(p.id, { status: e.target.value as SpotListingStatus })}
                >
                  {(Object.keys(SPOT_STATUS_LABEL) as SpotListingStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {SPOT_STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title="上架現貨" onClose={() => setOpen(false)}>
        <div className="max-h-[75vh] space-y-3 overflow-y-auto text-sm">
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">品名</span>
            <input className="mt-1 w-full rounded-xl border px-3 py-2" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">圖片 URL</span>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">SKU</span>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">分類</span>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">台幣售價</span>
              <input
                type="number"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={form.twdPrice}
                onChange={(e) => setForm((f) => ({ ...f, twdPrice: Number(e.target.value) }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">庫存</span>
              <input
                type="number"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={form.stockQty}
                onChange={(e) => setForm((f) => ({ ...f, stockQty: Number(e.target.value) }))}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">倉位</span>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.shelfCode}
              onChange={(e) => setForm((f) => ({ ...f, shelfCode: e.target.value }))}
              placeholder="例：B-03"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">上架狀態</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as SpotListingStatus }))}
            >
              {(Object.keys(SPOT_STATUS_LABEL) as SpotListingStatus[]).map((k) => (
                <option key={k} value={k}>
                  {SPOT_STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">備註</span>
            <textarea className="mt-1 w-full rounded-xl border px-3 py-2" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <Btn className="w-full" onClick={submit}>
            確認上架
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
