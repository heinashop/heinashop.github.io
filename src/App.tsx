import { Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PortalLookupSyncBridge } from './components/PortalLookupSyncBridge'
import { useApplyVisualTheme } from './hooks/useApplyVisualTheme'
import { ProShell } from './shell/ProShell'
import { RequireAdminAuth } from './components/auth/RequireAdminAuth'
import {
  LazyAdminCustomerPreviewPage,
  LazyAdminLoginPage,
  LazyAdminNicknameSearchPage,
  LazyAdminOpenGroupsPreviewPage,
  LazyOpenGroupsPage,
  LazyOpenGroupDetailPage,
  LazyCustomerDetailPage,
  LazyCustomerLookupPage,
  LazyCustomerPortalPage,
  LazyCustomersPage,
  LazyDashboardPage,
  LazyConsolidationPage,
  LazyInboundMonthPage,
  LazyGroupBuyPage,
  LazyGroupBuyPreorderHubPage,
  LazyGroupDetailPage,
  LazyGroupRulesPage,
  LazyGroupsPage,
  LazyIntegrationsPage,
  LazyMessageTemplatesPage,
  LazyMyShipRecordsPage,
  LazyOrderDetailPage,
  LazyOrdersPage,
  LazyPayablesPage,
  LazyPaymentReviewPage,
  LazyPaymentReportPage,
  LazyJournalPage,
  LazyPortalPreviewPage,
  LazyPortalContentAdminPage,
  LazyBankViewerAdminPage,
  LazyBankAccountViewerPage,
  LazyPreorderPage,
  LazyProcurementDashboardPage,
  LazyProcurementReconciliationPage,
  LazyProductsPage,
  LazyPublicCartPage,
  LazyPublicCheckoutPage,
  LazyPublicHomePage,
  LazyPublicProductPage,
  LazyPublicShell,
  LazyPublicShopPage,
  LazyPurchaseOrderDetailPage,
  LazyPurchaseOrdersPage,
  LazyPurchaseReturnsPage,
  LazyReceiptsPage,
  LazySettingsPage,
  LazyShipmentRecordsPage,
  LazyShippingPage,
  LazyLiveManagePage,
  LazySpotShopPage,
  LazySuppliersPage,
  LazyTutorialPage,
} from './app/lazyPages'
import { AgentDebugPanel } from './debug/AgentDebugPanel'
import { agentLog } from './debug/agentLog'
import { RouteFallback } from './components/app/RouteFallback'
import { LocalPreviewBar } from './components/app/LocalPreviewBar'
import { SheetSyncBridge } from './sync/SheetSyncBridge'
/** 新增頂層 `<Route path>` 時請同步 `src/router/hashPathPrefixes.ts`（path→hash 深連結）。 */

/** 與 GAS 部署一致：一律 Hash，避免本機用 `/#/…` 時誤判為 `/` 而進錯頁 */
const Router = HashRouter

function DebugRouteTrace() {
  const loc = useLocation()
  useEffect(() => {
    agentLog({
      runId: 'baseline',
      hypothesisId: 'H1',
      location: 'App.tsx:route',
      message: 'route change',
      data: { pathname: loc.pathname, search: loc.search },
    })
  }, [loc.pathname, loc.search])
  return null
}

function VisualTheme() {
  useApplyVisualTheme()
  return null
}

