import type { UnifiedClient } from '../api/client'
import type {
  CustomerLookupMatch,
  GroupBuyAppData,
  GroupBuySavePayload,
  SaveBankJournalPayload,
  ConfirmPaymentReportPayload,
  DeletePaymentReportPayload,
  LedgerAddTxBody,
  LedgerItem,
  LedgerSettings,
  LedgerTrip,
  LedgerTx,
  PreorderGroup,
  PreorderLookupMatch,
  PublicSpotProduct,
  SubmitCustomerPaymentReportPayload,
  SupplementPaymentReportPayload,
  UpdatePaymentReportLineFlagsPayload,
  RevertPaymentReportPayload,
  UnifiedRequest,
} from '../api/types'
import type { SpotProduct } from '../daigou/types'
import { useDaigouStore } from '../daigou/store'
import {
  lookupNameKey,
  upsertPortalLookupPin,
  validateChangeLookupPin,
  verifyLookupAccess,
} from '../daigou/portalLookupAuth'
import { openSharedBalanceMemosForName } from '../daigou/portalLookupSync'
import {
  authorizeCustomerLookupQuery,
  orderMatchesAuthorizedNames,
} from '../daigou/portalCustomerLookupMatch'
import { KEYS, loadJson, saveJson } from './mockStorage'
import { mergeGroupBuyAppData } from './groupbuyMockMerge'
import {
  applyConfirmPaymentReport,
  applyDeletePaymentReport,
  applyRevertPaymentReport,
  applySupplementPaymentReport,
  applyUpdatePaymentReportLineFlags,
  createPaymentReport,
  validateSubmitPaymentReport,
} from '../modules/groupbuy/paymentReportLogic'
import { upsertJournalRows } from '../modules/groupbuy/journalLogic'
import { listPortalCatalogGroups } from '../pages/open-groups/openGroupsUtils'
import { normalizeGroupImageUrls } from '../pages/open-groups/openGroupImages'
import { agentLog } from '../debug/agentLog'
import { demoPreorderGroups } from '../modules/preorder/demoPreorderSeed'
import {
  applyDataPackToAppData,
  buildHeinaDataPackFromAppData,
  normalizePackPayload,
  summarizeDataPack,
} from '../daigou/heinaDataPack'
import {
  defaultBankViewerConfig,
  mergeBankViewerSave,
  normalizeBankViewerConfig,
  stripBankViewerForPublic,
  verifyBankViewerAccess,
  type BankViewerConfig,
} from '../modules/bank-viewer/bankViewerLogic'
import {
  DEFAULT_ANNOUNCEMENTS,
  FAQ_ITEMS,
  PROCESS_STEPS,
} from '../pages/customer-portal/staticContent'

const defaultPortal = {
  title: 'Heina訂單自助查詢',
  intro: '輸入社群暱稱即可查詢訂單狀態與付款資訊。',
  websiteUrl: '',
  groupUrl: '',
  extraNote: '付款後請回傳後五碼；金額疑問請先聯絡代購主再匯款。',
  lookupDesc: '請輸入在社群裡的名字。若有改名或無法查詢請私訊官方 LINE。查單密碼為 4 位數字，可自行修改。',
  announcements: DEFAULT_ANNOUNCEMENTS,
  faqItems: FAQ_ITEMS,
  processSteps: PROCESS_STEPS,
}

function gbDefault(): GroupBuyAppData & { bankViewerFull?: BankViewerConfig } {
  return {
    groups: [],
    bankJournal: [],
    exchangeRate: 0.22,
    portalConfig: { ...defaultPortal },
    paymentReports: [],
    bankViewerFull: defaultBankViewerConfig(),
  }
}

function loadGroupBuyStored() {
  const raw = loadJson(KEYS.groupbuy, gbDefault()) as GroupBuyAppData & { bankViewerFull?: BankViewerConfig }
  const merged = mergeGroupBuyAppData(raw)
  const bankViewerFull = normalizeBankViewerConfig(raw.bankViewerFull)
  return { ...merged, bankViewerFull }
}

