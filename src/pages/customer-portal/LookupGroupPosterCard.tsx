import { Link } from 'react-router-dom'
import type { PublicGroupCatalogItem } from '../../api/types'
import { formatYmd, normalizeGroupStatus } from '../../modules/groupbuy/v50Utils'
import { normalizeGroupImageUrls, openGroupDetailHref } from '../open-groups/openGroupImages'
import { GroupImageSwipe } from '../open-groups/GroupImageSwipe'

function dash(v: string | undefined) {
  const s = String(v || '').trim()
  return s || '—'
}

type Props = {
  group: PublicGroupCatalogItem
  /** 首頁釘選標記（可選） */
  pinned?: boolean
}

/** 顧客首頁預覽卡：直向海報＋狀態標籤＋結單／出貨日並排（與開團專區小卡一致） */
export function LookupGroupPosterCard({ group, pinned }: Props) {
  const status = normalizeGroupStatus(group.status)
  const images = normalizeGroupImageUrls(group.imageUrls, group.coverImageUrl)
  const channel = group.channel === '場販' || group.channel === '通販' ? group.channel : null

  return (
    <Link to={openGroupDetailHref(group.id)} className="lk-poster-card lk-poster-card--detail">
      <div className="lk-poster-media">
        <GroupImageSwipe
          images={images}
          emptyLabel={group.name.charAt(0) || '團'}
          size="card"
          imgClassName="lk-poster-img"
        />
        {pinned ? <span className="lk-poster-pin">首頁釘選</span> : null}
      </div>
      <div className="lk-poster-body">
        <div className="lk-poster-head">
          <strong className="lk-poster-title">{group.name}</strong>
          <div className="lk-poster-tags">
            <span className={'lk-poster-status lk-poster-status--' + status}>{status}</span>
            {channel ? (
              <span
                className={
                  channel === '場販' ? 'lk-poster-channel lk-poster-channel--venue' : 'lk-poster-channel lk-poster-channel--mail'
                }
              >
                {channel}
              </span>
            ) : null}
          </div>
        </div>
        <dl className="lk-poster-meta">
          <div>
            <dt>結單日期</dt>
            <dd>{dash(formatYmd(group.closingDate))}</dd>
          </div>
          <div>
            <dt>官方出貨日</dt>
            <dd>{dash(formatYmd(group.officialShipDate))}</dd>
          </div>
        </dl>
      </div>
    </Link>
  )
}
