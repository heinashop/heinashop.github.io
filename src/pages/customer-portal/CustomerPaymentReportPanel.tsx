import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Group, Order } from '../../daigou/types'
import type { SharedCustomerBalanceMemo, SubmitCustomerPaymentReportResult } from '../../api/types'
import { useApi } from '../../context/useApi'
import { useDaigouStore } from '../../daigou/store'
import { setCustomerPaymentFormDirty } from './customerFormGuard'
import {
  collectOpenMemosForCustomerName,
  formatMemoAmount,
  memoAdjustAmount,
  sumSelectedMemoAdjust,
} from '../../daigou/customerBalanceMemo'
import { openSharedBalanceMemosForName } from '../../daigou/portalLookupSync'
import { formatTwd } from './portalUtils'
import { isValidPaymentLastFive, parsePaymentTotalAmount, sumSelectedDeposits } from './customerPaymentReport'
import { dueDepositAmount } from '../staffLookup/previewUtils'

type Props = {
  customerName: string
  lookupPin: string
  orders: Order[]
  groupsById: Map<string, Group>
  onSubmitted?: () => void
}

type SelectableMemo = { id: string; amountTwd: number }

const PAYMENT_REPORT_SUCCESS_TITLE = '付款回報已送出'
const PAYMENT_REPORT_SUCCESS_BODY =
  '將於 2-5 天內完成對帳並更新付款狀態。'
const PAYMENT_REPORT_SUCCESS_FOOTER = '若超過期限仍未更新，請私訊官方。'

function orderDepositLabel(order: Order, group?: Group) {
  const groupName = group?.name?.trim() || '—'
  const code = order.lookupCode?.trim() || order.id
  const deposit = dueDepositAmount(order)
  return { groupName, code, deposit }
}