function toPublicGroupBuyData(data: ReturnType<typeof loadGroupBuyStored>): GroupBuyAppData {
  const { bankViewerFull, ...rest } = data
  return {
    ...rest,
    bankViewer: stripBankViewerForPublic(bankViewerFull),
  }
}

/** 寫回 localStorage 時保留 bankViewerFull（明文密碼不可被一般 saveAppData 沖掉） */
function persistGroupBuy(next: Record<string, unknown>) {
  const prev = loadGroupBuyStored()
  const bankViewerFull =
    next.bankViewerFull !== undefined
      ? normalizeBankViewerConfig(next.bankViewerFull)
      : prev.bankViewerFull
  const { bankViewer: _publicMeta, ...rest } = next as { bankViewer?: unknown }
  void _publicMeta
  saveJson(KEYS.groupbuy, { ...prev, ...rest, bankViewerFull })
}

function ledgerDefaultSettings(): LedgerSettings {
  return {
    defaultCurrency: 'JPY',
    defaultPayMethod: '現金',
    defaultPersonalCategory: '購物',
    confirmBeforeDelete: '開',
    autoClearAfterSave: '開',
  }
}

function preorderDefault(): PreorderGroup[] {
  return demoPreorderGroups()
}

function uuid() {
  return 'm_' + Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function spotToPublic(p: SpotProduct | PublicSpotProduct): PublicSpotProduct {
  return {
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    sku: p.sku,
    category: p.category,
    twdPrice: p.twdPrice,
    stockQty: p.stockQty,
    status: p.status,
    notes: p.notes,
  }
}

export function createMockClient(): UnifiedClient {
  return {
    async call<T>(req: UnifiedRequest): Promise<T> {
      const { module, action, payload } = req
      // #region agent log
      agentLog({
        runId: 'baseline',
        hypothesisId: 'H2',
        location: 'mock.ts:call',
        message: 'mock unifiedApi',
        data: { module, action, hasPayload: payload !== undefined },
      })
      // #endregion

      if (module === 'groupbuy') {
        if (action === 'getAppData') {
          const data = toPublicGroupBuyData(loadGroupBuyStored())
          const scope = String((payload as { groupScope?: string } | undefined)?.groupScope || 'all')
          if (scope === 'all') return data as T
          const ended = data.groups.filter((g) => g.status === '已結束')
          const groups = scope === 'ended' ? ended : data.groups.filter((g) => g.status !== '已結束')
          return { ...data, groups, endedGroupCount: ended.length } as T
        }
        if (action === 'publicBootstrap') {
          const data = loadGroupBuyStored()
          return { ok: true, bankViewer: stripBankViewerForPublic(data.bankViewerFull) } as T
        }
        if (action === 'customerBalanceMemos') {
          const pl = payload as { customerName?: string; lookupPin?: string }
          const data = mergeGroupBuyAppData(loadGroupBuyStored())
          const auth = verifyLookupAccess(pl?.customerName ?? '', pl?.lookupPin ?? '', data.portalLookupCustomers)
          if (!auth.ok) return { ok: false, message: auth.error, memos: [] } as T
          return {
            ok: true,
            memos: openSharedBalanceMemosForName(data.customerBalanceMemos, pl?.customerName ?? ''),
          } as T
        }
        if (action === 'getBankViewerAdmin') {
          const data = loadGroupBuyStored()
          return { ok: true, config: data.bankViewerFull } as T
        }
        if (action === 'saveBankViewer') {
          const pl = payload as {
            enabled?: boolean
            bankInfo?: string
            newPassword?: string
            clearLogs?: boolean
          }
          const data = loadGroupBuyStored()
          const next = mergeBankViewerSave(data.bankViewerFull, pl || {})
          persistGroupBuy({ ...data, bankViewerFull: next })
          return { ok: true, message: '已儲存銀行帳號查詢設定', config: next } as T
        }
        if (action === 'verifyBankViewerAccess') {
          const pl = payload as { accessPassword?: string; password?: string; customerName?: string }
          const data = loadGroupBuyStored()
          const result = verifyBankViewerAccess(data.bankViewerFull, pl || {})
          persistGroupBuy({ ...data, bankViewerFull: result.nextConfig })
          return {
            ok: result.ok,
            message: result.message,
            bankInfo: result.bankInfo,
          } as T
        }
        if (action === 'exportDataPack') {
          const data = loadGroupBuyStored()
          const publicData = toPublicGroupBuyData(data)
          const extra = [
            {
              key: 'bankViewerJson',
              value: JSON.stringify(data.bankViewerFull),
            },
          ]
          const pack = buildHeinaDataPackFromAppData(publicData, 'mock', extra)
          return { ok: true, pack, message: '已匯出資料包' } as T
        }
        if (action === 'importDataPack') {
          const pl = payload as {
            mode?: 'replace' | 'merge'
            pack?: unknown
            sheets?: Array<'訂單明細' | '銀行日記帳' | '系統設定'>
          }
          const pack = normalizePackPayload(pl?.pack)
          if (!pack) return { ok: false, message: '資料包格式無效' } as T
          const mode = pl.mode === 'merge' ? 'merge' : 'replace'
          const existing = loadGroupBuyStored()
          const publicExisting = toPublicGroupBuyData(existing)
          const nextPublic = applyDataPackToAppData(publicExisting, pack, mode, pl.sheets)
          let bankViewerFull = existing.bankViewerFull
          const kv = pack.settingsRows || []
          for (const row of kv) {
            if (String(row[0]) === 'bankViewerJson' && row[1]) {
              try {
                bankViewerFull = normalizeBankViewerConfig(JSON.parse(String(row[1])))
              } catch {
                /* keep */
              }
            }
          }
          persistGroupBuy({
            ...nextPublic,
            bankViewerFull,
          })
          const counts = summarizeDataPack(pack)
          return {
            ok: true,
            message: mode === 'replace' ? '已覆蓋匯入資料包' : '已合併匯入資料包',
            counts: {
              orderRows: counts.orderDataRows,
              journalRows: counts.journalDataRows,
              settingsRows: counts.settingsDataRows,
            },
          } as T
        }
        if (action === 'syncPortalLookupCustomers') {
          const pl = payload as {
            portalLookupCustomers?: GroupBuyAppData['portalLookupCustomers']
            customerBalanceMemos?: GroupBuyAppData['customerBalanceMemos']
          }
          const existing = loadGroupBuyStored()
          persistGroupBuy({
            ...mergeGroupBuyAppData(existing),
            portalLookupCustomers: pl.portalLookupCustomers ?? [],
            customerBalanceMemos: pl.customerBalanceMemos ?? existing.customerBalanceMemos ?? [],
            bankViewerFull: existing.bankViewerFull,
          })
          return { status: 'success', count: pl.portalLookupCustomers?.length ?? 0 } as T
        }
        if (action === 'changeLookupPin') {
          const pl = payload as {
            customerName?: string
            currentPin?: string
            newPin?: string
            confirmPin?: string
          }
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const check = validateChangeLookupPin(
            pl.customerName ?? '',
            pl.currentPin ?? '',
            pl.newPin ?? '',
            pl.confirmPin ?? '',
            data.portalLookupCustomers,
          )
          if (!check.ok || !check.lookupPin) {
            return { ok: false, message: check.message } as T
          }
          const q = lookupNameKey(pl.customerName ?? '')
          const nextPortal = upsertPortalLookupPin(data.portalLookupCustomers, q, check.lookupPin)
          persistGroupBuy({ ...data, portalLookupCustomers: nextPortal })
          // 同步更新代購後台客人列表
          const store = useDaigouStore.getState()
          const matched = store.customers.filter(
            (c) =>
              lookupNameKey(c.name) === q || lookupNameKey(c.lineDisplayName) === q,
          )
          if (matched.length) {
            useDaigouStore.setState({
              customers: store.customers.map((c) =>
                lookupNameKey(c.name) === q || lookupNameKey(c.lineDisplayName) === q
                  ? { ...c, lookupPin: check.lookupPin }
                  : c,
              ),
            })
          }
          return { ok: true, message: check.message, lookupPin: check.lookupPin } as T
        }
        if (action === 'saveAppData') {
          const p = payload as GroupBuySavePayload
          const existing = loadGroupBuyStored()
          persistGroupBuy({
            groups: p.groups,
            bankJournal: existing.bankJournal || [],
            exchangeRate: p.exchangeRate,
            portalConfig: { ...defaultPortal, ...p.portalConfig },
            paymentReports: p.paymentReports ?? existing.paymentReports ?? [],
            portalLookupCustomers:
              p.portalLookupCustomers ?? existing.portalLookupCustomers ?? [],
            customerBalanceMemos:
              p.customerBalanceMemos ?? existing.customerBalanceMemos ?? [],
            consolidationShipments:
              p.consolidationShipments ?? existing.consolidationShipments ?? [],
            bankViewerFull: existing.bankViewerFull,
          })
          return { status: 'success' } as T
        }
        if (action === 'saveBankJournal') {
          const p = payload as SaveBankJournalPayload
          const existing = loadGroupBuyStored()
          const incoming = p.bankJournal || []
          const next =
            p.mode === 'upsert'
              ? upsertJournalRows(existing.bankJournal || [], incoming)
              : incoming
          persistGroupBuy({ ...existing, bankJournal: next })
          return { status: 'success', bankJournal: next } as T
        }
        if (action === 'submitPaymentReport') {
          const pl = payload as SubmitCustomerPaymentReportPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const reports = data.paymentReports ?? []
          const check = validateSubmitPaymentReport(data.groups || [], reports, pl)
          if (!check.ok) {
            return { ok: false, message: check.message } as T
          }
          const report = createPaymentReport(pl, check.lines)
          persistGroupBuy( { ...data, paymentReports: [report, ...reports] })
          return {
            ok: true,
            reportId: report.id,
            message:
              '付款回報已送出\n將於 2-5 天內完成對帳並更新付款狀態。若超過期限仍未更新，請私訊官方。',
          } as T
        }
        if (action === 'confirmPaymentReport') {
          const pl = payload as ConfirmPaymentReportPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const reports = data.paymentReports ?? []
          const idx = reports.findIndex((r) => r.id === pl.reportId && r.status === 'pending')
          if (idx < 0) {
            return { ok: false, message: '找不到待確認的付款回報' } as T
          }
          const pending = reports[idx]
          const applied = applyConfirmPaymentReport(
            data.groups || [],
            data.bankJournal || [],
            pending,
            String(pl.remittanceBank || '待分類'),
            pl.lineDeposits,
            pl.selectedOrderIds,
          )
          let nextReports = reports.filter((_, i) => i !== idx)
          nextReports = [applied.report, ...nextReports]
          if (applied.pendingFollowUp) {
            nextReports = [applied.pendingFollowUp, ...nextReports]
          }
          persistGroupBuy( {
            ...data,
            groups: applied.groups,
            bankJournal: applied.bankJournal,
            paymentReports: nextReports,
          })
          return { ok: true, message: '已確認付款' } as T
        }
        if (action === 'updatePaymentReportLineFlags') {
          const pl = payload as UpdatePaymentReportLineFlagsPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const reports = applyUpdatePaymentReportLineFlags(
            data.paymentReports ?? [],
            pl.reportId,
            pl.orderId,
            pl.needsSupplement,
          )
          persistGroupBuy( { ...data, paymentReports: reports })
          return { ok: true, message: '已更新' } as T
        }
        if (action === 'supplementPaymentReport') {
          const pl = payload as SupplementPaymentReportPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const applied = applySupplementPaymentReport(
            data.groups || [],
            data.bankJournal || [],
            data.paymentReports ?? [],
            pl.reportId,
            pl.orderId,
            pl.amount,
            String(pl.remittanceDate || new Date().toISOString().slice(0, 10)),
            String(pl.remittanceBank || '待分類'),
            pl.note,
          )
          if (!applied.ok) {
            return { ok: false, message: applied.message } as T
          }
          persistGroupBuy( {
            ...data,
            groups: applied.groups,
            bankJournal: applied.bankJournal,
            paymentReports: applied.reports,
          })
          return { ok: true, message: '補款已入帳' } as T
        }
        if (action === 'deletePaymentReport') {
          const pl = payload as DeletePaymentReportPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const reports = data.paymentReports ?? []
          const applied = applyDeletePaymentReport(data.groups || [], data.bankJournal || [], reports, pl.reportId)
          if (!applied.ok) {
            return { ok: false, message: applied.message } as T
          }
          persistGroupBuy( {
            ...data,
            groups: applied.groups,
            bankJournal: applied.bankJournal,
            paymentReports: applied.reports,
          })
          return { ok: true, message: '已刪除付款回報' } as T
        }
        if (action === 'revertPaymentReport') {
          const pl = payload as RevertPaymentReportPayload
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const reports = data.paymentReports ?? []
          const idx = reports.findIndex((r) => r.id === pl.reportId && r.status === 'confirmed')
          if (idx < 0) {
            return { ok: false, message: '找不到已確認的付款回報' } as T
          }
          const applied = applyRevertPaymentReport(data.groups || [], data.bankJournal || [], reports[idx])
          const nextReports = reports.map((r, i) => (i === idx ? applied.report : r))
          persistGroupBuy( {
            ...data,
            groups: applied.groups,
            bankJournal: applied.bankJournal,
            paymentReports: nextReports,
          })
          return { ok: true, message: '已返回待確認' } as T
        }
        if (action === 'customerLookup') {
          const pl = payload as { customerName?: string; lookupPin?: string }
          const q = lookupNameKey(pl?.customerName ?? '')
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const portalConfig = { ...defaultPortal, ...data.portalConfig }
          if (!q) return { portalConfig, matches: [] } as T

          const phoneHints = useDaigouStore.getState().customers.map((c) => ({
            name: c.name,
            lineDisplayName: c.lineDisplayName,
            phoneLast3: c.phoneLast3,
          }))
          const auth = authorizeCustomerLookupQuery(
            q,
            pl?.lookupPin ?? '',
            data.groups || [],
            data.portalLookupCustomers,
            phoneHints,
          )
          if (!auth.ok) {
            return { portalConfig, matches: [], lookupError: auth.error } as T
          }

          const matches: CustomerLookupMatch[] = []
          for (const g of data.groups || []) {
            for (const o of g.orders || []) {
              if (!orderMatchesAuthorizedNames(o.customerName, auth.authorizedNames)) continue
              matches.push({
                groupId: g.id,
                groupName: g.name,
                groupStatus: g.status,
                closingDate: g.closingDate,
                saleEndDate: g.saleEndDate,
                officialShipDate: g.officialShipDate,
                purchaseLink: g.purchaseLink || '',
                groupOrderId: String(g.orderId || ''),
                logisticsId: String(g.logisticsId || ''),
                description: String(g.description || ''),
                coverImageUrl: String(g.coverImageUrl || ''),
                imageUrls: normalizeGroupImageUrls(g.imageUrls, g.coverImageUrl),
                remarks: String(g.remarks || ''),
                order: {
                  id: o.id,
                  customerName: o.customerName,
                  totalTwd: o.totalTwd,
                  deposit: o.deposit,
                  domesticShip: o.domesticShip,
                  intlShip: o.intlShip,
                  balance: o.balance,
                  paymentStatus: o.paymentStatus,
                  paymentInfo: o.paymentInfo,
                  items: o.items || [],
                },
              })
            }
          }
          return { portalConfig, matches } as T
        }
        if (action === 'listPublicGroups') {
          const data = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const groups = listPortalCatalogGroups(data.groups || [])
          const homeOpenGroupIds = (data.portalConfig?.homeOpenGroupIds || [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
            .slice(0, 3)
          return { groups, homeOpenGroupIds } as T
        }
      }

      if (module === 'ledger') {
        type LState = {
          trips: LedgerTrip[]
          transactions: LedgerTx[]
          items: LedgerItem[]
          settings: LedgerSettings
          /** per clientId → current trip id */
          currentTripByClient?: Record<string, string>
          /** 每裝置僅自動種入一次示範分錄（避免使用者刪光後又被加回） */
          demoLedgerSeeded?: Record<string, boolean>
        }
        const state = (): LState =>
          loadJson<LState>(KEYS.ledger, {
            trips: [],
            transactions: [],
            items: [],
            settings: ledgerDefaultSettings(),
            currentTripByClient: {},
            demoLedgerSeeded: {},
          })

        const write = (s: LState) => saveJson(KEYS.ledger, s)

        if (action === 'getInitData') {
          const clientId = String((payload as { clientId?: string })?.clientId || '')
          if (!clientId) throw new Error('缺少裝置ID（clientId）')
          let s = state()
          const hasTrip = s.trips.some((t) => t.clientId === clientId)
          if (!hasTrip) {
            const trip: LedgerTrip = {
              id: uuid(),
              name: '甜蜜代購行',
              createdAt: Date.now(),
              clientId,
            }
            const map = { ...(s.currentTripByClient || {}), [clientId]: trip.id }
            s = { ...s, trips: [trip, ...s.trips], currentTripByClient: map }
            write(s)
          }
          const trips = s.trips.filter((t) => t.clientId === clientId)
          const map = s.currentTripByClient || {}
          let currentTripId = map[clientId] || null
          if (currentTripId && !trips.some((t) => t.id === currentTripId)) currentTripId = null
          if (!currentTripId && trips.length) currentTripId = trips[0].id

          const txForClient = s.transactions.filter((t) => t.clientId === clientId)
          const alreadySeeded = s.demoLedgerSeeded?.[clientId]
          if (currentTripId && txForClient.length === 0 && !alreadySeeded) {
            const t0 = Date.now()
            const d = new Date().toISOString().slice(0, 10)
            const sampleTx: LedgerTx[] = [
              {
                id: uuid(),
                tripId: currentTripId,
                amount: 1280,
                note: '【示範】Animate 預購尾款',
                type: 'business',
                category: '購物',
                date: d,
                timestamp: t0 - 86400000,
                clientId,
                payMethod: '信用卡',
                currency: 'JPY',
              },
              {
                id: uuid(),
                tripId: currentTripId,
                amount: 350,
                note: '【示範】超商取貨手續費',
                type: 'business',
                category: '手續費',
                date: d,
                timestamp: t0 - 3600000,
                clientId,
                payMethod: '現金',
                currency: 'TWD',
              },
            ]
            const sampleItems: LedgerItem[] = [
              {
                id: uuid(),
                name: '【示範】代購品項',
                createdAt: t0,
                clientId,
              },
            ]
            s = {
              ...s,
              transactions: [...sampleTx, ...s.transactions],
              items: [...sampleItems, ...s.items],
              demoLedgerSeeded: { ...(s.demoLedgerSeeded || {}), [clientId]: true },
            }
            write(s)
          }

          return {
            appName: '記帳系統（整合版）',
            trips,
            currentTripId,
            transactions: s.transactions.filter((t) => t.clientId === clientId),
            items: s.items.filter((i) => i.clientId === clientId),
            settings: { ...ledgerDefaultSettings(), ...s.settings },
          } as T
        }

        if (action === 'setCurrentTrip') {
          const { clientId, tripId } = payload as { clientId: string; tripId: string }
          const s = state()
          const by = { ...(s.currentTripByClient || {}), [clientId]: tripId }
          write({ ...s, currentTripByClient: by })
          return { ok: true } as T
        }

        if (action === 'createTrip') {
          const { clientId, name } = payload as { clientId: string; name: string }
          const s = state()
          const trip: LedgerTrip = {
            id: uuid(),
            name: String(name).trim(),
            createdAt: Date.now(),
            clientId,
          }
          const map = { ...(s.currentTripByClient || {}), [clientId]: trip.id }
          write({ ...s, trips: [trip, ...s.trips], currentTripByClient: map })
          return trip as T
        }

        if (action === 'addTransaction') {
          const { clientId, payload: pl } = payload as {
            clientId: string
            payload: LedgerAddTxBody
          }
          const s = state()
          const tx: LedgerTx = {
            id: uuid(),
            tripId: String(pl.tripId),
            amount: Number(pl.amount),
            note: String(pl.note || ''),
            type: pl.type === 'personal' ? 'personal' : 'business',
            category: String(pl.category || ''),
            date: String(pl.date),
            timestamp: Date.now(),
            clientId,
            payMethod: String(pl.payMethod || ''),
            currency: String(pl.currency || ''),
          }
          write({ ...s, transactions: [tx, ...s.transactions] })
          return tx as T
        }

        if (action === 'deleteTransaction') {
          const { clientId, txId } = payload as { clientId: string; txId: string }
          const s = state()
          write({
            ...s,
            transactions: s.transactions.filter(
              (t) => !(t.id === txId && t.clientId === clientId),
            ),
          })
          return { ok: true } as T
        }

        if (action === 'createItemsBatch') {
          const { clientId, rawText } = payload as { clientId: string; rawText: string }
          const parts = String(rawText || '')
            .split(/[,/\n|，、;；]+/g)
            .map((x) => x.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
          const s = state()
          const existed = new Set(s.items.map((i) => i.name.toLowerCase()))
          const added: LedgerItem[] = []
          for (const name of parts) {
            const key = name.toLowerCase()
            if (existed.has(key)) continue
            existed.add(key)
            const it: LedgerItem = {
              id: uuid(),
              name,
              createdAt: Date.now(),
              clientId,
            }
            added.push(it)
          }
          write({ ...s, items: [...added, ...s.items] })
          return added as T
        }

        if (action === 'deleteItem') {
          const { clientId, itemId } = payload as { clientId: string; itemId: string }
          const s = state()
          write({
            ...s,
            items: s.items.filter((i) => !(i.id === itemId && i.clientId === clientId)),
          })
          return { ok: true } as T
        }

        if (action === 'deleteTrip') {
          const { clientId, tripId } = payload as { clientId: string; tripId: string }
          const s = state()
          write({
            ...s,
            trips: s.trips.filter((t) => !(t.id === tripId && t.clientId === clientId)),
            transactions: s.transactions.filter(
              (t) => !(t.tripId === tripId && t.clientId === clientId),
            ),
          })
          return { ok: true } as T
        }

        if (action === 'duplicateTrip') {
          const { clientId, sourceTripId, newTripName } = payload as {
            clientId: string
            sourceTripId: string
            newTripName?: string
          }
          const s = state()
          const src = s.trips.find((t) => t.id === sourceTripId && t.clientId === clientId)
          const trip: LedgerTrip = {
            id: uuid(),
            name:
              (newTripName && String(newTripName).trim()) ||
              (src ? `${src.name}（複寫）` : '行程（複寫）'),
            createdAt: Date.now(),
            clientId,
          }
          const txs = s.transactions.filter(
            (t) => t.tripId === sourceTripId && t.clientId === clientId,
          )
          const copies = txs.map((t) => ({
            ...t,
            id: uuid(),
            tripId: trip.id,
            timestamp: Date.now(),
          }))
          write({
            ...s,
            trips: [trip, ...s.trips],
            transactions: [...copies, ...s.transactions],
          })
          return { ok: true, newTripId: trip.id } as T
        }

        if (action === 'overwriteTrip') {
          const { clientId, sourceTripId, targetTripId } = payload as {
            clientId: string
            sourceTripId: string
            targetTripId: string
          }
          const s = state()
          const rest = s.transactions.filter(
            (t) => !(t.tripId === targetTripId && t.clientId === clientId),
          )
          const src = s.transactions.filter(
            (t) => t.tripId === sourceTripId && t.clientId === clientId,
          )
          const copies = src.map((t) => ({
            ...t,
            id: uuid(),
            tripId: targetTripId,
            timestamp: Date.now(),
          }))
          write({ ...s, transactions: [...copies, ...rest] })
          return { ok: true } as T
        }

        if (action === 'saveSettings') {
          const { clientId: _ledgerClientId, settingsObj } = payload as {
            clientId: string
            settingsObj: LedgerSettings
          }
          void _ledgerClientId
          const s = state()
          const row = { ...ledgerDefaultSettings(), ...s.settings, ...settingsObj }
          write({ ...s, settings: row })
          return { ok: true } as T
        }

        if (action === 'resetSheetsForClient') {
          const { clientId } = payload as { clientId: string }
          const s = state()
          const by = { ...(s.currentTripByClient || {}) }
          delete by[clientId]
          const seededNext = { ...(s.demoLedgerSeeded || {}) }
          delete seededNext[clientId]
          const cleared: typeof s = {
            trips: s.trips.filter((t) => t.clientId !== clientId),
            transactions: s.transactions.filter((t) => t.clientId !== clientId),
            items: s.items.filter((i) => i.clientId !== clientId),
            settings: s.settings,
            currentTripByClient: by,
            demoLedgerSeeded: seededNext,
          }
          const trip: LedgerTrip = {
            id: uuid(),
            name: '甜蜜代購行',
            createdAt: Date.now(),
            clientId,
          }
          write({
            ...cleared,
            trips: [trip, ...cleared.trips],
            currentTripByClient: { ...by, [clientId]: trip.id },
          })
          return { ok: true } as T
        }
      }

      if (module === 'preorder') {
        if (action === 'export') {
          return loadJson(KEYS.preorder, preorderDefault()) as T
        }
        if (action === 'save') {
          const groups = payload as PreorderGroup[]
          saveJson(KEYS.preorder, Array.isArray(groups) ? groups : [])
          return {
            ok: true,
            spreadsheetUrl: '',
            stats: { groups: groups?.length ?? 0 },
          } as T
        }
        if (action === 'customerLookup') {
          const pl = payload as { customerName?: string; lookupPin?: string }
          const q = lookupNameKey(pl?.customerName ?? '')
          const gb = mergeGroupBuyAppData(loadJson(KEYS.groupbuy, gbDefault()))
          const portalConfig = { ...defaultPortal, ...gb.portalConfig }
          if (!q) return { portalConfig, matches: [] } as T

          const preorderGroups = loadJson(KEYS.preorder, preorderDefault()) as PreorderGroup[]
          const phoneHints = useDaigouStore.getState().customers.map((c) => ({
            name: c.name,
            lineDisplayName: c.lineDisplayName,
            phoneLast3: c.phoneLast3,
          }))
          const auth = authorizeCustomerLookupQuery(
            q,
            pl?.lookupPin ?? '',
            [...(gb.groups || []), ...preorderGroups],
            gb.portalLookupCustomers,
            phoneHints,
          )
          if (!auth.ok) {
            return { portalConfig, matches: [], lookupError: auth.error } as T
          }

          const matches: PreorderLookupMatch[] = []
          for (const g of preorderGroups) {
            for (const o of g.orders || []) {
              if (!orderMatchesAuthorizedNames(o.customerName, auth.authorizedNames)) continue
              matches.push({
                groupId: g.id,
                groupName: g.name,
                groupStatus: g.status,
                closingDate: g.closingDate,
                saleEndDate: g.saleEndDate,
                purchaseDate: g.purchaseDate,
                officialShipDate: g.officialShipDate,
                purchaseLink: g.purchaseLink || '',
                groupOrderId: String(g.orderId || ''),
                logisticsId: String(g.logisticsId || ''),
                order: { ...o, items: o.items || [] },
              })
            }
          }
          return { portalConfig, matches } as T
        }
      }

      if (module === 'storefront') {
        if (action === 'getCatalog') {
          const published = loadJson<{ products: PublicSpotProduct[]; updatedAt?: string } | null>(
            KEYS.storefrontCatalog,
            null,
          )
          if (published?.products?.length) {
            return {
              products: published.products.filter((p) => p.status === 'on_sale' && p.stockQty > 0),
              updatedAt: published.updatedAt,
            } as T
          }
          const products = useDaigouStore
            .getState()
            .spotProducts.filter((p) => p.status === 'on_sale' && p.stockQty > 0)
            .map(spotToPublic)
          return { products, updatedAt: new Date().toISOString() } as T
        }
        if (action === 'publishCatalog') {
          const list = ((payload as { products?: SpotProduct[] })?.products || []).map(spotToPublic)
          const body = { products: list, updatedAt: new Date().toISOString() }
          saveJson(KEYS.storefrontCatalog, body)
          return { ok: true, count: list.length } as T
        }
      }

      throw new Error(`Mock: unknown ${module}/${action}`)
    },
  }
}
