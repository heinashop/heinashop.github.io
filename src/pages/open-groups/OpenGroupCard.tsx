import { Link } from 'react-router-dom'
import type { PublicGroupCatalogItem } from '../../api/types'
import { formatYmd, normalizeGroupStatus } from '../../modules/groupbuy/v50Utils'
import { isInGroupOps, isMailOrderChannel } from '../../modules/groupbuy/groupLifecycle'
import { normalizeGroupImageUrls, openGroupDetailHref } from './openGroupImages'
import { groupOpsHref } from './openGroupsUtils'
import { GroupImageSwipe } from './GroupImageSwipe'

function dash(v: string | undefined) {
  const s = String(v || '').trim()
  return s || '—'
}

type Props = {
  group: PublicGroupCatalogItem
  highlighted?: boolean
  showEditAction?: boolean
  /** 後台：顧客專區首頁釘選 */
  pinned?: boolean
  pinDisabled?: boolean
  onTogglePin?: () => void
  /** 首頁橫滑預覽：較小卡片 */
  compact?: boolean
}

export function OpenGroupCard({
  group,
  highlighted,
  showEditAction,
  pinned,
  pinDisabled,
  onTogglePin,
  compact,
}: Props) {
  const status = normalizeGroupStatus(group.status)
  const images = normalizeGroupImageUrls(group.imageUrls, group.coverImageUrl)
  const detailHref = showEditAction
    ? `${openGroupDetailHref(group.id)}?manage=1`
    : openGroupDetailHref(group.id)
  const editHref = `${openGroupDetailHref(group.id)}?manage=1&edit=1`

  return (
    <article
      className={
        'og-card-wrap' +
        (highlighted ? ' og-card-wrap--highlight' : '') +
        (pinned ? ' og-card-wrap--pinned' : '') +
        (compact ? ' og-card-wrap--compact' : '')
      }
      id={`og-${group.id}`}
    >
      <Link to={detailHref} className={'og-card og-card-link' + (compact ? ' og-card--compact' : '')}>
        <div className="og-card-media">
          <GroupImageSwipe
            images={images}
            emptyLabel={group.name.charAt(0) || '團'}
            size="card"
            imgClassName="og-card-photo"
          />
          {pinned ? <span className="og-card-pin-badge">首頁釘選</span> : null}
        </div>
        <div className="og-card-body">
          <div className="og-card-head">
            <h3 className="og-card-title">{group.name}</h3>
            <div className="og-card-head-tags">
              <span className={'og-card-status og-card-status--' + status}>{status}</span>
              {group.channel === '場販' || group.channel === '通販' ? (
                <span
                  className={
                    group.channel === '場販'
                      ? 'og-card-channel og-card-channel--venue'
                      : 'og-card-channel og-card-channel--mail'
                  }
                >
                  {group.channel}
                </span>
              ) : null}
              {showEditAction && isMailOrderChannel(group) ? (
                <span
                  className={
                    'og-card-lifecycle' +
                    (group.opsActive === false ? ' og-card-lifecycle--preview' : ' og-card-lifecycle--formed')
                  }
                >
                  {group.opsActive === false ? '預告' : '已成團'}
                </span>
              ) : null}
            </div>
          </div>
          <dl className="og-card-meta">
            <div>
              <dt>結單日期</dt>
              <dd>{dash(formatYmd(group.closingDate))}</dd>
            </div>
            <div>
              <dt>官方出貨日</dt>
              <dd>{dash(formatYmd(group.officialShipDate))}</dd>
            </div>
          </dl>
          {!compact && group.remarks ? (
            <p className="og-card-remarks">
              <span className="og-card-remarks-label">備註</span>
              {group.remarks}
            </p>
          ) : null}
          <p className="og-card-more">查看完整說明 →</p>
        </div>
      </Link>
      {showEditAction || onTogglePin ? (
        <div className="og-card-foot-actions">
          {onTogglePin ? (
            <button
              type="button"
              className={'og-card-pin' + (pinned ? ' is-on' : '')}
              disabled={pinDisabled && !pinned}
              onClick={(e) => {
                e.preventDefault()
                onTogglePin()
              }}
            >
              {pinned ? '取消首頁釘選' : '釘選至顧客首頁'}
            </button>
          ) : null}
          {showEditAction ? (
            <div className="og-card-foot-links">
              {isInGroupOps(group) && !compact ? (
                <Link to={groupOpsHref(group.id)} className="og-card-ops-jump">
                  團務
                </Link>
              ) : null}
              <Link to={editHref} className="og-card-edit">
                編輯此小卡
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