export function CustomerPaymentReportPanel({
  customerName,
  lookupPin,
  orders,
  groupsById,
  onSubmitted,
}: Props) {
  const api = useApi()
  const customers = useDaigouStore((s) => s.customers)
  const [sharedMemos, setSharedMemos] = useState<SelectableMemo[]>([])

  const localMemos = useMemo(
    () =>
      collectOpenMemosForCustomerName(customers, customerName).map((x) => ({
        id: x.memo.id,
        amountTwd: memoAdjustAmount(x.memo),
      })),
    [customers, customerName],
  )

  useEffect(() => {
    let cancelled = false
    if (!customerName.trim() || !/^\d{4}$/.test(lookupPin)) {
      setSharedMemos([])
      return
    }
    void api
      .call<{ ok?: boolean; memos?: SharedCustomerBalanceMemo[] }>({
        module: 'groupbuy',
        action: 'customerBalanceMemos',
        payload: { customerName, lookupPin },
      })
      .then((data) => {
        if (cancelled) return
        const list = openSharedBalanceMemosForName(data.memos, customerName).map((m) => ({
          id: m.id,
          amountTwd: Number(m.amountTwd) || 0,
        }))
        setSharedMemos(list)
      })
      .catch(() => {
        if (!cancelled) setSharedMemos([])
      })
    return () => {
      cancelled = true
    }
  }, [api, customerName, lookupPin])

  const openMemos = useMemo(() => {
    const map = new Map<string, SelectableMemo>()
    for (const m of [...sharedMemos, ...localMemos]) {
      if (!m.id) continue
      map.set(m.id, m)
    }
    return [...map.values()]
  }, [sharedMemos, localMemos])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(orders.map((o) => o.id)))
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set(openMemos.map((m) => m.id)))
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lastFive, setLastFive] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [toast, setToast] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const submitKeyRef = useRef('')
  const initialDateRef = useRef(paymentDate)
  const userTouchedRef = useRef(false)
  const amountTouchedRef = useRef(false)

  const ordersKey = orders.map((o) => o.id).join('|')
  useEffect(() => {
    if (userTouchedRef.current) return
    setSelectedIds(new Set(orders.map((o) => o.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersKey])

  const openMemoIdsKey = openMemos.map((m) => m.id).join('|')
  useEffect(() => {
    if (userTouchedRef.current) return
    setSelectedMemoIds(new Set(openMemos.map((m) => m.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMemoIdsKey])

  const formDirty =
    userTouchedRef.current ||
    amountTouchedRef.current ||
    selectedIds.size !== orders.length ||
    selectedMemoIds.size !== openMemos.length ||
    lastFive.trim() !== '' ||
    paymentDate !== initialDateRef.current
  useEffect(() => {
    setCustomerPaymentFormDirty(formDirty)
    return () => setCustomerPaymentFormDirty(false)
  }, [formDirty])

  const memoAdjust = useMemo(
    () => sumSelectedMemoAdjust(openMemos, selectedMemoIds),
    [openMemos, selectedMemoIds],
  )

  const autoTotal = useMemo(
    () => Math.max(0, sumSelectedDeposits(orders, selectedIds) + memoAdjust),
    [orders, selectedIds, memoAdjust],
  )

  useEffect(() => {
    if (amountTouchedRef.current) return
    setTotalAmount(String(autoTotal))
  }, [autoTotal])

  const totalValue = parsePaymentTotalAmount(totalAmount)
  const canSubmit =
    selectedIds.size > 0 &&
    paymentDate.trim() !== '' &&
    isValidPaymentLastFive(lastFive) &&
    totalValue > 0 &&
    !submitting

  function toggleOrder(id: string) {
    userTouchedRef.current = true
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    userTouchedRef.current = true
    setSelectedIds(checked ? new Set(orders.map((o) => o.id)) : new Set())
  }

  function toggleMemo(id: string) {
    userTouchedRef.current = true
    setSelectedMemoIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function closeSuccessModal() {
    setSuccessModalOpen(false)
    submitKeyRef.current = ''
    userTouchedRef.current = false
    amountTouchedRef.current = false
    setLastFive('')
    setTotalAmount(String(autoTotal))
    initialDateRef.current = paymentDate
    setCustomerPaymentFormDirty(false)
    onSubmitted?.()
  }

  async function handleSubmit() {
    if (!canSubmit) return
    if (!submitKeyRef.current) {
      submitKeyRef.current = `cpr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    setSubmitting(true)
    setToast('')
    try {
      const balanceMemos = openMemos
        .filter((m) => selectedMemoIds.has(m.id))
        .map((m) => ({
          id: m.id,
          amountTwd: m.amountTwd,
        }))
      const res = await api.call<SubmitCustomerPaymentReportResult>({
        module: 'groupbuy',
        action: 'submitPaymentReport',
        payload: {
          customerName: customerName.trim(),
          remittanceDate: paymentDate,
          lastFive: lastFive.trim(),
          totalAmount: totalValue,
          orderIds: [...selectedIds],
          balanceMemos,
          clientRequestId: submitKeyRef.current,
        },
      })
      if (!res.ok) {
        setToast(res.message || '送出失敗，請稍後再試')
        window.setTimeout(() => setToast(''), 4000)
      } else {
        setSuccessModalOpen(true)
      }
    } catch (e) {
      console.error(e)
      setToast(e instanceof Error ? e.message : '送出失敗，請稍後再試')
      window.setTimeout(() => setToast(''), 4000)
    } finally {
      setSubmitting(false)
    }
  }

  const allSelected = orders.length > 0 && selectedIds.size === orders.length

  return (
    <section className="lk-pay-report" aria-label="付款回報">
      <div className="lk-pay-report-head">
        <h3 className="lk-pay-report-title">付款回報</h3>
        <p className="lk-pay-report-desc">勾選本次已匯款的待付訂單，填寫匯款資訊後按「確認付款」送出給團主核對。</p>
        <p className="lk-pay-report-tip" role="note">
          <strong>可合併付款：</strong>
          1 個月內結單的商品可勾選多筆一起匯款，總金額會自動加總後一次回報。
        </p>
      </div>

      <div className="lk-pay-report-orders">
        <div className="lk-pay-report-orders-head">
          <span className="lk-pay-report-label">勾選待付訂單</span>
          <label className="lk-pay-report-select-all">
            <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
            全選
          </label>
        </div>
        <ul className="lk-pay-report-order-list">
          {orders.map((o) => {
            const { groupName, code, deposit } = orderDepositLabel(o, groupsById.get(o.groupId))
            const checked = selectedIds.has(o.id)
            return (
              <li key={o.id}>
                <label className={'lk-pay-report-order-row' + (checked ? ' is-checked' : '')}>
                  <input type="checkbox" checked={checked} onChange={() => toggleOrder(o.id)} />
                  <span className="lk-pay-report-order-main">
                    <strong>{groupName}</strong>
                    <span className="lk-pay-report-order-code">{code}</span>
                  </span>
                  <span className="lk-pay-report-order-deposit">訂金 {formatTwd(deposit)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      {openMemos.length > 0 ? (
        <div className="lk-pay-report-memos">
          <div className="lk-pay-report-orders-head">
            <span className="lk-pay-report-label">帳務備註（可勾選一併結清）</span>
          </div>
          <ul className="lk-pay-report-order-list">
            {openMemos.map((memo) => {
              const amt = memo.amountTwd
              const checked = selectedMemoIds.has(memo.id)
              return (
                <li key={memo.id}>
                  <label className={'lk-pay-report-order-row' + (checked ? ' is-checked' : '')}>
                    <input type="checkbox" checked={checked} onChange={() => toggleMemo(memo.id)} />
                    <span className="lk-pay-report-order-main">
                      <strong>帳務備註</strong>
                      <span className="lk-pay-report-order-code">
                        {amt > 0 ? '待補款' : amt < 0 ? '可折抵' : '—'}
                      </span>
                    </span>
                    <span
                      className={
                        'lk-pay-report-order-deposit' +
                        (amt > 0 ? ' lk-pay-report-memo--plus' : amt < 0 ? ' lk-pay-report-memo--minus' : '')
                      }
                    >
                      {formatMemoAmount(amt)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {memoAdjust !== 0 ? (
            <p className="lk-pay-report-memo-sum">
              帳務調整 {formatMemoAmount(memoAdjust)}
              {selectedIds.size > 0 ? ` → 建議匯款 ${formatTwd(autoTotal)}` : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="lk-pay-report-fields lk-pay-report-fields--3">
        <label className="lk-pay-report-field">
          <span className="lk-pay-report-label">匯款日期</span>
          <input
            type="date"
            className="lk-pay-report-input"
            value={paymentDate}
            onChange={(e) => {
              userTouchedRef.current = true
              setPaymentDate(e.target.value)
            }}
          />
        </label>
        <label className="lk-pay-report-field">
          <span className="lk-pay-report-label">後五碼</span>
          <input
            type="text"
            className="lk-pay-report-input"
            inputMode="numeric"
            maxLength={5}
            placeholder="例：12345"
            value={lastFive}
            onChange={(e) => {
              userTouchedRef.current = true
              setLastFive(e.target.value.replace(/\D/g, '').slice(0, 5))
            }}
            autoComplete="off"
          />
        </label>
        <label className="lk-pay-report-field">
          <span className="lk-pay-report-label">總金額</span>
          <input
            type="number"
            className="lk-pay-report-input"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="0"
            value={totalAmount}
            onChange={(e) => {
              userTouchedRef.current = true
              amountTouchedRef.current = true
              setTotalAmount(e.target.value)
            }}
          />
        </label>
      </div>

      {selectedIds.size === 0 ? <p className="lk-pay-report-hint">請至少勾選一筆待付訂單</p> : null}
      {!canSubmit && lastFive.length > 0 && lastFive.length < 5 ? (
        <p className="lk-pay-report-hint">後五碼需為 5 位數字</p>
      ) : null}

      <button type="button" className="lk-pay-report-copy" disabled={!canSubmit} onClick={() => void handleSubmit()}>
        {submitting ? '送出中…' : '確認付款'}
      </button>

      {toast ? (
        <p className="lk-pay-report-toast" role="status">
          {toast}
        </p>
      ) : null}

      {successModalOpen
        ? createPortal(
            <div
              className="lk-pay-report-modal-backdrop"
              role="presentation"
              onClick={() => closeSuccessModal()}
            >
              <div
                className="lk-pay-report-modal"
                role="dialog"
                aria-modal="true"
                aria-label="付款回報已送出"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="lk-pay-report-modal-title">{PAYMENT_REPORT_SUCCESS_TITLE}</h4>
                <p className="lk-pay-report-modal-body">{PAYMENT_REPORT_SUCCESS_BODY}</p>
                <p className="lk-pay-report-modal-body lk-pay-report-modal-body--footer">
                  {PAYMENT_REPORT_SUCCESS_FOOTER}
                </p>
                <button type="button" className="lk-pay-report-modal-btn" onClick={() => closeSuccessModal()}>
                  知道了
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