export default function App() {
  return (
    <Router>
      <VisualTheme />
      <PortalLookupSyncBridge />
      <DebugRouteTrace />
      <AgentDebugPanel />
      <LocalPreviewBar />
      <SheetSyncBridge />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* 預設入口：維持原顧客前台 #/lookup 為主 */}
          <Route path="/" element={<Navigate to="/lookup" replace />} />

          <Route path="/lookup" element={<LazyCustomerLookupPage />} />
          <Route path="/bank" element={<LazyBankAccountViewerPage />} />
          <Route path="/open-groups/:groupId" element={<LazyOpenGroupDetailPage />} />
          <Route path="/open-groups" element={<LazyOpenGroupsPage />} />
          <Route path="/portal" element={<LazyCustomerPortalPage />} />

          {/* 官網現貨／購物車（附加功能，不取代查單專區） */}
          <Route element={<LazyPublicShell />}>
            <Route path="/home" element={<LazyPublicHomePage />} />
            <Route path="/marketing" element={<LazyPublicHomePage />} />
            <Route path="/shop" element={<LazyPublicShopPage />} />
            <Route path="/shop/p/:id" element={<LazyPublicProductPage />} />
            <Route path="/cart" element={<LazyPublicCartPage />} />
            <Route path="/checkout" element={<LazyPublicCheckoutPage />} />
          </Route>
          <Route path="/login" element={<LazyAdminLoginPage />} />

          <Route element={<RequireAdminAuth />}>
            <Route element={<ProShell />}>
              <Route path="/dashboard" element={<LazyDashboardPage />} />
              <Route path="/groups" element={<LazyGroupsPage />} />
              <Route path="/groups/:id" element={<LazyGroupDetailPage />} />
              <Route path="/consolidation" element={<LazyConsolidationPage />} />
              <Route path="/consolidation/:shipmentId" element={<LazyConsolidationPage />} />
              <Route path="/inbound-month" element={<LazyInboundMonthPage />} />
              <Route path="/open-groups-preview" element={<LazyAdminOpenGroupsPreviewPage />} />
              <Route path="/portal-content" element={<LazyPortalContentAdminPage />} />
              <Route path="/bank-viewer" element={<LazyBankViewerAdminPage />} />
              <Route path="/products" element={<LazyProductsPage />} />
              <Route path="/spot-shop" element={<LazySpotShopPage />} />
              <Route path="/orders" element={<LazyOrdersPage />} />
              <Route path="/orders/:id" element={<LazyOrderDetailPage />} />
              <Route path="/customers" element={<LazyCustomersPage />} />
              <Route path="/customers/:id" element={<LazyCustomerDetailPage />} />
              <Route path="/tutorial" element={<LazyTutorialPage />} />
              <Route path="/group-rules" element={<LazyGroupRulesPage />} />
              <Route path="/message-templates" element={<LazyMessageTemplatesPage />} />
              <Route path="/live" element={<LazyLiveManagePage />} />
              <Route path="/shipping" element={<LazyShippingPage />} />
              <Route path="/procurement" element={<LazyProcurementDashboardPage />} />
              <Route path="/procurement/suppliers" element={<LazySuppliersPage />} />
              <Route path="/procurement/purchase-orders" element={<LazyPurchaseOrdersPage />} />
              <Route path="/procurement/purchase-orders/:id" element={<LazyPurchaseOrderDetailPage />} />
              <Route path="/procurement/receipts" element={<LazyReceiptsPage />} />
              <Route path="/procurement/payables" element={<LazyPayablesPage />} />
              <Route path="/procurement/returns" element={<LazyPurchaseReturnsPage />} />
              <Route path="/procurement/reconciliation" element={<LazyProcurementReconciliationPage />} />
              <Route path="/shipment-records" element={<LazyShipmentRecordsPage />} />
              <Route path="/myship-records" element={<LazyMyShipRecordsPage />} />
              <Route path="/portal-preview" element={<LazyPortalPreviewPage />} />
              <Route path="/nickname-search" element={<LazyAdminNicknameSearchPage />} />
              <Route path="/payment-review" element={<LazyPaymentReviewPage />} />
              <Route path="/payment-reports" element={<LazyPaymentReportPage />} />
              <Route path="/journal" element={<LazyJournalPage />} />
              <Route path="/customer-preview" element={<LazyAdminCustomerPreviewPage />} />
              <Route path="/settings" element={<LazySettingsPage />} />
              <Route path="/integrations" element={<LazyIntegrationsPage />} />
              <Route path="/group-buy-center" element={<LazyGroupBuyPreorderHubPage />} />
              <Route path="/groupbuy" element={<LazyGroupBuyPage />} />
              <Route path="/preorder" element={<LazyPreorderPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/lookup" replace />} />
        </Routes>
      </Suspense>
    </Router>
  )
}
