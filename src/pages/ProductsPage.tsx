import { useMemo, useState } from 'react'
import { Copy, Plus, Search } from 'lucide-react'
import { Card, Btn, PageHeader, Chip, Modal, Empty } from '../components/ui'
import { useDaigouStore } from '../daigou/store'
import { PRODUCT_STATUS_LABEL } from '../daigou/constants'
import type { Product, ProductStatus } from '../daigou/types'
import { standardTwd, BLIND_PRESET_TWD, a4ClearfileTwd, posterOverA4Twd, figureTwd } from '../daigou/logic/pricing'
import { downloadCsv } from '../daigou/csv'

type Preset = 'standard' | keyof typeof BLIND_PRESET_TWD | 'a4' | 'poster' | 'figure'

export function ProductsPage() {
  const products = useDaigouStore((s) => s.products)
  const groups = useDaigouStore((s) => s.groups)
  const settings = useDaigouStore((s) => s.settings)
  const addProduct = useDaigouStore((s) => s.addProduct)
  const updateProduct = useDaigouStore((s) => s.updateProduct)
  const duplicateProduct = useDaigouStore((s) => s.duplicateProduct)
  const addToast = useDaigouStore((s) => s.addToast)
  const [q, setQ] = useState('')
  const [gid, setGid] = useState<string | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>('standard')
  const [openedMode, setOpenedMode] = useState<'opened' | 'unopened'>('unopened')
  const [form, setForm] = useState<Partial<Product>>({
    name: '',
    imageUrl: 'https://picsum.photos/seed/newp/200/200',
    category: '週邊',
    ipSeries: '',
    jpyPrice: 1100,
    twdPrice: 0,
    exchangeMultiplier: settings.defaultExchangeRate,
    isBlindBox: false,
    canOpenBlindBox: false,
    openingFee: 0,
    stockQty: 20,
    preorderQty: 0,
    limitPerCustomer: 5,
    status: 'available',
    groupId: groups[0]?.id,
  })

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const okQ =
        !q ||
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        p.ipSeries.toLowerCase().includes(q.toLowerCase()) ||
        p.category.includes(q)
      const okG = gid === 'all' || p.groupId === gid
      return okQ && okG
    })
  }, [products, q, gid])

  function applyPreset() {
    const jpy = Number(form.jpyPrice) || 0
    const rate = settings.defaultExchangeRate
    let twd = standardTwd(jpy, rate)
    if (preset === 'standard') {
      twd = standardTwd(jpy, rate)
    } else if (preset === 'a4') {
      twd = a4ClearfileTwd(jpy)
    } else if (preset === 'poster') {
      twd = posterOverA4Twd(jpy)
    } else if (preset === 'figure') {
      twd = figureTwd(jpy)
    } else if (preset in BLIND_PRESET_TWD) {
      const row = BLIND_PRESET_TWD[preset as keyof typeof BLIND_PRESET_TWD]
      twd = openedMode === 'opened' ? row.opened : row.unopened
    }
    setForm((f) => ({ ...f, twdPrice: twd, exchangeMultiplier: rate }))
    addToast(`已套用報價：TWD ${twd}`, 'ok')
  }

  function submit() {
    if (!form.name?.trim()) {
      addToast('請填商品名稱', 'err')
      return
    }
    const rate = settings.defaultExchangeRate
    const twd = form.twdPrice || standardTwd(Number(form.jpyPrice) || 0, rate)
    addProduct({
      name: form.name!,
      imageUrl: form.imageUrl || '',
      category: form.category || '週邊',
      ipSeries: form.ipSeries || '',
      jpyPrice: Number(form.jpyPrice) || 0,
      twdPrice: twd,
      exchangeMultiplier: Number(form.exchangeMultiplier) || rate,
      isBlindBox: !!form.isBlindBox,
      canOpenBlindBox: !!form.canOpenBlindBox,
      openingFee: Number(form.openingFee) || 0,
      stockQty: Number(form.stockQty) || 0,
      preorderQty: Number(form.preorderQty) || 0,
      limitPerCustomer: Number(form.limitPerCustomer) || 1,
      status: (form.status as ProductStatus) || 'available',
      groupId: form.groupId,
    })
    setOpen(false)
  }

  function exportCsv() {
    const rows: (string | number)[][] = [
      ['商品名稱', '分類', 'IP', 'JPY', 'TWD', '庫存', '預購量', '狀態', '團 ID'],
      ...filtered.map((p) => [
        p.name,
        p.category,
        p.ipSeries,
        p.jpyPrice,
        p.twdPrice,
        p.stockQty,
        p.preorderQty,
        PRODUCT_STATUS_LABEL[p.status],
        p.groupId ?? '',
      ]),
    ]
    downloadCsv('商品列表.csv', rows)
    addToast('已匯出商品 CSV', 'ok')
  }

  return (
    <div>
      <PageHeader
        title="商品／預購品項"
        subtitle="匯率換算、盲盒與紙類報價助手"
        action={
          <>
            <Btn variant="secondary" onClick={exportCsv}>
              匯出 CSV
            </Btn>
            <Btn onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              新增商品
            </Btn>
          </>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="w-full rounded-xl border border-zinc-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="搜尋品名、IP、分類…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium"
          value={gid}
          onChange={(e) => setGid(e.target.value as 'all' | string)}
        >
          <option value="all">全部團別</option>
          {groups.map((gr) => (
            <option key={gr.id} value={gr.id}>
              {gr.name}
            </option>
          ))}
        </select>
      </Card>

      {filtered.length === 0 ? (
        <Empty title="沒有符合的商品" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <div className="flex gap-3">
                <img loading="lazy" decoding="async" src={p.imageUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-semibold text-zinc-900">{p.name}</p>
                  <p className="text-xs text-zinc-500">
                    {p.ipSeries} · {p.category}
                  </p>
                  <p className="mt-1 text-sm font-bold text-indigo-700">
                    ¥{p.jpyPrice} → NT${p.twdPrice}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2">
                <Chip tone={p.status === 'sold_out' ? 'bad' : p.status === 'low_stock' ? 'warn' : 'ok'}>
                  {PRODUCT_STATUS_LABEL[p.status]}
                </Chip>
                <Btn variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => duplicateProduct(p.id)}>
                  <Copy className="h-3.5 w-3.5" />
                  複製
                </Btn>
                <select
                  className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-semibold"
                  value={p.status}
                  onChange={(e) => updateProduct(p.id, { status: e.target.value as ProductStatus })}
                >
                  {(Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {PRODUCT_STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title="新增商品" onClose={() => setOpen(false)}>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto text-sm">
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">品名</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">圖片 URL</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">分類</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">IP／系列</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
                value={form.ipSeries}
                onChange={(e) => setForm((f) => ({ ...f, ipSeries: e.target.value }))}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">所屬團</span>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={form.groupId}
              onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
            >
              {groups.map((gr) => (
                <option key={gr.id} value={gr.id}>
                  {gr.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">日幣參考價 JPY</span>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={form.jpyPrice}
              onChange={(e) => setForm((f) => ({ ...f, jpyPrice: Number(e.target.value) }))}
            />
          </label>
          <div className="rounded-xl bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-600">報價助手</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="flex-1 rounded-lg border border-zinc-200 px-2 py-2 text-xs"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
              >
                <option value="standard">標準 JPY×匯率</option>
                <option value="jpy110">盲盒 ¥110 表</option>
                <option value="jpy154">盲盒 ¥154 表</option>
                <option value="jpy165">盲盒 ¥165 表</option>
                <option value="jpy200_220">盲盒 ¥200–220 表</option>
                <option value="jpy275">盲盒 ¥275 表</option>
                <option value="wafer_snack">威化＋小卡</option>
                <option value="a4">A4 資料夾公式</option>
                <option value="poster">大海報公式</option>
                <option value="figure">公仔公式</option>
              </select>
              {preset in BLIND_PRESET_TWD ? (
                <select
                  className="rounded-lg border border-zinc-200 px-2 py-2 text-xs"
                  value={openedMode}
                  onChange={(e) => setOpenedMode(e.target.value as 'opened' | 'unopened')}
                >
                  <option value="unopened">未拆價</option>
                  <option value="opened">已拆價</option>
                </select>
              ) : null}
              <Btn variant="secondary" className="!py-2 text-xs" type="button" onClick={applyPreset}>
                套用至 TWD
              </Btn>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">預設匯率取自設定：{settings.defaultExchangeRate}</p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">台幣售價 TWD</span>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={form.twdPrice}
              onChange={(e) => setForm((f) => ({ ...f, twdPrice: Number(e.target.value) }))}
            />
          </label>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!form.isBlindBox} onChange={(e) => setForm((f) => ({ ...f, isBlindBox: e.target.checked }))} />
              盲盒
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!form.canOpenBlindBox}
                onChange={(e) => setForm((f) => ({ ...f, canOpenBlindBox: e.target.checked }))}
              />
              可代拆
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs text-zinc-500">庫存</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border px-2 py-2"
                value={form.stockQty}
                onChange={(e) => setForm((f) => ({ ...f, stockQty: Number(e.target.value) }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">預購</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border px-2 py-2"
                value={form.preorderQty}
                onChange={(e) => setForm((f) => ({ ...f, preorderQty: Number(e.target.value) }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">每人上限</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border px-2 py-2"
                value={form.limitPerCustomer}
                onChange={(e) => setForm((f) => ({ ...f, limitPerCustomer: Number(e.target.value) }))}
              />
            </label>
          </div>
          <Btn className="w-full" onClick={submit}>
            建立商品
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
