import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Btn, Empty, PageHeader } from '../components/ui'
import { PageLayout } from '../components/app/PageLayout'
import { useApi } from '../context/useApi'
import type { GroupBuyAppData, GroupBuyGroup } from '../api/types'
import { groupOrderCount, normalizeGroupStatus } from '../modules/groupbuy/v50Utils'
import {
  countExpectedInboundThisMonth,
  formatYearMonthLabel,
  listInboundForMonth,
  parseYearMonthKey,
  shiftYearMonth,
  ymFromDate,
  yearMonthKey,
  type InboundMonthLists,
  type YearMonth,
} from '../modules/groupbuy/inboundMonthLogic'
import './inboundMonthPage.css'

const SECTIONS: {
  key: keyof Pick<InboundMonthLists, 'expected' | 'inWarehouse' | 'leftWarehouse' | 'overdue' | 'unset'>
  title: string
  hint: string
}[] = [
  { key: 'expected', title: '預計進倉', hint: '官方這個月該寄出，團務尚未到集運倉' },
  { key: 'inWarehouse', title: '已在日本倉', hint: '狀態已是已集運' },
  { key: 'leftWarehouse', title: '已離倉／抵台', hint: '這個月官方出貨、但已抵台或已結束' },
  { key: 'overdue', title: '逾期未進倉', hint: '官方出貨月已過，仍停在下單或官方已發貨前' },
  { key: 'unset', title: '出貨月未填', hint: '官方出貨日空白或寫未定，無法對月份' },
]

function dash(v?: string) {
  const s = String(v || '').trim()
  return s || '—'
}

function GroupRow({ group }: { group: GroupBuyGroup }) {
  const orders = groupOrderCount(group)
  return (
    <Link className="inbound-row" to={`/groups?group=${encodeURIComponent(group.id)}`}>
      <div className="inbound-row-main">
        <p className="inbound-row-name">{group.name || '未命名團務'}</p>
        <p className="inbound-row-meta">
          官方出貨 {dash(group.officialShipDate)}
          {group.logisticsId ? ` · 物流 ${group.logisticsId}` : ''}
          {orders ? ` · 客訂 ${orders}` : ''}
        </p>
      </div>
      <span className="inbound-row-status">{normalizeGroupStatus(group.status)}</span>
    </Link>
  )
}

export function InboundMonthPage() {
  const api = useApi()
  const [searchParams, setSearchParams] = useSearchParams()
  const todayYm = useMemo(() => ymFromDate(), [])
  const ym: YearMonth = parseYearMonthKey(searchParams.get('ym')) || todayYm

  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupBuyGroup[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.call<GroupBuyAppData>({ module: 'groupbuy', action: 'getAppData' })
      setGroups(data.groups || [])
    } catch (e) {
      console.error(e)
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const lists = useMemo(() => listInboundForMonth(groups, ym, todayYm), [groups, ym, todayYm])
  const watchCount = lists.expected.length + lists.overdue.length
  const thisMonthWatch = useMemo(() => countExpectedInboundThisMonth(groups, todayYm), [groups, todayYm])
  const isCurrent = yearMonthKey(ym) === yearMonthKey(todayYm)

  function setYm(next: YearMonth) {
    setSearchParams({ ym: yearMonthKey(next) }, { replace: true })
  }

  return (
    <PageLayout>
      <div className="inbound-page">
        <PageHeader
          title="本月進倉"
          subtitle="依官方出貨月份，查看哪些通販團這個月該寄到日本倉庫。點團名可回團務管理。"
          action={
            <>
              <Btn variant="secondary" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" />
                重新載入
              </Btn>
              <Btn variant="secondary" to="/consolidation">
                集運
              </Btn>
            </>
          }
        />

        <div className="inbound-month-bar">
          <button type="button" className="inbound-month-nav" onClick={() => setYm(shiftYearMonth(ym, -1))} aria-label="上個月">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="inbound-month-label">
            <Building2 className="h-4 w-4" />
            <span>{formatYearMonthLabel(ym)}</span>
          </div>
          <button type="button" className="inbound-month-nav" onClick={() => setYm(shiftYearMonth(ym, 1))} aria-label="下個月">
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isCurrent ? (
            <button type="button" className="inbound-month-today" onClick={() => setYm(todayYm)}>
              回到本月
            </button>
          ) : null}
        </div>

        <div className="inbound-summary">
          <p>
            {isCurrent ? '本月' : formatYearMonthLabel(ym)}
            預計進倉 <strong>{lists.expected.length}</strong>
            {lists.overdue.length ? (
              <>
                {' '}
                · 逾期 <strong>{lists.overdue.length}</strong>
              </>
            ) : null}
            {isCurrent ? null : (
              <>
                {' '}
                · 這個月待進倉 {thisMonthWatch}
              </>
            )}
          </p>
          <p className="inbound-summary-hint">
            「抵達倉庫」指日本集運倉，不是抵台。已集運＝貨已在倉；已抵台／已結束＝已離開這段。
          </p>
        </div>

        {loading ? <p className="inbound-loading">載入中…</p> : null}

        {!loading && watchCount === 0 && lists.inWarehouse.length === 0 && lists.leftWarehouse.length === 0 && lists.unset.length === 0 ? (
          <Empty title="這個月沒有對得到官方出貨月的團" hint="可按左右切換月份。官方出貨日寫 2026/10 或 2027/02月也會歸到該月。" />
        ) : null}

        {SECTIONS.map((sec) => {
          const rows = lists[sec.key]
          if (!rows.length) return null
          return (
            <section key={sec.key} className="inbound-section">
              <div className="inbound-section-head">
                <h2>
                  {sec.title}
                  <span>{rows.length}</span>
                </h2>
                <p>{sec.hint}</p>
              </div>
              <div className="inbound-list">
                {rows.map((g) => (
                  <GroupRow key={g.id} group={g} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </PageLayout>
  )
}
