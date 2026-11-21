import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { V50_GROUP_STATUSES } from '../../modules/groupbuy/v50Utils'
import { openGroupDetailHref } from '../../pages/open-groups/openGroupImages'
import './GroupSetupModal.css'

export type GroupSetupFormValues = {
  name: string
  groupStatus: string
  closingDate: string
  saleEndDate: string
  purchaseDate: string
  officialShipDate: string
  orderNumber: string
  logisticsNumber: string
  cardPayNote: string
  jpyAmountTotal: string
  purchaseLink: string
  description: string
  imageUrls: string[]
  coverImageUrl: string
  remarks: string
}

export const emptyGroupSetupForm = (): GroupSetupFormValues => ({
  name: '',
  groupStatus: '已登記',
  closingDate: '',
  saleEndDate: '',
  purchaseDate: '',
  officialShipDate: '',
  orderNumber: '',
  logisticsNumber: '',
  cardPayNote: '',
  jpyAmountTotal: '',
  purchaseLink: '',
  description: '',
  imageUrls: [],
  coverImageUrl: '',
  remarks: '',
})

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (values: GroupSetupFormValues) => void
  initialValues?: GroupSetupFormValues | null
  title?: string
  /** 編輯既有團務時，提供前往開團專區的連結 */
  groupId?: string | null
}

function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={wide ? 'group-setup-field group-setup-field-wide' : 'group-setup-field'}>
      <span className="group-setup-label">{label}</span>
      {children}
    </label>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="group-setup-field">
      <span className="group-setup-label">{label}</span>
      <span className={`group-setup-date${value ? '' : ' is-empty'}`}>
        <span className="group-setup-date-text">{value || '年／月／日'}</span>
        <input
          type="date"
          className="group-setup-date-native"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
      </span>
    </label>
  )
}

export function GroupSetupModal({ open, onClose, onSubmit, initialValues, title, groupId }: Props) {
  const [form, setForm] = useState<GroupSetupFormValues>(emptyGroupSetupForm)

  useEffect(() => {
    if (open) setForm(initialValues ? { ...initialValues } : emptyGroupSetupForm())
    else setForm(emptyGroupSetupForm())
  }, [open, initialValues])

  function patch<K extends keyof GroupSetupFormValues>(key: K, value: GroupSetupFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="group-setup"
          className="group-setup-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-setup-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button type="button" className="absolute inset-0 cursor-default" aria-label="關閉" onClick={onClose} />
          <motion.div
            className="group-setup-card relative z-10"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="group-setup-head">
              <h2 id="group-setup-title" className="group-setup-title">
                {title || '設定開團資訊'}
              </h2>
              <button type="button" className="group-setup-close" onClick={onClose} aria-label="關閉">
                ✕
              </button>
            </div>

            <form className="group-setup-form" onSubmit={handleSubmit}>
              <Field label="團務名稱" wide>
                <input
                  className="group-setup-input"
                  placeholder="例：鬼滅之刃 2026 春團"
                  value={form.name}
                  onChange={(e) => patch('name', e.target.value)}
                  required
                />
              </Field>

              <Field label="團務狀況" wide>
                <select
                  className="group-setup-input"
                  value={form.groupStatus}
                  onChange={(e) => patch('groupStatus', e.target.value)}
                >
                  {V50_GROUP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="group-setup-row group-setup-row-dates">
                <DateField label="結單日期" value={form.closingDate} onChange={(v) => patch('closingDate', v)} />
                <DateField label="結束販賣日" value={form.saleEndDate} onChange={(v) => patch('saleEndDate', v)} />
              </div>

              <div className="group-setup-row group-setup-row-dates">
                <DateField label="購買日期" value={form.purchaseDate} onChange={(v) => patch('purchaseDate', v)} />
                <Field label="官方出貨日">
                  <input
                    className="group-setup-input group-setup-input-date"
                    placeholder="例：7月下旬、未定"
                    value={form.officialShipDate}
                    onChange={(e) => patch('officialShipDate', e.target.value)}
                  />
                </Field>
              </div>

              <div className="group-setup-row">
                <Field label="信用卡資訊">
                  <input
                    className="group-setup-input"
                    placeholder="卡名或尾碼四碼"
                    value={form.cardPayNote}
                    onChange={(e) => patch('cardPayNote', e.target.value)}
                  />
                </Field>
                <Field label="日幣預算總額">
                  <input
                    type="number"
                    min={0}
                    className="group-setup-input"
                    placeholder="¥"
                    value={form.jpyAmountTotal}
                    onChange={(e) => patch('jpyAmountTotal', e.target.value)}
                  />
                </Field>
              </div>

              <Field label="網站連結" wide>
                <input
                  type="url"
                  className="group-setup-input"
                  placeholder="https:// 官方商品頁"
                  value={form.purchaseLink}
                  onChange={(e) => patch('purchaseLink', e.target.value)}
                />
              </Field>

              {groupId ? (
                <div className="group-setup-open-link-wrap">
                  <p className="group-setup-open-link-hint">
                    團務說明與照片請至開團專區編輯。場販開團不會進入團務管理。
                  </p>
                  <Link
                    to={`${openGroupDetailHref(groupId)}?manage=1&edit=1`}
                    className="group-setup-open-link"
                    onClick={onClose}
                  >
                    前往開團專區編輯此團 →
                  </Link>
                </div>
              ) : null}

              <Field label="備註" wide>
                <textarea
                  className="group-setup-input group-setup-textarea"
                  placeholder="開團專區／團務小卡顯示的備註"
                  rows={2}
                  value={form.remarks}
                  onChange={(e) => patch('remarks', e.target.value)}
                />
              </Field>

              <button type="submit" className="group-setup-submit">
                {groupId ? '儲存團務設定' : '建立團務專案'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
