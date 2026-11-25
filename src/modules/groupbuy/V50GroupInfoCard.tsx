import { Link } from 'react-router-dom'
import type { GroupBuyGroup } from '../../api/types'
import { openGroupManageHref } from '../../pages/open-groups/openGroupsUtils'
import { isPortalListed } from './groupLifecycle'
import { formatYmd, groupJpyDisplay, groupHasUnpaidOrders, groupOrderCount, normalizeGroupStatus } from './v50Utils'
import './v50GroupCard.css'

type Props = {
  group: GroupBuyGroup
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}

function dash(v: string | undefined) {
  const s = String(v || '').trim()
  return s || '—'
}

function showDate(v: string | undefined) {
  return dash(formatYmd(v))
}

export function V50GroupInfoCard({ group, onOpen, onEdit, onDelete }: Props) {
  const hasUnpaid = groupHasUnpaidOrders(group)
  const status = normalizeGroupStatus(group.status)
  const listed = isPortalListed(group)

  return (
    <article className="v50-gcard">
      {hasUnpaid ? <div className="v50-gcard-pay-alert">待付款</div> : null}
      <div className="v50-gcard-head">
        <div className="v50-gcard-head-tags">
          <span className={`v50-gcard-status v50-gcard-status--${status}`}>{status}</span>
          {listed ? <span className="v50-gcard-ops-badge">開團專區</span> : null}
        </div>
        <div className="v50-gcard-actions">
          <Link
            to={openGroupManageHref(group.id)}
            className="v50-gcard-jump"
            onClick={(e) => e.stopPropagation()}
          >
            開團
          </Link>
          <button type="button" className="v50-gcard-edit-btn" onClick={onEdit}>
            編輯
          </button>
          <button type="button" className="v50-gcard-delete" onClick={onDelete}>
            刪除
          </button>
        </div>
      </div>
      <button type="button" className="v50-gcard-body" onClick={onOpen}>
        <h3 className="v50-gcard-title">{group.name}</h3>
        <div className="v50-gcard-grid">
          <div className="v50-gcard-field">
            <span className="v50-gcard-label">結單日期</span>
            <span className="v50-gcard-value">{showDate(group.closingDate)}</span>
          </div>
          <div className="v50-gcard-field">
            <span className="v50-gcard-label">結束販賣日</span>
            <span className="v50-gcard-value">{showDate(group.saleEndDate)}</span>
          </div>
          <div className="v50-gcard-field">
            <span className="v50-gcard-label">購買日期</span>
            <span className="v50-gcard-value">{showDate(group.purchaseDate)}</span>
          </div>
          <div className="v50-gcard-field">
            <span className="v50-gcard-label">官方出貨日</span>
            <span className="v50-gcard-value">{showDate(group.officialShipDate)}</span>
          </div>
          <div className="v50-gcard-field v50-gcard-field-wide">
            <span className="v50-gcard-label">信用卡資訊</span>
            <span className="v50-gcard-value">{dash(group.creditCard)}</span>
          </div>
          <div className="v50-gcard-field v50-gcard-field-wide">
            <span className="v50-gcard-label">備註</span>
            <span className="v50-gcard-value">{dash(group.remarks)}</span>
          </div>
          <div className="v50-gcard-field v50-gcard-field-wide">
            <span className="v50-gcard-label">網站連結</span>
            {group.purchaseLink?.trim() ? (
              <a
                href={group.purchaseLink}
                className="v50-gcard-link"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {group.purchaseLink}
              </a>
            ) : (
              <span className="v50-gcard-value">—</span>
            )}
          </div>
        </div>
        <div className="v50-gcard-foot">
          <span>日幣採購總額 {groupJpyDisplay(group)}</span>
          <span>客訂 {groupOrderCount(group)} 筆</span>
        </div>
      </button>
    </article>
  )
}
