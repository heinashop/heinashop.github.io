// Standalone business rules. No Apps Script runtime or network dependency.
// Imported once from the existing tested candidate; edit this module after migration.
export function createBusiness(services) {
const { SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, Session } = services;
// Ported business rules: Secrets.gs
/**
 * Secrets live in Apps Script → Project Settings → Script properties.
 * Do not put passwords or PINs in source. This file only names the keys.
 *
 *   HEINA_ADMIN_PASSWORD   organizer login (required before admin API calls)
 *   HEINA_LOOKUP_PIN       default 4-digit order lookup PIN when a customer has none stored
 *   HEINA_BANK_PASSWORD    shared bank-account lookup password
 *   HEINA_PAGES_URL        optional public site URL (defaults to the GitHub Pages project URL)
 *   HEINA_ADMIN_SESSIONS   managed automatically (token → expiry). Do not edit by hand.
 */
var HEINA_PROP_ADMIN_PASSWORD = 'HEINA_ADMIN_PASSWORD';
var HEINA_PROP_LOOKUP_PIN = 'HEINA_LOOKUP_PIN';
var HEINA_PROP_BANK_PASSWORD = 'HEINA_BANK_PASSWORD';
var HEINA_PROP_PAGES_URL = 'HEINA_PAGES_URL';
var HEINA_PROP_ADMIN_SESSIONS = 'HEINA_ADMIN_SESSIONS';
var HEINA_DEFAULT_PAGES_URL = 'https://heinashop.github.io/';

function heinaScriptProp_(key) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    return v == null ? '' : String(v);
  } catch (e) {
    return '';
  }
}

function heinaSetScriptProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

function heinaAdminPassword_() {
  return heinaScriptProp_(HEINA_PROP_ADMIN_PASSWORD);
}

function heinaLookupPin_() {
  var pin = heinaScriptProp_(HEINA_PROP_LOOKUP_PIN).replace(/\D/g, '').slice(0, 4);
  return /^\d{4}$/.test(pin) ? pin : '';
}

function heinaBankPassword_() {
  return String(heinaScriptProp_(HEINA_PROP_BANK_PASSWORD) || '').trim();
}

function heinaPagesUrl_() {
  var fromProp = String(heinaScriptProp_(HEINA_PROP_PAGES_URL) || '').trim();
  return fromProp || HEINA_DEFAULT_PAGES_URL;
}

function heinaSafeEqual_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    var ca = i < a.length ? a.charCodeAt(i) : 0;
    var cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function heinaAdminSessions_() {
  try {
    var raw = heinaScriptProp_(HEINA_PROP_ADMIN_SESSIONS);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function heinaSaveAdminSessions_(map) {
  heinaSetScriptProp_(HEINA_PROP_ADMIN_SESSIONS, JSON.stringify(map || {}));
}

function heinaAdminTokenValid_(token) {
  var key = String(token || '');
  if (!key) return false;
  var map = heinaAdminSessions_();
  var exp = Number(map[key] || 0);
  return exp > Date.now();
}

function heinaIssueAdminToken_(hours) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var h = Math.max(1, Math.min(168, Number(hours) || 12));
  var exp = Date.now() + h * 3600000;
  var map = heinaAdminSessions_();
  var now = Date.now();
  var pruned = {};
  var n = 0;
  for (var k in map) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
    if (Number(map[k]) > now && n < 24) {
      pruned[k] = map[k];
      n++;
    }
  }
  pruned[token] = exp;
  heinaSaveAdminSessions_(pruned);
  return { token: token, expiresAt: exp, sessionHours: h };
}

function heinaClearAdminSessions_() {
  heinaSaveAdminSessions_({});
}

function heinaAdminFailCount_() {
  var n = Number(CacheService.getScriptCache().get('heina_admin_fail') || '0');
  return Number.isFinite(n) ? n : 0;
}

function heinaAdminLocked_() {
  return heinaAdminFailCount_() >= 5;
}

function heinaNoteAdminFail_() {
  var n = heinaAdminFailCount_() + 1;
  CacheService.getScriptCache().put('heina_admin_fail', String(n), 900);
  return n;
}

function heinaClearAdminFail_() {
  CacheService.getScriptCache().remove('heina_admin_fail');
}

function heinaAdminLogin_(pl) {
  var expected = heinaAdminPassword_();
  if (!String(expected).trim()) {
    return {
      ok: false,
      needsSetup: true,
      message: '尚未設定管理密碼。請在後端設定 HEINA_ADMIN_PASSWORD。'
    };
  }
  var given = pl && pl.password != null ? String(pl.password) : '';
  // Correct credentials always win. A stranger's failed guesses must never lock the owner out.
  if (given && heinaSafeEqual_(given, expected)) {
    heinaClearAdminFail_();
    var issued = heinaIssueAdminToken_(12);
    return {
      ok: true,
      token: issued.token,
      expiresAt: issued.expiresAt,
      sessionHours: issued.sessionHours
    };
  }
  if (heinaAdminLocked_()) {
    return { ok: false, message: '嘗試次數過多，請約 15 分鐘後再試' };
  }
  var n = heinaNoteAdminFail_();
  var left = Math.max(0, 5 - n);
  return {
    ok: false,
    message: left ? '密碼錯誤（尚可嘗試 ' + left + ' 次）' : '密碼錯誤次數過多，已鎖定約 15 分鐘'
  };
}

function heinaAdminChangePassword_(pl) {
  var current = pl && pl.currentPassword != null ? String(pl.currentPassword) : '';
  var next = pl && pl.newPassword != null ? String(pl.newPassword) : '';
  var expected = heinaAdminPassword_();
  if (!String(expected).trim()) {
    return { ok: false, needsSetup: true, message: '尚未設定管理密碼' };
  }
  if (!heinaSafeEqual_(current, expected)) {
    return { ok: false, message: '目前密碼不正確' };
  }
  if (String(next).length < 6) return { ok: false, message: '新密碼至少 6 字元' };
  if (heinaSafeEqual_(next, expected)) return { ok: false, message: '新密碼不可與目前密碼相同' };
  heinaSetScriptProp_(HEINA_PROP_ADMIN_PASSWORD, next);
  heinaClearAdminSessions_();
  heinaClearAdminFail_();
  return { ok: true, message: '已更新管理密碼，請重新登入' };
}

// Ported business rules: GroupBuy.gs
/** Group buy (V50) — A~Z 26-column flat sheet + journal + settings */

var GB_SHEET_ORDERS = '訂單明細';
var GB_SHEET_JOURNAL = '銀行日記帳';
var GB_SHEET_SETTINGS = '系統設定';
var GB_COLS = 26;

var GB_HEADER = [
  '名字', '商品', '數量', '日幣單價', '日幣總價', '台幣售價',
  '總額', '訂金', '國內運費', '國際運費', '尾款', '付款狀況',
  '出貨日', '系列', '__GroupID', '__GroupStatus', '__GroupClosing', '__GroupSaleEnd',
  '__GroupPurchase', '__GroupJpy', '__GroupOrderId', '__GroupLogisticsId', '__GroupLink',
  '__OrderID', '__PaymentInfo', '__ExportDate'
];

var GB_COL = {
  CUSTOMER: 0, ITEM: 1, QTY: 2, JPY: 3, JPY_TOTAL: 4, TWD_UNIT: 5,
  TOTAL_TWD: 6, DEPOSIT: 7, DOMESTIC: 8, INTL: 9, BALANCE: 10, PAY_STATUS: 11,
  SHIP_DATE: 12, GROUP_NAME: 13, GROUP_ID: 14, GROUP_STATUS: 15,
  GROUP_CLOSING: 16, GROUP_SALE_END: 17, GROUP_PURCHASE: 18, GROUP_JPY: 19,
  GROUP_ORDER_ID: 20, GROUP_LOGISTICS: 21, GROUP_LINK: 22,
  ORDER_ID: 23, PAYMENT_INFO: 24, EXPORT_DATE: 25
};

function gb_initSheets_() {
  var ss = SpreadsheetApp.getActive();
  var orderSh = ss.getSheetByName(GB_SHEET_ORDERS);
  if (!orderSh) {
    orderSh = ss.insertSheet(GB_SHEET_ORDERS);
    orderSh.appendRow(GB_HEADER);
    orderSh.setFrozenRows(1);
  } else {
    gb_ensureOrderHeader_(orderSh);
  }
  if (!ss.getSheetByName(GB_SHEET_JOURNAL)) {
    var j = ss.insertSheet(GB_SHEET_JOURNAL);
    j.appendRow(['ID', '日期', '銀行', '類型', '金額', '分類', '備註']);
    j.setFrozenRows(1);
  }
  if (!ss.getSheetByName(GB_SHEET_SETTINGS)) {
    var st = ss.insertSheet(GB_SHEET_SETTINGS);
    st.appendRow(['Key', 'Value']);
    st.appendRow(['exchangeRate', '0.22']);
  }
  gb_ensureDefaultSettings_();
}

function gb_ensureOrderHeader_(sheet) {
  if (sheet.getLastColumn() < GB_COLS) {
    sheet.getRange(1, 1, 1, GB_COLS).setValues([GB_HEADER]);
    sheet.setFrozenRows(1);
  }
}

/** 同一次執行只讀一次設定表。圖片存在格子裡時，反覆 getValues 是開啟變慢的主因。 */
var GB_SETTINGS_CACHE_ = null;

function gb_loadSettingsMap_(sheet) {
  if (GB_SETTINGS_CACHE_) {
    if (sheet && !GB_SETTINGS_CACHE_.sheet) GB_SETTINGS_CACHE_.sheet = sheet;
    return GB_SETTINGS_CACHE_;
  }
  var sh = sheet || SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var map = {};
  var rowOf = {};
  if (sh && sh.getLastRow() >= 2) {
    var numRows = sh.getLastRow() - 1;
    var rows = sh.getRange(2, 1, numRows, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      var key = String(rows[i][0]);
      map[key] = rows[i][1];
      rowOf[key] = i + 2;
    }
  }
  GB_SETTINGS_CACHE_ = { sheet: sh, map: map, rowOf: rowOf };
  return GB_SETTINGS_CACHE_;
}

function gb_ensureDefaultSettings_() {
  var ss = SpreadsheetApp.getActive();
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  var existing = gb_loadSettingsMap_(settingsSheet).map;
  var defaults = [
    ['exchangeRate', existing.exchangeRate != null ? existing.exchangeRate : '0.22'],
    ['portalTitle', existing.portalTitle != null ? existing.portalTitle : 'Heina訂單自助查詢'],
    ['portalIntro', existing.portalIntro != null ? existing.portalIntro : '輸入社群暱稱即可查詢訂單狀態與付款資訊。'],
    ['portalWebsiteUrl', existing.portalWebsiteUrl != null ? existing.portalWebsiteUrl : ''],
    ['portalGroupUrl', existing.portalGroupUrl != null ? existing.portalGroupUrl : ''],
    ['portalExtraNote', existing.portalExtraNote != null ? existing.portalExtraNote : '付款後請填寫：付款日期、後五碼，等待對帳完成後即可在此查看狀態。'],
    ['portalLookupDesc', existing.portalLookupDesc != null ? existing.portalLookupDesc : '請輸入在社群裡的名字。若有改名或無法查詢請私訊官方 LINE。查單密碼為 4 位數字，可自行修改。']
  ];
  for (var d = 0; d < defaults.length; d++) {
    var k = defaults[d][0];
    if (existing[k] === undefined) gb_upsertSetting_(settingsSheet, k, defaults[d][1]);
  }
}

function gb_getGroupCreditCard_(groupId) {
  return gb_getGroupSetting_(groupId, 'card');
}

function gb_getGroupSetting_(groupId, suffix) {
  var key = 'gb_' + suffix + '_' + String(groupId || '');
  var cache = gb_loadSettingsMap_();
  if (!Object.prototype.hasOwnProperty.call(cache.map, key)) return '';
  return String(cache.map[key] || '');
}

function gb_setGroupCreditCard_(groupId, card) {
  var key = 'gb_card_' + String(groupId || '');
  gb_upsertSetting_(SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS), key, String(card || ''));
}

function gb_getGroupPortalField_(groupId, field) {
  return gb_getGroupSetting_(groupId, field);
}

function gb_setGroupPortalFields_(group, options) {
  options = options || {};
  var sh = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var id = String(group.id || '');
  var imageUrls = group.imageUrls || [];
  if ((!imageUrls || !imageUrls.length) && group.coverImageUrl) {
    imageUrls = [String(group.coverImageUrl)];
  }
  var cover = String(group.coverImageUrl || (imageUrls.length ? imageUrls[0] : '') || '');
  gb_upsertSetting_(sh, 'gb_description_' + id, String(group.description || ''));
  if (!options.skipImages) {
    gb_upsertSetting_(sh, 'gb_coverImage_' + id, cover.length > 49000 ? '' : cover);
  }
  gb_upsertSetting_(sh, 'gb_remarks_' + id, String(group.remarks || ''));
  gb_upsertSetting_(sh, 'gb_channel_' + id, String(group.channel || ''));
  if (group.opsActive === false) gb_upsertSetting_(sh, 'gb_opsActive_' + id, '0');
  else gb_upsertSetting_(sh, 'gb_opsActive_' + id, '1');
  if (group.portalListed === false) gb_upsertSetting_(sh, 'gb_portalListed_' + id, '0');
  else gb_upsertSetting_(sh, 'gb_portalListed_' + id, '1');
  gb_upsertSetting_(sh, 'gb_stockAlert_' + id, group.stockAlert ? '1' : '0');
  gb_upsertSetting_(sh, 'gb_stockAlertNote_' + id, String(group.stockAlertNote || ''));
  if (!options.skipImages) gb_writeGroupImages_(sh, id, imageUrls);
}

/** 每張圖單獨一格，避免 JSON 陣列超過試算表 5 萬字元上限 */
function gb_writeGroupImages_(sh, groupId, imageUrls) {
  var id = String(groupId || '');
  var list = imageUrls || [];
  var prevCount = parseInt(String(gb_getGroupSetting_(id, 'imageCount') || '0'), 10) || 0;
  var n = Math.min(list.length, 12);
  gb_upsertSetting_(sh, 'gb_imageCount_' + id, String(n));
  for (var i = 0; i < n; i++) {
    var url = String(list[i] || '');
    if (url.length > 49000) {
      throw new Error('開團圖片過大無法寫入設定表，請於前端壓縮後再存（單張 data URL 須小於約 48KB 字元）');
    }
    gb_upsertSetting_(sh, 'gb_image_' + i + '_' + id, url);
  }
  for (var j = n; j < Math.max(prevCount, 12); j++) {
    gb_upsertSetting_(sh, 'gb_image_' + j + '_' + id, '');
  }
  // 相容舊鍵：改存短摘要，避免再寫入超大 JSON
  gb_upsertSetting_(sh, 'gb_imageUrls_' + id, n ? JSON.stringify({ count: n, perKey: true }) : '[]');
}

function gb_parseGroupImageUrls_(raw, coverFallback) {
  // 新格式：gb_imageCount_ + gb_image_i_
  // 此函式仍處理舊版 JSON 陣列；新格式由 gb_attachGroupPortalFields_ 讀取
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.perKey) return [];
      if (parsed && parsed.length) {
        return parsed.map(function (u) { return String(u || ''); }).filter(function (u) { return !!u; });
      }
    } catch (e) {}
  }
  var cover = String(coverFallback || '').trim();
  return cover ? [cover] : [];
}

function gb_readGroupImages_(groupId, coverFallback) {
  var id = String(groupId || '');
  var countRaw = String(gb_getGroupSetting_(id, 'imageCount') || '').trim();
  if (countRaw !== '') {
    var n = parseInt(countRaw, 10) || 0;
    var out = [];
    for (var i = 0; i < n && i < 12; i++) {
      var u = String(gb_getGroupSetting_(id, 'image_' + i) || '').trim();
      if (u) out.push(u);
    }
    if (out.length) return out;
  }
  return gb_parseGroupImageUrls_(gb_getGroupPortalField_(id, 'imageUrls'), coverFallback);
}

function gb_attachGroupPortalFields_(group) {
  var id = String(group.id || '');
  group.description = gb_getGroupPortalField_(id, 'description');
  group.coverImageUrl = gb_getGroupPortalField_(id, 'coverImage');
  group.imageUrls = gb_readGroupImages_(id, group.coverImageUrl);
  if (!group.coverImageUrl && group.imageUrls.length) group.coverImageUrl = group.imageUrls[0];
  group.remarks = gb_getGroupPortalField_(id, 'remarks');
  var ch = String(gb_getGroupPortalField_(id, 'channel') || '').trim();
  if (ch === '市場飯') ch = '場販';
  group.channel = (ch === '場販' || ch === '通販') ? ch : '';
  var opsRaw = String(gb_getGroupPortalField_(id, 'opsActive') || '').trim();
  group.opsActive = opsRaw === '0' ? false : true;
  var listedRaw = String(gb_getGroupPortalField_(id, 'portalListed') || '').trim();
  group.portalListed = listedRaw === '0' ? false : true;
  group.stockAlert = String(gb_getGroupPortalField_(id, 'stockAlert') || '').trim() === '1';
  group.stockAlertNote = String(gb_getGroupPortalField_(id, 'stockAlertNote') || '');
  return group;
}

function gb_getGroupPurchaseCosts_(groupId, logisticsId) {
  var raw = gb_getGroupSetting_(groupId, 'purchaseCosts');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.length) return parsed;
    } catch (e) {}
  }
  var jpyCost = gb_getGroupSetting_(groupId, 'jpyCost');
  var jpyShipping = gb_getGroupSetting_(groupId, 'jpyShipping');
  var jpyTotal = gb_getGroupSetting_(groupId, 'jpyTotal');
  var twdCost = gb_getGroupSetting_(groupId, 'twdCost');
  var weight = gb_getGroupSetting_(groupId, 'weight');
  var logistics = String(logisticsId || '').trim();
  if (!jpyCost && !jpyShipping && !jpyTotal && !twdCost && !weight && !logistics) return [];
  return [{
    id: 'legacy_' + groupId,
    jpyCost: jpyCost,
    jpyShipping: jpyShipping,
    jpyTotal: jpyTotal,
    twdCost: twdCost,
    logisticsId: logistics,
    weight: weight
  }];
}

function gb_setGroupCostFields_(group) {
  var sh = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var id = String(group.id || '');
  gb_upsertSetting_(sh, 'gb_purchaseCosts_' + id, JSON.stringify(group.purchaseCosts || []));
}

function gb_isLegacyRow_(r) {
  return !r[GB_COL.GROUP_ID] && r[21];
}

function gb_legacyUnflattenRow_(r, groupsMap) {
  var gId = r[21];
  var oId = r[22];
  var status = r[23];
  if (!gId) return;
  if (!groupsMap[gId]) {
    groupsMap[gId] = {
      id: gId, name: r[12], status: status || '已登記',
      closingDate: r[13], saleEndDate: r[14], officialShipDate: r[15],
      purchaseDate: '', creditCard: gb_getGroupCreditCard_(gId),
      jpyAmount: r[16], orderId: r[17], logisticsId: r[18], purchaseLink: r[19],
      purchaseCosts: gb_getGroupPurchaseCosts_(gId, r[18]),
      orders: []
    };
  }
  if (!oId) return;
  var g = groupsMap[gId];
  var order = null;
  for (var j = 0; j < g.orders.length; j++) {
    if (g.orders[j].id === oId) { order = g.orders[j]; break; }
  }
  if (!order) {
    order = {
      id: oId, customerName: r[0], totalTwd: r[6], deposit: r[7],
      domesticShip: r[8], intlShip: r[9], balance: r[10], paymentStatus: r[11],
      paymentInfo: r[20], items: []
    };
    g.orders.push(order);
  }
  if (r[1]) order.items.push({ name: r[1], qty: r[2], jpy: r[3], twd: r[5] });
}

function gb_v50UnflattenRow_(r, groupsMap) {
  var gId = r[GB_COL.GROUP_ID];
  var oId = r[GB_COL.ORDER_ID];
  if (!gId) return;
  if (!groupsMap[gId]) {
    groupsMap[gId] = {
      id: gId,
      name: r[GB_COL.GROUP_NAME],
      status: r[GB_COL.GROUP_STATUS] || '已登記',
      closingDate: r[GB_COL.GROUP_CLOSING],
      saleEndDate: r[GB_COL.GROUP_SALE_END],
      officialShipDate: r[GB_COL.SHIP_DATE],
      purchaseDate: r[GB_COL.GROUP_PURCHASE],
      creditCard: gb_getGroupCreditCard_(gId),
      jpyAmount: r[GB_COL.GROUP_JPY],
      purchaseCosts: gb_getGroupPurchaseCosts_(gId, r[GB_COL.GROUP_LOGISTICS]),
      orderId: r[GB_COL.GROUP_ORDER_ID],
      logisticsId: r[GB_COL.GROUP_LOGISTICS],
      purchaseLink: r[GB_COL.GROUP_LINK],
      orders: []
    };
    gb_attachGroupPortalFields_(groupsMap[gId]);
  }
  if (!oId) return;
  var g = groupsMap[gId];
  var order = null;
  for (var j = 0; j < g.orders.length; j++) {
    if (g.orders[j].id === oId) { order = g.orders[j]; break; }
  }
  if (!order) {
    order = {
      id: oId,
      customerName: r[GB_COL.CUSTOMER],
      totalTwd: r[GB_COL.TOTAL_TWD],
      deposit: r[GB_COL.DEPOSIT],
      domesticShip: r[GB_COL.DOMESTIC],
      intlShip: r[GB_COL.INTL],
      balance: r[GB_COL.BALANCE],
      paymentStatus: r[GB_COL.PAY_STATUS],
      paymentInfo: r[GB_COL.PAYMENT_INFO],
      items: []
    };
    g.orders.push(order);
  }
  if (r[GB_COL.ITEM]) {
    order.items.push({
      name: r[GB_COL.ITEM], qty: r[GB_COL.QTY], jpy: r[GB_COL.JPY], twd: r[GB_COL.TWD_UNIT]
    });
  }
}

function gb_parseJsonArray_(raw) {
  if (!raw) return undefined;
  try {
    var v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : undefined;
  } catch (e) {
    return undefined;
  }
}

function gb_buildPortalConfigFromSettings_(settings) {
  var announcements = gb_parseJsonArray_(settings.portalAnnouncementsJson);
  var faqItems = gb_parseJsonArray_(settings.portalFaqJson);
  var processSteps = gb_parseJsonArray_(settings.portalProcessStepsJson);
  var pc = {
    title: String(settings.portalTitle || 'Heina訂單自助查詢'),
    intro: String(settings.portalIntro || ''),
    websiteUrl: String(settings.portalWebsiteUrl || ''),
    groupUrl: String(settings.portalGroupUrl || ''),
    extraNote: String(settings.portalExtraNote || ''),
    lookupDesc: String(settings.portalLookupDesc || ''),
    lineFriendUrl: String(settings.portalLineFriendUrl || ''),
    lineShoppingUrl: String(settings.portalLineShoppingUrl || ''),
    instagramUrl: String(settings.portalInstagramUrl || ''),
    threadsUrl: String(settings.portalThreadsUrl || ''),
    preorderShopUrl: String(settings.portalPreorderShopUrl || ''),
    spotShopUrl: String(settings.portalSpotShopUrl || ''),
    footer: String(settings.portalFooter || ''),
    avatarUrl: String(settings.portalAvatarUrl || '')
  };
  if (announcements) pc.announcements = announcements;
  if (faqItems) pc.faqItems = faqItems;
  if (processSteps) pc.processSteps = processSteps;
  var homeIds = gb_parseJsonArray_(settings.portalHomeOpenGroupIdsJson);
  if (homeIds && homeIds.length) {
    pc.homeOpenGroupIds = homeIds.map(function (x) { return String(x || ''); }).filter(Boolean).slice(0, 3);
  }
  var guideInfographics = gb_parseJsonArray_(settings.portalGuideInfographicsJson);
  if (guideInfographics && guideInfographics.length) {
    pc.guideInfographics = guideInfographics;
  }
  var socialIconSlots = gb_parseJsonArray_(settings.portalSocialIconSlotsJson);
  if (socialIconSlots && socialIconSlots.length) {
    pc.socialIconSlots = socialIconSlots;
  }
  var teachCards = gb_parseJsonArray_(settings.portalTeachCardsJson);
  if (teachCards && teachCards.length) {
    pc.teachCards = teachCards;
  }
  return pc;
}

function gb_fetchAllData_() {
  gb_initSheets_();
  var ss = SpreadsheetApp.getActive();
  var orderSheet = ss.getSheetByName(GB_SHEET_ORDERS);
  var journalSheet = ss.getSheetByName(GB_SHEET_JOURNAL);
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);

  var groupsMap = {};
  var last = orderSheet.getLastRow();
  var rows = last > 1 ? orderSheet.getRange(2, 1, last, GB_COLS).getValues() : [];

  for (var i = 0; i < rows.length; i++) {
    if (gb_isLegacyRow_(rows[i])) gb_legacyUnflattenRow_(rows[i], groupsMap);
    else gb_v50UnflattenRow_(rows[i], groupsMap);
  }

  var journalRows = journalSheet.getLastRow() > 1
    ? journalSheet.getRange(2, 1, journalSheet.getLastRow(), 7).getValues()
    : [];
  var bankJournal = journalRows.filter(function (r) { return String(r[0] || '').trim() !== ''; }).map(function (r) {
    var note = String(r[6] || '');
    var m = note.match(/#(\d{5})/) || note.match(/後五碼\s*(\d{5})/);
    return { id: r[0], date: r[1], bank: r[2], type: r[3], amount: r[4], category: r[5], note: note, lastFive: m ? m[1] : '' };
  });

  var settings = gb_loadSettingsMap_(settingsSheet).map;
  var orderRevMap = gb_parseRevMap_(settings.gb_orderRevMap);
  var groupRevMap = gb_parseRevMap_(settings.gb_groupRevMap);
  var revertedJournals = {};
  var opRecords = {};
  var settingKey;
  for (settingKey in settings) {
    if (String(settingKey).indexOf('gb_op_') !== 0) continue;
    try {
      var opIdKey = String(settingKey).substring(6);
      var opRecord = JSON.parse(String(settings[settingKey]));
      if (!opRecord) continue;
      opRecords[opIdKey] = opRecord;
      if (opRecord.journalKept && opRecord.journalEntryId) revertedJournals[String(opRecord.journalEntryId)] = true;
    } catch (ignoreOp) {}
  }
  for (var ji = 0; ji < bankJournal.length; ji++) {
    var jid = String(bankJournal[ji].id || '');
    var operationId = '';
    if (jid.indexOf('j_pr_') === 0) operationId = jid.substring(5);
    else if (jid.indexOf('j_sup_') === 0) operationId = jid.substring(6);
    if (operationId && !opRecords[operationId]) operationId = '';
    bankJournal[ji].operationId = operationId;
    if (revertedJournals[jid]) bankJournal[ji].reviewState = '已撤銷審核，原始收入保留，不是退款';
    else if (operationId && opRecords[operationId].status === 'done') bankJournal[ji].reviewState = '對應付款操作，收入仍保留';
    else if (operationId) bankJournal[ji].reviewState = '對應付款操作處理中，收入仍保留';
    else bankJournal[ji].reviewState = '';
  }
  var groupsOut = Object.keys(groupsMap).map(function (k) { return groupsMap[k]; });
  var giOut, oiOut;
  for (giOut = 0; giOut < groupsOut.length; giOut++) {
    groupsOut[giOut].groupRevision = String(groupRevMap[groupsOut[giOut].id] || '0');
    var groupOrders = groupsOut[giOut].orders || [];
    for (oiOut = 0; oiOut < groupOrders.length; oiOut++) {
      groupOrders[oiOut].orderRevision = String(orderRevMap[groupOrders[oiOut].id] || '0');
    }
  }
  var exchangeRate = settings.exchangeRate ? Number(settings.exchangeRate) : 0.22;
  var portalConfig = gb_buildPortalConfigFromSettings_(settings);

  var bankViewerCfg = gb_migrateBankPassword_(settingsSheet, settings, gb_readBankViewerConfig_(settings));
  return {
    groups: groupsOut,
    bankJournal: bankJournal,
    exchangeRate: exchangeRate,
    portalConfig: portalConfig,
    paymentReports: gb_readPaymentReports_(settings),
    portalLookupCustomers: gb_readPortalLookupCustomers_(settings),
    customerBalanceMemos: gb_readCustomerBalanceMemos_(settings),
    consolidationShipments: gb_readConsolidationShipments_(settings),
    bankViewer: gb_bankViewerPublicMeta_(bankViewerCfg),
    dataRevision: String(settings.gb_dataRevision || '0')
  };
}

function gb_publicGroupCatalog_() {
  var all = gb_fetchAllData_();
  var groups = [];
  (all.groups || []).forEach(function (g) {
    gb_attachGroupPortalFields_(g);
    if (g.portalListed === false) return;
    groups.push({
      id: g.id,
      name: g.name,
      status: g.status || '已登記',
      closingDate: g.closingDate || '',
      officialShipDate: g.officialShipDate || '',
      description: String(g.description || ''),
      coverImageUrl: String(g.coverImageUrl || ''),
      imageUrls: g.imageUrls || [],
      remarks: String(g.remarks || ''),
      channel: g.channel || '',
      opsActive: g.opsActive !== false,
      portalListed: g.portalListed !== false
    });
  });
  return {
    groups: groups,
    homeOpenGroupIds: (all.portalConfig && all.portalConfig.homeOpenGroupIds) || []
  };
}

function gb_syncPortalLookupCustomers_(pl) {
  gb_initSheets_();
  var ss = SpreadsheetApp.getActive();
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  var list = pl && pl.portalLookupCustomers ? pl.portalLookupCustomers : [];
  gb_writePortalLookupCustomers_(settingsSheet, list);
  if (pl && pl.customerBalanceMemos) {
    gb_writeCustomerBalanceMemos_(settingsSheet, pl.customerBalanceMemos);
  }
  return { status: 'success', count: list.length };
}

function gb_customerLookup_(pl) {
  var rawQ = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var lookupPin = pl && pl.lookupPin != null ? String(pl.lookupPin) : '';
  if (rawQ && gb_authThrottleLocked_('lookup', rawQ)) {
    return { portalConfig: {}, matches: [], lookupError: '嘗試次數過多，請約 15 分鐘後再試' };
  }
  var all = gb_fetchAllData_();
  var portalConfig = all.portalConfig;
  var matches = [];
  if (!rawQ) return { portalConfig: portalConfig, matches: matches, dataRevision: all.dataRevision };

  var groups = all.groups || [];
  var portalCustomers = all.portalLookupCustomers || [];
  var qLower = rawQ.toLowerCase();
  var candidateMap = {};

  function addCandidate(n) {
    var key = String(n || '').trim();
    if (key) candidateMap[key] = true;
  }

  var gi, oi, g, o, orders, namePool = {};
  for (gi = 0; gi < groups.length; gi++) {
    g = groups[gi];
    orders = g.orders || [];
    for (oi = 0; oi < orders.length; oi++) {
      o = orders[oi];
      var cn = String(o.customerName || '').trim();
      if (cn) namePool[cn] = true;
      if (String(o.id || '').trim().toLowerCase() === qLower) addCandidate(cn);
    }
  }
  for (var pi = 0; pi < portalCustomers.length; pi++) {
    var pc = portalCustomers[pi];
    if (pc && pc.name) namePool[String(pc.name).trim()] = true;
    if (pc && pc.lineDisplayName) namePool[String(pc.lineDisplayName).trim()] = true;
  }

  var poolKeys = Object.keys(namePool);
  var i;
  for (i = 0; i < poolKeys.length; i++) {
    if (poolKeys[i].toLowerCase() === qLower) addCandidate(poolKeys[i]);
  }
  if (Object.keys(candidateMap).length === 0) {
    for (i = 0; i < poolKeys.length; i++) {
      if (poolKeys[i].toLowerCase().indexOf(qLower) >= 0) addCandidate(poolKeys[i]);
    }
  }
  if (Object.keys(candidateMap).length === 0) addCandidate(rawQ);

  var authorized = {};
  var candKeys = Object.keys(candidateMap);
  var authOkAny = false;
  var lastAuthMsg = '查單密碼錯誤';
  for (i = 0; i < candKeys.length; i++) {
    var auth = gb_verifyLookupPin_(candKeys[i], lookupPin, portalCustomers);
    if (auth.ok) {
      authorized[candKeys[i].toLowerCase()] = true;
      authOkAny = true;
    } else if (auth.message) {
      lastAuthMsg = auth.message;
    }
  }
  if (!authOkAny) {
    var lookupState = gb_authThrottleFail_('lookup', rawQ, 8);
    if (Number(lookupState.until || 0) > Date.now()) lastAuthMsg = '嘗試次數過多，請約 15 分鐘後再試';
    return { portalConfig: portalConfig, matches: matches, lookupError: lastAuthMsg, dataRevision: all.dataRevision };
  }
  gb_authThrottleClear_('lookup', rawQ);

  for (gi = 0; gi < groups.length; gi++) {
    g = groups[gi];
    gb_attachGroupPortalFields_(g);
    orders = g.orders || [];
    for (oi = 0; oi < orders.length; oi++) {
      o = orders[oi];
      var on = String(o.customerName || '').trim();
      if (!authorized[on.toLowerCase()]) continue;
      matches.push({
        groupId: g.id, groupName: g.name, groupStatus: g.status,
        closingDate: g.closingDate, saleEndDate: g.saleEndDate,
        officialShipDate: g.officialShipDate, purchaseLink: g.purchaseLink || '',
        groupOrderId: String(g.orderId || ''), logisticsId: String(g.logisticsId || ''),
        description: String(g.description || ''),
        coverImageUrl: String(g.coverImageUrl || ''),
        imageUrls: g.imageUrls || [],
        remarks: String(g.remarks || ''),
        order: {
          id: o.id, customerName: o.customerName, totalTwd: o.totalTwd,
          deposit: o.deposit, domesticShip: o.domesticShip, intlShip: o.intlShip,
          balance: o.balance, paymentStatus: o.paymentStatus, paymentInfo: o.paymentInfo,
          items: o.items || []
        }
      });
    }
  }
  return { portalConfig: portalConfig, matches: matches, dataRevision: all.dataRevision };
}

function gb_publicRevision_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var cache = gb_loadSettingsMap_(sheet);
  return { dataRevision: String(cache.map.gb_dataRevision || '0') };
}

function gb_emptyGroupRow_(g, exportDate) {
  return [
    '', '', '', '', '', '', '', '', '', '', '', '',
    gb_shipDateText_(g.officialShipDate), g.name, g.id, g.status || '已登記',
    g.closingDate, g.saleEndDate, g.purchaseDate || '', g.jpyAmount,
    g.orderId, g.logisticsId, g.purchaseLink || '', '', '', exportDate
  ];
}

function gb_orderStubRow_(g, o, exportDate) {
  return [
    o.customerName, '', '', '', '', '', o.totalTwd, o.deposit, o.domesticShip, o.intlShip,
    o.balance, o.paymentStatus, gb_shipDateText_(g.officialShipDate), g.name, g.id, g.status || '已登記',
    g.closingDate, g.saleEndDate, g.purchaseDate || '', g.jpyAmount,
    g.orderId, g.logisticsId, g.purchaseLink || '', o.id, o.paymentInfo || '', exportDate
  ];
}

function gb_buildFlatRows_(groups, options) {
  options = options || {};
  var rows = [];
  var exportDate = new Date().toISOString().slice(0, 10);
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    if (!options.skipSettings) {
      gb_setGroupCreditCard_(g.id, g.creditCard || '');
      gb_setGroupPortalFields_(g, options);
      gb_setGroupCostFields_(g);
    }
    var orders = g.orders || [];
    if (!orders.length) {
      rows.push(gb_emptyGroupRow_(g, exportDate));
      continue;
    }
    for (var oi = 0; oi < orders.length; oi++) {
      var o = orders[oi];
      var items = o.items || [];
      if (!items.length) {
        rows.push(gb_orderStubRow_(g, o, exportDate));
        continue;
      }
      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        var qty = Number(it.qty) || 0;
        var jpy = Number(it.jpy) || 0;
        rows.push([
          o.customerName, it.name, qty, jpy, qty * jpy, Number(it.twd) || 0,
          o.totalTwd, o.deposit, o.domesticShip, o.intlShip, o.balance, o.paymentStatus,
          gb_shipDateText_(g.officialShipDate), g.name, g.id, g.status || '已登記',
          g.closingDate, g.saleEndDate, g.purchaseDate || '', g.jpyAmount,
          g.orderId, g.logisticsId, g.purchaseLink || '', o.id, o.paymentInfo || '', exportDate
        ]);
      }
    }
  }
  return rows;
}

function gb_journalNoteWithFive_(j) {
  var five = String(j.lastFive || '').replace(/\D/g, '');
  if (five.length >= 5) five = five.slice(-5);
  var note = String(j.note || '').trim();
  if (five && note.indexOf('#' + five) < 0 && note.indexOf('後五碼 ' + five) < 0) {
    note = note ? (note + ' #' + five) : ('#' + five);
  }
  return note;
}

function gb_writeJournalSheet_(bankJournal) {
  gb_initSheets_();
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_JOURNAL);
  var last = sheet.getLastRow();
  var oldCount = Math.max(0, last - 1);
  var list = bankJournal || [];
  var jRows = [];
  for (var i = 0; i < list.length; i++) {
    var j = list[i];
    jRows.push([j.id, j.date, j.bank, j.type, j.amount, j.category, gb_journalNoteWithFive_(j)]);
  }
  if (jRows.length > 0) sheet.getRange(2, 1, jRows.length, 7).setValues(jRows);
  if (oldCount > jRows.length) sheet.getRange(2 + jRows.length, 1, oldCount - jRows.length, 7).clearContent();
}

function gb_shipDateText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return value == null ? '' : String(value);
}

function gb_ensureShipDateTextFormat_(sheet, startRow, rowCount) {
  if (!sheet || !rowCount || rowCount < 1) return;
  sheet.getRange(startRow, GB_COL.SHIP_DATE + 1, rowCount, 1).setNumberFormat('@');
}

function gb_upsertJournalRows_(existing, incoming) {
  var byId = {};
  var i;
  var row;
  var id;
  for (i = 0; i < (existing || []).length; i++) {
    id = String(existing[i].id || '');
    if (id) byId[id] = existing[i];
  }
  var fresh = [];
  for (i = 0; i < (incoming || []).length; i++) {
    row = incoming[i];
    id = String(row.id || '');
    if (!id) continue;
    if (byId[id]) byId[id] = row;
    else fresh.push(row);
  }
  var out = fresh.slice();
  for (i = 0; i < (existing || []).length; i++) {
    id = String(existing[i].id || '');
    out.push(id && byId[id] ? byId[id] : existing[i]);
  }
  return out;
}

function gb_peekRevision_() {
  GB_SETTINGS_CACHE_ = null;
  var cache = gb_loadSettingsMap_();
  var changes = [];
  try { changes = JSON.parse(String(cache.map.gb_changeLog || '[]')); } catch (e1) { changes = []; }
  if (!Array.isArray(changes)) changes = [];
  return { dataRevision: String(cache.map.gb_dataRevision || '0'), changes: changes };
}

function gb_fetchSlice_(pl) {
  var all = gb_fetchAllData_();
  var wantG = {};
  var wantO = {};
  var i;
  var gids = (pl && pl.groupIds) || [];
  var oids = (pl && pl.orderIds) || [];
  for (i = 0; i < gids.length; i++) wantG[String(gids[i])] = true;
  for (i = 0; i < oids.length; i++) wantO[String(oids[i])] = true;
  var groups = [];
  for (i = 0; i < (all.groups || []).length; i++) {
    var g = all.groups[i];
    var takeGroup = !!wantG[String(g.id)];
    var filterOrders = oids.length > 0;
    var orders = [];
    var oi;
    for (oi = 0; oi < (g.orders || []).length; oi++) {
      if ((takeGroup && !filterOrders) || wantO[String(g.orders[oi].id)]) orders.push(g.orders[oi]);
    }
    if (!takeGroup && !orders.length) continue;
    var copy = {
      id: g.id, name: g.name, status: g.status, closingDate: g.closingDate, saleEndDate: g.saleEndDate,
      officialShipDate: g.officialShipDate, purchaseDate: g.purchaseDate, jpyAmount: g.jpyAmount,
      orderId: g.orderId, logisticsId: g.logisticsId, purchaseLink: g.purchaseLink,
      orders: orders
    };
    groups.push(copy);
  }
  return {
    dataRevision: String(all.dataRevision || '0'),
    groups: groups,
    paymentReports: all.paymentReports || [],
    bankJournal: all.bankJournal || []
  };
}

function gb_saveBankJournal_(pl) {
  return gb_withDocumentLock_(function () {
    var all = gb_fetchAllData_();
    gb_requireRevision_(pl, all.dataRevision);
    var incoming = (pl && pl.bankJournal) || [];
    var mode = pl && pl.mode ? String(pl.mode) : 'replace';
    var next = mode === 'upsert' ? gb_upsertJournalRows_(all.bankJournal || [], incoming) : incoming;
    gb_writeJournalSheet_(next);
    var settingsSheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
    var nextRev = String(Number(all.dataRevision || 0) + 1);
    gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
    gb_appendChangeLog_(nextRev, [], []);
    return { status: 'success', bankJournal: gb_fetchAllData_().bankJournal, dataRevision: nextRev };
  });
}

function gb_deleteBankJournalRows_(pl) {
  return gb_withDocumentLock_(function () {
    var all = gb_fetchAllData_();
    gb_requireRevision_(pl, all.dataRevision);
    var ids = (pl && pl.ids ? pl.ids : []).map(String);
    var remove = {};
    var i;
    for (i = 0; i < ids.length; i++) remove[ids[i]] = true;
    var removed = [];
    var next = [];
    var rows = all.bankJournal || [];
    for (i = 0; i < rows.length; i++) {
      if (remove[String(rows[i].id)]) removed.push(rows[i]);
      else next.push(rows[i]);
    }
    gb_writeJournalSheet_(next);
    var settingsSheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
    var nextRev = String(Number(all.dataRevision || 0) + 1);
    gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
    gb_appendChangeLog_(nextRev, [], []);
    var opId = pl && pl.operationId ? String(pl.operationId) : 'journal_del_' + Date.now();
    gb_opSet_(opId, { type: 'journal_delete', ids: ids, removed: removed, at: Date.now() });
    return { ok: true, dataRevision: nextRev, bankJournal: gb_fetchAllData_().bankJournal, deleted: removed.length, operationId: opId };
  });
}

function gb_restoreBankJournalRows_(pl) {
  return gb_withDocumentLock_(function () {
    var all = gb_fetchAllData_();
    gb_requireRevision_(pl, all.dataRevision);
    var restore = (pl && pl.rows) || [];
    var deleteIds = (pl && pl.deleteIds ? pl.deleteIds : []).map(String);
    var remove = {};
    var i;
    for (i = 0; i < deleteIds.length; i++) remove[deleteIds[i]] = true;
    var current = all.bankJournal || [];
    var next = [];
    var kept = {};
    for (i = 0; i < current.length; i++) {
      var id = String(current[i].id || '');
      if (remove[id]) continue;
      next.push(current[i]);
      kept[id] = true;
    }
    var restored = 0;
    for (i = 0; i < restore.length; i++) {
      var row = restore[i];
      if (!row || !row.id) continue;
      var rid = String(row.id);
      if (kept[rid]) continue;
      next.push(row);
      kept[rid] = true;
      restored++;
    }
    gb_writeJournalSheet_(next);
    var settingsSheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
    var nextRev = String(Number(all.dataRevision || 0) + 1);
    gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
    gb_appendChangeLog_(nextRev, [], []);
    var opId = pl && pl.operationId ? String(pl.operationId) : 'journal_restore_' + Date.now();
    gb_opSet_(opId, { type: 'journal_restore', restored: restored, deleteIds: deleteIds, at: Date.now() });
    return { ok: true, dataRevision: nextRev, bankJournal: gb_fetchAllData_().bankJournal, restored: restored, operationId: opId };
  });
}

function gb_performSave_(payload) {
  return gb_withDocumentLock_(function () {
    return gb_performSaveLocked_(payload);
  });
}

function gb_parseRevMap_(raw) {
  try {
    var parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function gb_orderRev_(settings, orderId) {
  return String(gb_parseRevMap_(settings.gb_orderRevMap)[orderId] || '0');
}

function gb_groupRev_(settings, groupId) {
  return String(gb_parseRevMap_(settings.gb_groupRevMap)[groupId] || '0');
}

function gb_bumpRevMap_(sheet, key, id) {
  GB_SETTINGS_CACHE_ = null;
  var settings = gb_loadSettingsMap_(sheet).map;
  var map = gb_parseRevMap_(settings[key]);
  var next = parseInt(map[id] || '0', 10);
  if (isNaN(next)) next = 0;
  map[id] = String(next + 1);
  gb_upsertSetting_(sheet, key, JSON.stringify(map));
  return map[id];
}

function gb_performSaveLocked_(payload) {
  gb_initSheets_();
  var settingsSheetForRev = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  GB_SETTINGS_CACHE_ = null;
  var revCache = gb_loadSettingsMap_(settingsSheetForRev);
  var currentRev = String(revCache.map.gb_dataRevision || '0');
  var useOrderRevision = payload && payload.mutations && payload.orderRevisions;
  if (useOrderRevision) {
    if (!payload || payload.dataRevision == null || String(payload.dataRevision) === '') {
      throw new Error('缺少資料版本，請重新載入後再儲存');
    }
  } else {
    gb_requireRevision_(payload, currentRev);
  }
  if (payload && payload.mutations) return gb_applyMutationsLocked_(payload, currentRev);
  var ss = SpreadsheetApp.getActive();
  var orderSheet = ss.getSheetByName(GB_SHEET_ORDERS);
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);

  var rows = gb_buildFlatRows_(payload.groups || [], { skipImages: !!(payload && payload.skipUnchangedImages) });
  gb_writeOrderSheetSafe_(orderSheet, rows);

  // 日記帳與團務分開寫入，避免 saveAppData 覆蓋銀行日記帳

  if (payload.exchangeRate != null) {
    gb_upsertSetting_(settingsSheet, 'exchangeRate', String(payload.exchangeRate));
  }
  if (payload.portalConfig) {
    var pc = payload.portalConfig;
    gb_upsertSetting_(settingsSheet, 'portalTitle', pc.title || '');
    gb_upsertSetting_(settingsSheet, 'portalIntro', pc.intro || '');
    gb_upsertSetting_(settingsSheet, 'portalWebsiteUrl', pc.websiteUrl || '');
    gb_upsertSetting_(settingsSheet, 'portalGroupUrl', pc.groupUrl || '');
    gb_upsertSetting_(settingsSheet, 'portalExtraNote', pc.extraNote || '');
    if (pc.lookupDesc != null) gb_upsertSetting_(settingsSheet, 'portalLookupDesc', pc.lookupDesc || '');
    if (pc.lineFriendUrl != null) gb_upsertSetting_(settingsSheet, 'portalLineFriendUrl', pc.lineFriendUrl || '');
    if (pc.lineShoppingUrl != null) gb_upsertSetting_(settingsSheet, 'portalLineShoppingUrl', pc.lineShoppingUrl || '');
    if (pc.instagramUrl != null) gb_upsertSetting_(settingsSheet, 'portalInstagramUrl', pc.instagramUrl || '');
    if (pc.threadsUrl != null) gb_upsertSetting_(settingsSheet, 'portalThreadsUrl', pc.threadsUrl || '');
    if (pc.preorderShopUrl != null) gb_upsertSetting_(settingsSheet, 'portalPreorderShopUrl', pc.preorderShopUrl || '');
    if (pc.spotShopUrl != null) gb_upsertSetting_(settingsSheet, 'portalSpotShopUrl', pc.spotShopUrl || '');
    if (pc.footer != null) gb_upsertSetting_(settingsSheet, 'portalFooter', pc.footer || '');
    if (pc.avatarUrl != null) gb_upsertSetting_(settingsSheet, 'portalAvatarUrl', pc.avatarUrl || '');
    if (pc.announcements != null) gb_upsertSetting_(settingsSheet, 'portalAnnouncementsJson', JSON.stringify(pc.announcements));
    if (pc.faqItems != null) gb_upsertSetting_(settingsSheet, 'portalFaqJson', JSON.stringify(pc.faqItems));
    if (pc.processSteps != null) gb_upsertSetting_(settingsSheet, 'portalProcessStepsJson', JSON.stringify(pc.processSteps));
    if (pc.guideInfographics != null) {
      gb_upsertSetting_(settingsSheet, 'portalGuideInfographicsJson', JSON.stringify(pc.guideInfographics));
    }
    if (pc.homeOpenGroupIds != null) {
      var ids = (pc.homeOpenGroupIds || []).map(function (x) { return String(x || ''); }).filter(Boolean).slice(0, 3);
      gb_upsertSetting_(settingsSheet, 'portalHomeOpenGroupIdsJson', JSON.stringify(ids));
    }
    if (pc.socialIconSlots != null) {
      gb_upsertSetting_(settingsSheet, 'portalSocialIconSlotsJson', JSON.stringify(pc.socialIconSlots));
    }
    if (pc.teachCards != null) {
      gb_upsertSetting_(settingsSheet, 'portalTeachCardsJson', JSON.stringify(pc.teachCards));
    }
  }
  if (payload.paymentReports) {
    gb_writePaymentReports_(settingsSheet, payload.paymentReports);
  }
  if (payload.portalLookupCustomers) {
    gb_writePortalLookupCustomers_(settingsSheet, payload.portalLookupCustomers);
  }
  if (payload.customerBalanceMemos) {
    gb_writeCustomerBalanceMemos_(settingsSheet, payload.customerBalanceMemos);
  }
  if (payload.consolidationShipments) {
    gb_writeConsolidationShipments_(settingsSheet, payload.consolidationShipments);
  }
  var revNum = parseInt(currentRev, 10);
  if (isNaN(revNum)) revNum = 0;
  var nextRev = String(revNum + 1);
  gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
  return { status: 'success', dataRevision: nextRev };
}

function gb_upsertSetting_(sheet, key, value) {
  var cache = gb_loadSettingsMap_(sheet);
  var next = value == null ? '' : String(value);
  if (Object.prototype.hasOwnProperty.call(cache.map, key) && String(cache.map[key] == null ? '' : cache.map[key]) === next) {
    return;
  }
  cache.map[key] = value;
  var sh = cache.sheet || sheet;
  var row = cache.rowOf[key];
  if (row) {
    sh.getRange(row, 2).setValue(value);
    return;
  }
  sh.appendRow([key, value]);
  cache.rowOf[key] = sh.getLastRow();
}

function gb_readPaymentReports_(settings) {
  try {
    var raw = settings.paymentReportsJson;
    if (!raw) return [];
    var parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function gb_writePaymentReports_(sheet, reports) {
  gb_upsertSetting_(sheet, 'paymentReportsJson', JSON.stringify(reports || []));
}

function gb_readPortalLookupCustomers_(settings) {
  try {
    var raw = settings.portalLookupCustomersJson;
    if (!raw) return [];
    var parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function gb_writePortalLookupCustomers_(sheet, list) {
  gb_upsertSetting_(sheet, 'portalLookupCustomersJson', JSON.stringify(list || []));
}

function gb_readCustomerBalanceMemos_(settings) {
  try {
    var raw = settings.customerBalanceMemosJson;
    if (!raw) return [];
    var parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function gb_writeCustomerBalanceMemos_(sheet, list) {
  gb_upsertSetting_(sheet, 'customerBalanceMemosJson', JSON.stringify(list || []));
}

function gb_readConsolidationShipments_(settings) {
  try {
    var raw = settings.consolidationShipmentsJson;
    if (!raw) return [];
    var parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function gb_writeConsolidationShipments_(sheet, list) {
  gb_upsertSetting_(sheet, 'consolidationShipmentsJson', JSON.stringify(list || []));
}

var GB_BANK_VIEWER_LOG_LIMIT = 400;

function gb_defaultBankViewerConfig_() {
  return {
    enabled: true,
    accessPassword: '',
    passwordUpdatedAt: 0,
    bankInfo: '請向團主索取查詢密碼後於此頁查看匯款帳號。\n\n（後台可編輯實際銀行帳號資訊）',
    logs: []
  };
}

function gb_pickAccessPassword_(o, fallback) {
  var candidates = [o && o.accessPassword, o && o.password];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] == null) continue;
    var s = String(candidates[i]).trim();
    if (s) return s;
  }
  return fallback;
}

function gb_migrateBankPassword_(sheet, settings, cfg) {
  var legacy = '';
  try {
    if (settings && settings.bankViewerJson) {
      var parsed = JSON.parse(String(settings.bankViewerJson));
      legacy = String(gb_pickAccessPassword_(parsed, '') || '').trim();
    }
  } catch (e) {}
  if (legacy && !String(heinaBankPassword_() || '').trim()) {
    heinaSetScriptProp_(HEINA_PROP_BANK_PASSWORD, legacy);
  }
  if (sheet && legacy) {
    cfg.accessPassword = '';
    gb_writeBankViewerConfig_(sheet, cfg);
  }
  cfg.accessPassword = '';
  return cfg;
}

function gb_readBankViewerConfig_(settings) {
  var d = gb_defaultBankViewerConfig_();
  try {
    var raw = settings && settings.bankViewerJson;
    if (!raw) return d;
    var o = JSON.parse(String(raw));
    if (!o || typeof o !== 'object') return d;
    var logs = [];
    if (Array.isArray(o.logs)) {
      for (var i = 0; i < o.logs.length && logs.length < GB_BANK_VIEWER_LOG_LIMIT; i++) {
        var row = o.logs[i];
        if (!row || typeof row !== 'object') continue;
        logs.push({
          id: String(row.id || ('bl_' + Date.now())),
          at: Number(row.at) || Date.now(),
          customerName: String(row.customerName || '').trim(),
          ok: !!row.ok,
          reason: String(row.reason || (row.ok ? 'ok' : 'bad_password'))
        });
      }
    }
    return {
      enabled: o.enabled !== false,
      accessPassword: gb_pickAccessPassword_(o, d.accessPassword),
      passwordUpdatedAt: Number(o.passwordUpdatedAt) || d.passwordUpdatedAt,
      bankInfo: String(o.bankInfo != null ? o.bankInfo : d.bankInfo),
      logs: logs
    };
  } catch (e) {
    return d;
  }
}

function gb_writeBankViewerConfig_(sheet, cfg) {
  var safe = cfg || gb_defaultBankViewerConfig_();
  // Password stays in Script Properties, not in the sheet JSON.
  var out = {
    enabled: safe.enabled !== false,
    passwordUpdatedAt: Number(safe.passwordUpdatedAt) || 0,
    bankInfo: String(safe.bankInfo || ''),
    logs: safe.logs || []
  };
  gb_upsertSetting_(sheet, 'bankViewerJson', JSON.stringify(out));
}

function gb_monthsSinceBankPassword_(ts) {
  var ms = Math.max(0, Date.now() - (Number(ts) || 0));
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30.4375));
}

function gb_bankViewerPublicMeta_(cfg) {
  var c = cfg || gb_defaultBankViewerConfig_();
  return {
    enabled: c.enabled !== false,
    passwordSet: !!String(heinaBankPassword_() || '').trim(),
    passwordUpdatedAt: Number(c.passwordUpdatedAt) || 0,
    monthsSincePasswordUpdate: gb_monthsSinceBankPassword_(c.passwordUpdatedAt)
  };
}

function gb_bankViewerAdminView_(cfg) {
  var c = cfg || gb_defaultBankViewerConfig_();
  var password = heinaBankPassword_();
  return {
    enabled: c.enabled !== false,
    accessPassword: password,
    passwordSet: !!String(password).trim(),
    passwordUpdatedAt: Number(c.passwordUpdatedAt) || 0,
    bankInfo: String(c.bankInfo || ''),
    logs: c.logs || []
  };
}

function gb_appendBankViewerLog_(cfg, entry) {
  var row = {
    id: entry.id || ('bl_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
    at: entry.at || Date.now(),
    customerName: String(entry.customerName || '').trim(),
    ok: !!entry.ok,
    reason: String(entry.reason || 'bad_password')
  };
  var logs = [row].concat(cfg.logs || []);
  if (logs.length > GB_BANK_VIEWER_LOG_LIMIT) logs = logs.slice(0, GB_BANK_VIEWER_LOG_LIMIT);
  return {
    enabled: cfg.enabled,
    accessPassword: cfg.accessPassword,
    passwordUpdatedAt: cfg.passwordUpdatedAt,
    bankInfo: cfg.bankInfo,
    logs: logs
  };
}

function gb_loadBankViewerFromSheet_() {
  gb_initSheets_();
  var ss = SpreadsheetApp.getActive();
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  var settings = gb_loadSettingsMap_(settingsSheet).map;
  return {
    sheet: settingsSheet,
    config: gb_migrateBankPassword_(settingsSheet, settings, gb_readBankViewerConfig_(settings))
  };
}

function gb_getBankViewerAdmin_() {
  var loaded = gb_loadBankViewerFromSheet_();
  return { ok: true, config: gb_bankViewerAdminView_(loaded.config) };
}

function gb_saveBankViewer_(pl) {
  var loaded = gb_loadBankViewerFromSheet_();
  var prev = loaded.config;
  var next = {
    enabled: pl && pl.enabled !== undefined ? !!pl.enabled : prev.enabled,
    accessPassword: '',
    passwordUpdatedAt: prev.passwordUpdatedAt,
    bankInfo: pl && pl.bankInfo !== undefined ? String(pl.bankInfo) : prev.bankInfo,
    logs: pl && pl.clearLogs ? [] : (prev.logs || [])
  };
  if (pl && pl.newPassword != null && String(pl.newPassword).trim() !== '') {
    heinaSetScriptProp_(HEINA_PROP_BANK_PASSWORD, String(pl.newPassword).trim());
    next.passwordUpdatedAt = Date.now();
  }
  gb_writeBankViewerConfig_(loaded.sheet, next);
  return { ok: true, message: '已儲存銀行帳號查詢設定', config: gb_bankViewerAdminView_(next) };
}

function gb_verifyBankViewerAccess_(pl) {
  var loaded = gb_loadBankViewerFromSheet_();
  var cfg = loaded.config;
  var customerName = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var accessPassword = '';
  if (pl) {
    if (pl.accessPassword != null) accessPassword = String(pl.accessPassword);
    else if (pl.password != null) accessPassword = String(pl.password);
  }
  var want = heinaBankPassword_();
  var nextCfg;
  var result;

  if (!cfg.enabled) {
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: false, reason: 'disabled' });
    result = { ok: false, message: '目前未開放查詢銀行帳號，請私訊團主。' };
  } else if (!customerName) {
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: '', ok: false, reason: 'empty_name' });
    result = { ok: false, message: '請填寫你在群裡的名字。' };
  } else if (gb_authThrottleLocked_('bank', customerName)) {
    return { ok: false, message: '嘗試次數過多，請約 15 分鐘後再試。' };
  } else if (!String(want).trim()) {
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: false, reason: 'empty_password' });
    result = { ok: false, message: '團主尚未設定查詢密碼，請私訊索取。' };
  } else if (!heinaSafeEqual_(accessPassword, want)) {
    gb_authThrottleFail_('bank', customerName, 5);
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: false, reason: 'bad_password' });
    result = { ok: false, message: '查詢密碼錯誤。請向團主索取最新密碼後再試。' };
  } else {
    gb_authThrottleClear_('bank', customerName);
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: true, reason: 'ok' });
    result = {
      ok: true,
      message: '驗證成功',
      bankInfo: String(cfg.bankInfo || '').trim() || '（尚無銀行帳號資料，請私訊團主）'
    };
  }

  gb_writeBankViewerConfig_(loaded.sheet, nextCfg);
  return result;
}

function gb_sheetToAoa_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return [];
  var cols = Math.max(sheet.getLastColumn(), 1);
  var rows = sheet.getLastRow();
  return sheet.getRange(1, 1, rows, cols).getValues();
}

function gb_exportDataPack_() {
  gb_initSheets_();
  var ss = SpreadsheetApp.getActive();
  var orderSheet = ss.getSheetByName(GB_SHEET_ORDERS);
  var journalSheet = ss.getSheetByName(GB_SHEET_JOURNAL);
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  var all = gb_fetchAllData_();
  var groupSummary = [['團ID', '團名', '狀態', '結單日', '販售截止', '官方出貨', '日幣總額', '訂單數']];
  (all.groups || []).forEach(function (g) {
    groupSummary.push([
      g.id || '',
      g.name || '',
      g.status || '',
      g.closingDate || '',
      g.saleEndDate || '',
      g.officialShipDate || '',
      g.jpyAmount != null ? g.jpyAmount : '',
      (g.orders || []).length
    ]);
  });
  var pack = {
    packVersion: 1,
    exportedAt: new Date().toISOString(),
    source: 'gas',
    orderRows: gb_sheetToAoa_(orderSheet),
    journalRows: gb_sheetToAoa_(journalSheet),
    settingsRows: gb_sheetToAoa_(settingsSheet),
    groupSummaryRows: groupSummary
  };
  return { ok: true, message: '已匯出資料包', pack: pack };
}

function gb_aoaBody_(rows) {
  if (!rows || !rows.length) return [];
  return rows.slice(1);
}

function gb_importDataPack_(pl) {
  gb_initSheets_();
  var pack = pl && pl.pack ? pl.pack : null;
  if (!pack) return { ok: false, message: '資料包格式無效' };
  var mode = pl.mode === 'merge' ? 'merge' : 'replace';
  var want = {};
  var sheets = pl.sheets && pl.sheets.length ? pl.sheets : ['訂單明細', '銀行日記帳', '系統設定'];
  for (var si = 0; si < sheets.length; si++) want[String(sheets[si])] = true;

  var ss = SpreadsheetApp.getActive();
  var orderSheet = ss.getSheetByName(GB_SHEET_ORDERS);
  var journalSheet = ss.getSheetByName(GB_SHEET_JOURNAL);
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  var counts = { orderRows: 0, journalRows: 0, settingsRows: 0 };

  if (want['訂單明細'] && pack.orderRows && pack.orderRows.length) {
    var orderBody = gb_aoaBody_(pack.orderRows);
    counts.orderRows = orderBody.length;
    if (mode === 'replace') {
      var olast = orderSheet.getLastRow();
      if (olast > 1) orderSheet.getRange(2, 1, olast, GB_COLS).clearContent();
      if (orderBody.length) {
        var ovals = orderBody.map(function (r) {
          var row = [];
          for (var c = 0; c < GB_COLS; c++) row.push(r[c] != null ? r[c] : '');
          return row;
        });
        orderSheet.getRange(2, 1, ovals.length, GB_COLS).setValues(ovals);
      }
    } else {
      var all = gb_fetchAllData_();
      var flat = gb_buildFlatRows_(all.groups || []);
      var byOrder = {};
      for (var fi = 0; fi < flat.length; fi++) {
        byOrder[String(flat[fi][GB_COL.ORDER_ID] || '') + '|' + String(flat[fi][GB_COL.GROUP_ID] || '')] = flat[fi];
      }
      for (var oi = 0; oi < orderBody.length; oi++) {
        var rr = orderBody[oi];
        var key = String(rr[GB_COL.ORDER_ID] || '') + '|' + String(rr[GB_COL.GROUP_ID] || '');
        var row = [];
        for (var cc = 0; cc < GB_COLS; cc++) row.push(rr[cc] != null ? rr[cc] : '');
        byOrder[key] = row;
      }
      var merged = [];
      for (var k in byOrder) {
        if (Object.prototype.hasOwnProperty.call(byOrder, k)) merged.push(byOrder[k]);
      }
      var olast2 = orderSheet.getLastRow();
      if (olast2 > 1) orderSheet.getRange(2, 1, olast2, GB_COLS).clearContent();
      if (merged.length) {
        orderSheet.getRange(2, 1, merged.length, GB_COLS).setValues(merged);
      }
    }
  }

  if (want['銀行日記帳'] && pack.journalRows && pack.journalRows.length) {
    var jBody = gb_aoaBody_(pack.journalRows);
    counts.journalRows = jBody.length;
    if (mode === 'replace') {
      var jlast = journalSheet.getLastRow();
      if (jlast > 1) journalSheet.getRange(2, 1, jlast, 7).clearContent();
      if (jBody.length) {
        var jvals = jBody.map(function (r) {
          return [r[0] || '', r[1] || '', r[2] || '', r[3] || '', r[4] || '', r[5] || '', r[6] || ''];
        });
        journalSheet.getRange(2, 1, jvals.length, 7).setValues(jvals);
      }
    } else {
      var existingJ = {};
      var cur = gb_sheetToAoa_(journalSheet);
      for (var ji = 1; ji < cur.length; ji++) {
        existingJ[String(cur[ji][0] || '')] = cur[ji];
      }
      for (var jj = 0; jj < jBody.length; jj++) {
        var jr = jBody[jj];
        existingJ[String(jr[0] || '')] = [jr[0] || '', jr[1] || '', jr[2] || '', jr[3] || '', jr[4] || '', jr[5] || '', jr[6] || ''];
      }
      var jMerged = [];
      for (var jk in existingJ) {
        if (Object.prototype.hasOwnProperty.call(existingJ, jk) && jk) jMerged.push(existingJ[jk]);
      }
      var jlast2 = journalSheet.getLastRow();
      if (jlast2 > 1) journalSheet.getRange(2, 1, jlast2, 7).clearContent();
      if (jMerged.length) journalSheet.getRange(2, 1, jMerged.length, 7).setValues(jMerged);
    }
  }

  if (want['系統設定'] && pack.settingsRows && pack.settingsRows.length) {
    var sBody = gb_aoaBody_(pack.settingsRows);
    counts.settingsRows = sBody.length;
    for (var sk = 0; sk < sBody.length; sk++) {
      var key = String(sBody[sk][0] || '').trim();
      if (!key) continue;
      gb_upsertSetting_(settingsSheet, key, String(sBody[sk][1] != null ? sBody[sk][1] : ''));
    }
  }

  try {
    if (typeof shub_log_ === 'function') {
      shub_log_('datapack', 'importDataPack', mode, JSON.stringify(counts), 'HeinaDataPack');
    }
  } catch (eLog) {}

  return {
    ok: true,
    message: mode === 'replace' ? '已覆蓋匯入資料包' : '已合併匯入資料包',
    counts: counts
  };
}

function gb_findPortalLookupCustomer_(name, list) {
  var q = String(name || '').trim();
  if (!q) return null;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (String(c.lineDisplayName || '').trim() === q || String(c.name || '').trim() === q) return c;
  }
  return null;
}

function gb_authThrottleKey_(scope, name) {
  var raw = String(scope || '') + '|' + String(name || '').trim().toLowerCase();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  var hex = '';
  for (var i = 0; i < digest.length; i++) hex += ('0' + (digest[i] & 255).toString(16)).slice(-2);
  return 'heina_auth_' + hex.slice(0, 40);
}

function gb_authThrottleState_(scope, name) {
  try {
    var raw = CacheService.getScriptCache().get(gb_authThrottleKey_(scope, name));
    var state = raw ? JSON.parse(raw) : null;
    if (state && typeof state === 'object') return state;
  } catch (e) {}
  return { fails: 0, until: 0 };
}

function gb_authThrottleLocked_(scope, name) {
  var state = gb_authThrottleState_(scope, name);
  return Number(state.until || 0) > Date.now();
}

function gb_authThrottleFail_(scope, name, limit) {
  var state = gb_authThrottleState_(scope, name);
  if (Number(state.until || 0) > Date.now()) return state;
  state.fails = Number(state.fails || 0) + 1;
  if (state.fails >= (Number(limit) || 8)) state.until = Date.now() + 15 * 60 * 1000;
  CacheService.getScriptCache().put(gb_authThrottleKey_(scope, name), JSON.stringify(state), 900);
  return state;
}

function gb_authThrottleClear_(scope, name) {
  CacheService.getScriptCache().remove(gb_authThrottleKey_(scope, name));
}

function gb_verifyLookupPin_(name, pin, list) {
  var normalized = String(pin || '').replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(normalized)) return { ok: false, message: '請輸入 4 位數查單密碼' };
  var entry = gb_findPortalLookupCustomer_(name, list || []);
  var stored = entry ? String(entry.lookupPin || '').replace(/\D/g, '').slice(0, 4) : '';
  var expected = /^\d{4}$/.test(stored) ? stored : heinaLookupPin_();
  if (!/^\d{4}$/.test(expected)) {
    return { ok: false, message: '查單密碼尚未設定，請聯絡團主' };
  }
  if (expected !== normalized) {
    return { ok: false, message: '查單密碼錯誤' };
  }
  return { ok: true };
}

function gb_publicBootstrap_() {
  var loaded = gb_loadBankViewerFromSheet_();
  return { ok: true, bankViewer: gb_bankViewerPublicMeta_(loaded.config) };
}

function gb_customerBalanceMemos_(pl) {
  var name = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var pin = pl && pl.lookupPin != null ? String(pl.lookupPin) : '';
  if (!name) return { ok: false, message: '請輸入查詢名稱', memos: [] };
  if (gb_authThrottleLocked_('memos', name)) {
    return { ok: false, message: '嘗試次數過多，請約 15 分鐘後再試', memos: [] };
  }
  var all = gb_fetchAllData_();
  var auth = gb_verifyLookupPin_(name, pin, all.portalLookupCustomers || []);
  if (!auth.ok) {
    gb_authThrottleFail_('memos', name, 8);
    return { ok: false, message: auth.message || '查單密碼錯誤', memos: [] };
  }
  gb_authThrottleClear_('memos', name);
  var want = name.replace(/\s+/g, '').toLowerCase();
  var memos = [];
  var list = all.customerBalanceMemos || [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m) continue;
    var n = String(m.customerName || '').replace(/\s+/g, '').toLowerCase();
    if (n === want) memos.push(m);
  }
  return { ok: true, memos: memos };
}

function gb_upsertPortalLookupPin_(list, name, newPin) {
  var q = String(name || '').trim();
  var pin = String(newPin || '').replace(/\D/g, '').slice(0, 4);
  var next = [];
  var found = false;
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    if (String(c.lineDisplayName || '').trim() === q || String(c.name || '').trim() === q) {
      next.push({
        name: c.name || q,
        lineDisplayName: c.lineDisplayName || q,
        lookupPin: pin
      });
      found = true;
    } else {
      next.push(c);
    }
  }
  if (!found) next.push({ name: q, lineDisplayName: q, lookupPin: pin });
  return next;
}

function gb_changeLookupPin_(pl) {
  gb_initSheets_();
  var all = gb_fetchAllData_();
  var name = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var currentPin = pl && pl.currentPin != null ? String(pl.currentPin) : '';
  var newPin = pl && pl.newPin != null ? String(pl.newPin) : '';
  var confirmPin = pl && pl.confirmPin != null ? String(pl.confirmPin) : '';
  if (!name) return { ok: false, message: '請輸入查詢名稱' };
  if (gb_authThrottleLocked_('change_pin', name)) {
    return { ok: false, message: '嘗試次數過多，請約 15 分鐘後再試' };
  }
  var cur = currentPin.replace(/\D/g, '').slice(0, 4);
  var next = newPin.replace(/\D/g, '').slice(0, 4);
  var confirm = confirmPin.replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(cur)) return { ok: false, message: '請輸入目前的 4 位數密碼' };
  if (!/^\d{4}$/.test(next)) return { ok: false, message: '新密碼須為 4 位數字' };
  if (next !== confirm) return { ok: false, message: '兩次新密碼不一致' };
  if (next === cur) return { ok: false, message: '新密碼不可與目前密碼相同' };
  var auth = gb_verifyLookupPin_(name, cur, all.portalLookupCustomers || []);
  if (!auth.ok) {
    gb_authThrottleFail_('change_pin', name, 8);
    return { ok: false, message: auth.message || '目前密碼錯誤' };
  }
  gb_authThrottleClear_('change_pin', name);
  var nextList = gb_upsertPortalLookupPin_(all.portalLookupCustomers || [], name, next);
  var ss = SpreadsheetApp.getActive();
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  gb_writePortalLookupCustomers_(settingsSheet, nextList);
  return { ok: true, message: '查單密碼已更新', lookupPin: next };
}

function gb_calcOrderBalance_(totalTwd, deposit, domesticShip, intlShip) {
  return (Number(totalTwd) || 0) - (Number(deposit) || 0) + (Number(domesticShip) || 0) + (Number(intlShip) || 0);
}

function gb_formatRemittancePaymentInfo_(isoDate, bank, note) {
  var parts = String(isoDate || '').trim().split('-');
  var dateStr = parts.length === 3 ? parts[0] + '/' + parts[1] + '/' + parts[2] : isoDate;
  var bankLabel = String(bank || '').trim() || '待分類';
  var trimmed = String(note || '').trim();
  if (trimmed) return dateStr + ' ' + bankLabel + ' #' + trimmed;
  return dateStr + ' ' + bankLabel;
}

function gb_suggestDeposit_(totalTwd) {
  var t = Number(totalTwd) || 0;
  return t > 20 ? t - 20 : t;
}

function gb_calcItemsTotalTwd_(items) {
  var sum = 0;
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    sum += (Number(it.twd) || 0) * (Number(it.qty) || 1);
  }
  return sum;
}

/** 未付款且訂金未填／0 → 自動總額−20；貨到付款固定 0 */
function gb_orderReceivableDeposit_(o) {
  if (String(o.paymentStatus || '').trim() === '貨到付款') return 0;
  var total = Number(o.totalTwd) || gb_calcItemsTotalTwd_(o.items || []);
  var n = Number(o.deposit);
  var hasValue = o.deposit !== undefined && o.deposit !== null && String(o.deposit).trim() !== '';
  if (hasValue && isFinite(n) && n > 0) return Math.round(n);
  var unpaid = !o.paymentStatus || String(o.paymentStatus).trim() === '未付款';
  if (unpaid) return Math.round(gb_suggestDeposit_(total));
  if (hasValue && isFinite(n) && n >= 0) return Math.round(n);
  return Math.round(gb_suggestDeposit_(total));
}

function gb_buildPaymentReportLines_(groups, orderIds) {
  var wanted = {};
  for (var wi = 0; wi < orderIds.length; wi++) wanted[orderIds[wi]] = true;
  var lines = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    var orders = g.orders || [];
    for (var oi = 0; oi < orders.length; oi++) {
      var o = orders[oi];
      if (!wanted[o.id]) continue;
      var deposit = gb_orderReceivableDeposit_(o);
      lines.push({
        orderId: o.id,
        groupId: g.id,
        groupName: g.name,
        lookupCode: o.id,
        deposit: deposit,
        expectedDeposit: deposit
      });
    }
  }
  return lines;
}

function gb_submitPaymentReport_(pl) {
  return gb_withDocumentLock_(function () {
    return gb_submitPaymentReportLocked_(pl);
  });
}

function gb_submitPaymentReportLocked_(pl) {
  var customerName = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var remittanceDate = pl && pl.remittanceDate ? String(pl.remittanceDate).trim() : '';
  var lastFive = pl && pl.lastFive ? String(pl.lastFive).trim() : '';
  var totalAmount = Math.round(Number(pl && pl.totalAmount) || 0);
  var orderIds = pl && pl.orderIds ? pl.orderIds : [];
  var clientRequestId = pl && pl.clientRequestId ? String(pl.clientRequestId).trim() : '';
  var lookupPin = pl && pl.lookupPin != null ? String(pl.lookupPin) : '';
  if (!customerName) return { ok: false, message: '請先查詢訂單' };
  if (!remittanceDate) return { ok: false, message: '請填寫匯款日期' };
  if (!/^\d{5}$/.test(lastFive)) return { ok: false, message: '後五碼需為 5 位數字' };
  if (totalAmount <= 0) return { ok: false, message: '請填寫匯款總金額' };
  if (!orderIds.length) return { ok: false, message: '請至少勾選一筆待付訂單' };
  if (gb_authThrottleLocked_('submit_report', customerName)) {
    return { ok: false, message: '查單驗證嘗試次數過多，請約 15 分鐘後再試' };
  }

  var all = gb_fetchAllData_();
  var lookupAuth = gb_verifyLookupPin_(customerName, lookupPin, all.portalLookupCustomers || []);
  if (!lookupAuth.ok) {
    gb_authThrottleFail_('submit_report', customerName, 8);
    return { ok: false, message: lookupAuth.message || '查單密碼錯誤，請重新查單後再送出' };
  }
  gb_authThrottleClear_('submit_report', customerName);
  var groups = all.groups || [];
  var reports = all.paymentReports || [];
  var wantedKey = orderIds.map(String).sort().join('|');
  for (var du = 0; du < reports.length; du++) {
    var existing = reports[du];
    if (clientRequestId && String(existing.clientRequestId || '') === clientRequestId) {
      return { ok: true, duplicate: true, reportId: existing.id, message: '此付款回報已送出，無需重複送出' };
    }
    if (
      !clientRequestId &&
      String(existing.customerName || '').trim() === customerName &&
      String(existing.remittanceDate || '') === remittanceDate &&
      String(existing.lastFive || '') === lastFive &&
      Number(existing.totalAmount || 0) === totalAmount &&
      (existing.orderIds || []).map(String).sort().join('|') === wantedKey
    ) {
      return { ok: true, duplicate: true, reportId: existing.id, message: '相同付款回報已存在，無需重複送出' };
    }
  }
  var lines = gb_buildPaymentReportLines_(groups, orderIds);
  if (lines.length !== orderIds.length) {
    return { ok: false, message: '部分訂單不存在或已變更，請重新查詢' };
  }
  for (var li = 0; li < lines.length; li++) {
    var g = null;
    var o = null;
    for (var gi = 0; gi < groups.length; gi++) {
      if (groups[gi].id === lines[li].groupId) {
        g = groups[gi];
        break;
      }
    }
    if (!g) return { ok: false, message: '訂單資料有誤，請重新查詢' };
    for (var oi = 0; oi < (g.orders || []).length; oi++) {
      if (g.orders[oi].id === lines[li].orderId) o = g.orders[oi];
    }
    if (!o) return { ok: false, message: '訂單資料有誤，請重新查詢' };
    if (String(o.customerName || '').trim() !== customerName) {
      return { ok: false, message: '訂單與查詢名稱不符' };
    }
    if (o.paymentStatus !== '未付款') {
      return { ok: false, message: '訂單 ' + lines[li].lookupCode + ' 已不是待付款狀態' };
    }
  }
  var wanted = {};
  for (var wi = 0; wi < orderIds.length; wi++) wanted[orderIds[wi]] = true;
  for (var ri = 0; ri < reports.length; ri++) {
    if (reports[ri].status !== 'pending') continue;
    for (var oj = 0; oj < reports[ri].orderIds.length; oj++) {
      if (wanted[reports[ri].orderIds[oj]]) {
        return { ok: false, message: '已有待確認的付款回報，請等待團主核對' };
      }
    }
  }
  var report = {
    id: 'pr_' + Date.now() + '_' + Math.random().toString(16).slice(2, 6),
    customerName: customerName,
    remittanceDate: remittanceDate,
    lastFive: lastFive,
    totalAmount: totalAmount,
    reportedTotalAmount: totalAmount,
    orderIds: orderIds,
    lines: lines,
    status: 'pending',
    submittedAt: Date.now()
  };
  if (clientRequestId) report.clientRequestId = clientRequestId;
  var rawMemos = pl && pl.balanceMemos ? pl.balanceMemos : [];
  if (rawMemos && rawMemos.length) {
    var balanceMemos = [];
    for (var mi = 0; mi < rawMemos.length; mi++) {
      if (!rawMemos[mi] || !rawMemos[mi].id) continue;
      balanceMemos.push({
        id: String(rawMemos[mi].id),
        amountTwd: Math.round(Number(rawMemos[mi].amountTwd) || 0),
      });
    }
    if (balanceMemos.length) report.balanceMemos = balanceMemos;
  }
  reports.unshift(report);
  var ss = SpreadsheetApp.getActive();
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);
  gb_writePaymentReports_(settingsSheet, reports);
  var nextRev = String(Number(all.dataRevision || 0) + 1);
  gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
  gb_appendChangeLog_(nextRev, orderIds, []);
  return {
    ok: true,
    reportId: report.id,
    dataRevision: nextRev,
    message: '付款回報已送出\n將於 2-5 天內完成對帳並更新付款狀態。若超過期限仍未更新，請私訊官方。',
  };
}

function gb_resolvePaymentReportLineDeposit_(orderId, fallback, lineDeposits) {
  if (lineDeposits && lineDeposits[orderId] != null) {
    return Math.max(0, Math.round(Number(lineDeposits[orderId]) || 0));
  }
  return Math.max(0, Math.round(Number(fallback) || 0));
}

function gb_lineExpectedDeposit_(line, liveOrder) {
  if (liveOrder) return Math.max(0, Math.round(gb_orderReceivableDeposit_(liveOrder)));
  var exp = line.expectedDeposit != null ? line.expectedDeposit : line.deposit;
  return Math.max(0, Math.round(Number(exp) || 0));
}

function gb_claimOperation_(opId) {
  if (!opId) return { proceed: true };
  var outcome = gb_withDocumentLock_(function () {
    var prev = gb_opGet_(opId);
    if (prev && prev.status === 'done' && prev.result) return { proceed: false, result: prev.result };
    if (prev && prev.status === 'pending_journal') return { proceed: true };
    if (prev && prev.status === 'claimed' && prev.at && (new Date().getTime() - Number(prev.at)) < 20000) {
      return { proceed: false, busy: true };
    }
    gb_opSet_(opId, { status: 'claimed', at: new Date().getTime() });
    return { proceed: true };
  });
  if (outcome && outcome.busy) {
    var i;
    for (i = 0; i < 16; i++) {
      Utilities.sleep(500);
      var later = gb_opGet_(opId);
      if (later && later.status === 'done' && later.result) return { proceed: false, result: later.result };
    }
    return { proceed: false, result: { ok: false, message: '同一筆操作正在處理，請稍後再試', operationId: opId } };
  }
  return outcome;
}

function gb_confirmStoredResult_(confirmOpId) {
  if (!confirmOpId) return null;
  var prev = gb_opGet_(confirmOpId);
  if (prev && prev.status === 'done' && prev.result) return prev.result;
  if (prev && prev.status === 'pending_journal' && prev.journalRow) {
    var pendingList = gb_fetchAllData_().bankJournal || [];
    gb_writeJournalSheet_(gb_upsertJournalRows_(pendingList, [prev.journalRow]));
    var resumed = { ok: true, message: '已確認付款', operationId: confirmOpId };
    gb_opSet_(confirmOpId, { status: 'done', kind: 'confirm', journalRow: prev.journalRow, result: resumed });
    return resumed;
  }
  return null;
}

function gb_confirmHealExisting_(reportId, confirmOpId) {
  if (!confirmOpId) return null;
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var report = null;
  var i;
  for (i = 0; i < reports.length; i++) if (reports[i].id === reportId) report = reports[i];
  if (!report || report.status !== 'confirmed') return null;
  var journalId = 'j_pr_' + confirmOpId;
  var existing = all.bankJournal || [];
  var found = null;
  for (i = 0; i < existing.length; i++) {
    if (String(existing[i].id) === journalId) found = existing[i];
  }
  if (!found) return null;
  var healed = { ok: true, message: '已確認付款', operationId: confirmOpId };
  gb_opSet_(confirmOpId, { status: 'done', kind: 'confirm', journalRow: found, result: healed });
  return healed;
}

function gb_confirmPaymentReport_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  var bank = pl && pl.remittanceBank ? String(pl.remittanceBank) : '待分類';
  var lineDeposits = pl && pl.lineDeposits ? pl.lineDeposits : null;
  var selectedOrderIds = pl && pl.selectedOrderIds ? pl.selectedOrderIds : null;
  if (!reportId) return { ok: false, message: '缺少回報 ID' };
  var confirmOpId = pl && pl.operationId ? String(pl.operationId) : '';
  var confirmClaim = gb_claimOperation_(confirmOpId);
  if (confirmClaim && confirmClaim.result) return confirmClaim.result;
  var storedConfirm = gb_confirmStoredResult_(confirmOpId);
  if (storedConfirm) return storedConfirm;
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var idx = -1;
  for (var i = 0; i < reports.length; i++) {
    if (reports[i].id === reportId && reports[i].status === 'pending') idx = i;
  }
  if (idx < 0) {
    var healedConfirm = gb_confirmHealExisting_(reportId, confirmOpId);
    if (healedConfirm) return healedConfirm;
    return { ok: false, message: '找不到待確認的付款回報' };
  }
  var report = reports[idx];
  var selected = {};
  if (selectedOrderIds && selectedOrderIds.length) {
    for (var si = 0; si < selectedOrderIds.length; si++) selected[selectedOrderIds[si]] = true;
  } else {
    for (var ti = 0; ti < report.orderIds.length; ti++) selected[report.orderIds[ti]] = true;
  }
  var confirmedLines = [];
  for (var cli = 0; cli < (report.lines || []).length; cli++) {
    if (selected[report.lines[cli].orderId]) confirmedLines.push(report.lines[cli]);
  }
  if (!confirmedLines.length) return { ok: false, message: '請至少勾選一筆團務' };

  var paymentInfo = gb_formatRemittancePaymentInfo_(report.remittanceDate, bank, report.lastFive);
  var groups = all.groups || [];
  var totalIn = 0;
  for (var gi = 0; gi < groups.length; gi++) {
    var orders = groups[gi].orders || [];
    for (var oi = 0; oi < orders.length; oi++) {
      if (!selected[orders[oi].id]) continue;
      var dep = gb_resolvePaymentReportLineDeposit_(
        orders[oi].id,
        gb_orderReceivableDeposit_(orders[oi]),
        lineDeposits
      );
      totalIn += dep;
      orders[oi].paymentStatus = '已付訂金';
      orders[oi].deposit = dep;
      orders[oi].balance = gb_calcOrderBalance_(orders[oi].totalTwd, dep, orders[oi].domesticShip, orders[oi].intlShip);
      orders[oi].paymentInfo = paymentInfo;
    }
  }
  var nextLines = [];
  for (var li = 0; li < confirmedLines.length; li++) {
    var line = confirmedLines[li];
    var lineDep = gb_resolvePaymentReportLineDeposit_(line.orderId, line.deposit, lineDeposits);
    var lineExp = gb_lineExpectedDeposit_(line);
    nextLines.push({
      orderId: line.orderId,
      groupId: line.groupId,
      groupName: line.groupName,
      lookupCode: line.lookupCode,
      expectedDeposit: line.expectedDeposit != null ? line.expectedDeposit : line.deposit,
      deposit: lineDep,
      needsSupplement: lineDep < lineExp,
      supplementTotal: 0
    });
  }
  var journalRow = {
    id: confirmOpId ? ('j_pr_' + confirmOpId) : ('j_pr_' + Date.now()),
    date: report.remittanceDate,
    bank: bank || '待分類',
    type: '收入',
    amount: totalIn,
    category: '團購訂金',
    lastFive: String(report.lastFive || '').replace(/\D/g, '').slice(-5),
    note: report.customerName + ' ' + confirmedLines.map(function (l) { return l.groupName; }).join('、')
  };
  var confirmedOrderIds = [];
  for (var coi = 0; coi < confirmedLines.length; coi++) confirmedOrderIds.push(confirmedLines[coi].orderId);
  var confirmedReport = {
    id: report.id,
    customerName: report.customerName,
    remittanceDate: report.remittanceDate,
    lastFive: report.lastFive,
    totalAmount: totalIn,
    reportedTotalAmount: report.reportedTotalAmount != null ? report.reportedTotalAmount : report.totalAmount,
    orderIds: confirmedOrderIds,
    lines: nextLines,
    status: 'confirmed',
    submittedAt: report.submittedAt,
    confirmedAt: Date.now(),
    confirmedBank: bank || '待分類',
    journalEntryId: journalRow.id,
    source: report.source || 'customer',
    clientRequestId: report.clientRequestId || '',
    balanceMemos: report.balanceMemos || []
  };
  var unselectedLines = [];
  for (var uli = 0; uli < (report.lines || []).length; uli++) {
    if (!selected[report.lines[uli].orderId]) unselectedLines.push(report.lines[uli]);
  }
  var nextReports = [];
  if (unselectedLines.length) {
    var unselectedIds = [];
    var unselectedTotal = 0;
    var pendingLines = [];
    for (var pi = 0; pi < unselectedLines.length; pi++) {
      var ul = unselectedLines[pi];
      unselectedIds.push(ul.orderId);
      var ulExp = gb_lineExpectedDeposit_(ul);
      unselectedTotal += ulExp;
      pendingLines.push({
        orderId: ul.orderId,
        groupId: ul.groupId,
        groupName: ul.groupName,
        lookupCode: ul.lookupCode,
        expectedDeposit: ulExp,
        deposit: ulExp
      });
    }
    nextReports.push({
      id: 'pr_' + Date.now() + '_' + Math.random().toString(16).slice(2, 6),
      customerName: report.customerName,
      remittanceDate: report.remittanceDate,
      lastFive: report.lastFive,
      totalAmount: unselectedTotal,
      reportedTotalAmount: report.reportedTotalAmount != null ? report.reportedTotalAmount : report.totalAmount,
      orderIds: unselectedIds,
      lines: pendingLines,
      status: 'pending',
      submittedAt: report.submittedAt,
      source: 'customer'
    });
  }
  nextReports.push(confirmedReport);
  for (var ri = 0; ri < reports.length; ri++) {
    if (ri !== idx) nextReports.push(reports[ri]);
  }
  gb_performSave_({
    groups: groups,
    dataRevision: all.dataRevision,
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: nextReports,
    skipUnchangedImages: true
  });
  if (confirmOpId) {
    gb_opSet_(confirmOpId, { status: 'pending_journal', kind: 'confirm', journalRow: journalRow, reportId: reportId });
  }
  gb_writeJournalSheet_(gb_upsertJournalRows_(gb_fetchAllData_().bankJournal || [], [journalRow]));
  var confirmResult = { ok: true, message: '已確認付款', operationId: confirmOpId };
  if (confirmOpId) gb_opSet_(confirmOpId, { status: 'done', kind: 'confirm', journalRow: journalRow, result: confirmResult });
  return confirmResult;
}

function gb_updatePaymentReportLineFlags_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  var orderId = pl && pl.orderId ? String(pl.orderId) : '';
  var needsSupplement = !!(pl && pl.needsSupplement);
  if (!reportId || !orderId) return { ok: false, message: '缺少參數' };
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var found = false;
  for (var i = 0; i < reports.length; i++) {
    if (reports[i].id !== reportId) continue;
    found = true;
    var lines = reports[i].lines || [];
    for (var li = 0; li < lines.length; li++) {
      if (lines[li].orderId === orderId) lines[li].needsSupplement = needsSupplement;
    }
    reports[i].lines = lines;
  }
  if (!found) return { ok: false, message: '找不到付款回報' };
  var ss = SpreadsheetApp.getActive();
  gb_writePaymentReports_(ss.getSheetByName(GB_SHEET_SETTINGS), reports);
  return { ok: true, message: '已更新' };
}

function gb_supplementPaymentReport_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  var orderId = pl && pl.orderId ? String(pl.orderId) : '';
  var addAmount = Math.max(0, Math.round(Number(pl && pl.amount) || 0));
  var remittanceDate = pl && pl.remittanceDate ? String(pl.remittanceDate) : '';
  var remittanceBank = pl && pl.remittanceBank ? String(pl.remittanceBank) : '待分類';
  var note = pl && pl.note ? String(pl.note).trim() : '';
  if (!reportId || !orderId) return { ok: false, message: '缺少參數' };
  if (addAmount <= 0) return { ok: false, message: '補款金額需大於 0' };
  if (!remittanceDate) remittanceDate = new Date().toISOString().slice(0, 10);

  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var reportIdx = -1;
  for (var ri = 0; ri < reports.length; ri++) {
    if (reports[ri].id === reportId && reports[ri].status === 'confirmed') reportIdx = ri;
  }
  if (reportIdx < 0) return { ok: false, message: '找不到已確認的付款回報' };
  var report = reports[reportIdx];
  var line = null;
  for (var li = 0; li < (report.lines || []).length; li++) {
    if (report.lines[li].orderId === orderId) line = report.lines[li];
  }
  if (!line) return { ok: false, message: '找不到訂單' };
  var opId = pl && pl.operationId ? String(pl.operationId) : '';
  if (!opId) return { ok: false, message: '缺少操作編號' };
  var supplementClaim = gb_claimOperation_(opId);
  if (supplementClaim && supplementClaim.result) return supplementClaim.result;
  var prevOp = gb_opGet_(opId);
  if (prevOp && prevOp.status === 'done') return prevOp.result;
  var resumeJournal = prevOp && (prevOp.status === 'pending_journal' || prevOp.status === 'applying');
  if (!resumeJournal && !line.needsSupplement) return { ok: false, message: '此筆未標記需補款' };

  var supplementInfo = gb_formatRemittancePaymentInfo_(
    remittanceDate,
    remittanceBank,
    note || ('補款' + addAmount)
  );
  var groups = all.groups || [];
  var targetDeposit = prevOp && prevOp.targetDeposit != null
    ? Number(prevOp.targetDeposit)
    : null;
  for (var gi = 0; gi < groups.length; gi++) {
    var orders = groups[gi].orders || [];
    for (var oi = 0; oi < orders.length; oi++) {
      if (orders[oi].id !== orderId) continue;
      if (targetDeposit == null) targetDeposit = (Number(orders[oi].deposit) || 0) + addAmount;
      var newDeposit = targetDeposit;
      var payInfo = orders[oi].paymentInfo || '';
      orders[oi].paymentStatus = '已付訂金';
      orders[oi].deposit = newDeposit;
      orders[oi].balance = gb_calcOrderBalance_(orders[oi].totalTwd, newDeposit, orders[oi].domesticShip, orders[oi].intlShip);
      if (payInfo.indexOf(supplementInfo) < 0) {
        orders[oi].paymentInfo = payInfo ? payInfo + ' · ' + supplementInfo : supplementInfo;
      }
    }
  }
  var journalRow = {
    id: 'j_sup_' + opId,
    date: remittanceDate,
    bank: remittanceBank || '待分類',
    type: '收入',
    amount: addAmount,
    category: '團購訂金',
    note: report.customerName + ' 補款 ' + line.groupName + ' · ' + (note || '補款')
  };
  var newLineDep = resumeJournal && prevOp && prevOp.targetDeposit != null
    ? Number(prevOp.targetDeposit)
    : line.deposit + addAmount;
  var lineExp = gb_lineExpectedDeposit_(line);
  var updatedLine = {
    orderId: line.orderId,
    groupId: line.groupId,
    groupName: line.groupName,
    lookupCode: line.lookupCode,
    expectedDeposit: line.expectedDeposit != null ? line.expectedDeposit : line.deposit,
    deposit: newLineDep,
    needsSupplement: newLineDep < lineExp,
    supplementTotal: resumeJournal ? (line.supplementTotal || 0) : (line.supplementTotal || 0) + addAmount
  };
  var nextLines = [];
  for (var nl = 0; nl < (report.lines || []).length; nl++) {
    nextLines.push(report.lines[nl].orderId === orderId ? updatedLine : report.lines[nl]);
  }
  reports[reportIdx] = {
    id: report.id,
    customerName: report.customerName,
    remittanceDate: report.remittanceDate,
    lastFive: report.lastFive,
    totalAmount: resumeJournal ? report.totalAmount : report.totalAmount + addAmount,
    reportedTotalAmount: report.reportedTotalAmount != null ? report.reportedTotalAmount : report.totalAmount,
    orderIds: report.orderIds,
    lines: nextLines,
    status: 'confirmed',
    submittedAt: report.submittedAt,
    confirmedAt: report.confirmedAt,
    confirmedBank: report.confirmedBank,
    journalEntryId: report.journalEntryId,
    source: report.source || 'customer'
  };
  gb_opSet_(opId, {
    status: 'applying',
    targetDeposit: targetDeposit,
    addAmount: addAmount,
    orderId: orderId
  });
  gb_performSave_({
    groups: groups,
    dataRevision: all.dataRevision,
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: reports,
    skipUnchangedImages: true
  });
  gb_opSet_(opId, {
    status: 'pending_journal',
    targetDeposit: targetDeposit,
    addAmount: addAmount,
    orderId: orderId
  });
  var journalList = gb_fetchAllData_().bankJournal || [];
  gb_writeJournalSheet_(gb_upsertJournalRows_(journalList, [journalRow]));
  var supplementResult = { ok: true, message: '補款已入帳', operationId: opId, dataRevision: gb_currentRevision_() };
  gb_opSet_(opId, {
    status: 'done',
    targetDeposit: targetDeposit,
    addAmount: addAmount,
    orderId: orderId,
    result: supplementResult
  });
  return supplementResult;
}

function gb_findPaymentReportJournal_(bankJournal, report) {
  if (report.journalEntryId) {
    for (var ji = 0; ji < bankJournal.length; ji++) {
      if (bankJournal[ji].id === report.journalEntryId) return bankJournal[ji];
    }
  }
  var noteNeedle = report.customerName + ' 付款回報';
  for (var j = 0; j < bankJournal.length; j++) {
    var row = bankJournal[j];
    if (
      row.category === '團購訂金' &&
      String(row.note || '').indexOf(noteNeedle) >= 0 &&
      String(row.note || '').indexOf(report.lastFive) >= 0 &&
      Number(row.amount) === Number(report.totalAmount)
    ) {
      return row;
    }
  }
  return null;
}

function gb_applyRevertPaymentReport_(groups, bankJournal, report) {
  var nextJournal = bankJournal || [];
  var target = {};
  for (var ti = 0; ti < report.orderIds.length; ti++) target[report.orderIds[ti]] = true;
  var expectedByOrder = {};
  for (var li = 0; li < (report.lines || []).length; li++) {
    var line = report.lines[li];
    var exp = line.expectedDeposit != null ? line.expectedDeposit : line.deposit;
    expectedByOrder[line.orderId] = Math.max(0, Math.round(Number(exp) || 0));
  }
  for (var gi = 0; gi < groups.length; gi++) {
    var orders = groups[gi].orders || [];
    for (var oi = 0; oi < orders.length; oi++) {
      if (!target[orders[oi].id]) continue;
      var dep = expectedByOrder[orders[oi].id] != null ? expectedByOrder[orders[oi].id] : Number(orders[oi].deposit) || 0;
      orders[oi].paymentStatus = '未付款';
      orders[oi].deposit = dep;
      orders[oi].balance = gb_calcOrderBalance_(orders[oi].totalTwd, dep, orders[oi].domesticShip, orders[oi].intlShip);
      orders[oi].paymentInfo = '';
    }
  }
  var nextLines = [];
  for (var nl = 0; nl < (report.lines || []).length; nl++) {
    var ln = report.lines[nl];
    var expDep = ln.expectedDeposit != null ? ln.expectedDeposit : ln.deposit;
    nextLines.push({
      orderId: ln.orderId,
      groupId: ln.groupId,
      groupName: ln.groupName,
      lookupCode: ln.lookupCode,
      expectedDeposit: expDep,
      deposit: Math.max(0, Math.round(Number(expDep) || 0))
    });
  }
  var nextReport = {
    id: report.id,
    customerName: report.customerName,
    remittanceDate: report.remittanceDate,
    lastFive: report.lastFive,
    totalAmount: report.reportedTotalAmount != null ? report.reportedTotalAmount : report.totalAmount,
    reportedTotalAmount: report.reportedTotalAmount != null ? report.reportedTotalAmount : report.totalAmount,
    orderIds: report.orderIds,
    lines: nextLines,
    status: 'pending',
    submittedAt: report.submittedAt,
    journalEntryId: report.journalEntryId
  };
  return { groups: groups, bankJournal: nextJournal, report: nextReport };
}

function gb_revertPaymentReport_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  if (!reportId) return { ok: false, message: '缺少回報 ID' };
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var idx = -1;
  for (var i = 0; i < reports.length; i++) {
    if (reports[i].id === reportId && reports[i].status === 'confirmed') idx = i;
  }
  if (idx < 0) return { ok: false, message: '找不到已確認的付款回報' };
  var applied = gb_applyRevertPaymentReport_(all.groups || [], all.bankJournal || [], reports[idx]);
  reports[idx] = applied.report;
  gb_performSave_({
    groups: applied.groups,
    bankJournal: applied.bankJournal,
    dataRevision: all.dataRevision,
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: reports,
    skipUnchangedImages: true
  });
  var revertOp = pl && pl.operationId ? String(pl.operationId) : ('revert_' + reportId);
  gb_opSet_(revertOp, {
    status: 'done',
    kind: 'revert',
    reportId: reportId,
    journalKept: true,
    journalEntryId: reports[idx].journalEntryId || '',
    orderStatus: '未付款',
    result: { ok: true, message: '已返回待確認', operationId: revertOp }
  });
  return { ok: true, message: '已返回待確認', operationId: revertOp };
}

function gb_deletePaymentReport_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  if (!reportId) return { ok: false, message: '缺少回報 ID' };
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var report = null;
  for (var i = 0; i < reports.length; i++) {
    if (reports[i].id === reportId) report = reports[i];
  }
  if (!report) return { ok: false, message: '找不到付款回報' };
  var groups = all.groups || [];
  var bankJournal = all.bankJournal || [];
  if (report.status === 'confirmed') {
    var reverted = gb_applyRevertPaymentReport_(groups, bankJournal, report);
    groups = reverted.groups;
    bankJournal = reverted.bankJournal;
  }
  var nextReports = [];
  for (var ri = 0; ri < reports.length; ri++) {
    if (reports[ri].id !== reportId) nextReports.push(reports[ri]);
  }
  gb_performSave_({
    groups: groups,
    bankJournal: bankJournal,
    dataRevision: all.dataRevision,
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: nextReports,
    skipUnchangedImages: true
  });
  return { ok: true, message: '已刪除付款回報' };
}

// Ported business rules: HeinaSafety.gs
function gb_assertWritableSpreadsheet_() {
  var guard = PropertiesService.getScriptProperties().getProperty('HEINA_ONLY_SPREADSHEET_ID');
  if (!guard) return;
  var id = SpreadsheetApp.getActive().getId();
  if (id !== guard) throw new Error('拒絕寫入：目前試算表不是允許的測試表');
}

function gb_withDocumentLock_(fn) {
  gb_assertWritableSpreadsheet_();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(25000)) throw new Error('另一筆寫入進行中，請稍候再試');
  try {
    GB_SETTINGS_CACHE_ = null;
    return fn();
  } finally {
    GB_SETTINGS_CACHE_ = null;
    lock.releaseLock();
  }
}

function gb_requireRevision_(payload, currentRev) {
  if (!payload || payload.dataRevision == null || String(payload.dataRevision) === '') {
    throw new Error('缺少資料版本，請重新載入後再儲存');
  }
  if (String(payload.dataRevision) !== String(currentRev)) {
    throw new Error('資料已在另一個畫面更新，請重新整理後再儲存，避免蓋過剛改的內容。');
  }
}

function gb_currentRevision_() {
  GB_SETTINGS_CACHE_ = null;
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var cache = gb_loadSettingsMap_(sheet);
  return String(cache.map.gb_dataRevision || '0');
}


function gb_opGet_(id) {
  if (!id) return null;
  GB_SETTINGS_CACHE_ = null;
  var cache = gb_loadSettingsMap_();
  var raw = cache.map['gb_op_' + id];
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch (e) { return null; }
}

function gb_opSet_(id, obj) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  gb_upsertSetting_(sheet, 'gb_op_' + id, JSON.stringify(obj));
}

function gb_writeOrderSheetSafe_(sheet, rows) {
  var last = sheet.getLastRow();
  var oldCount = Math.max(0, last - 1);
  if (rows && rows.length) {
    gb_ensureShipDateTextFormat_(sheet, 2, rows.length);
    sheet.getRange(2, 1, rows.length, GB_COLS).setValues(rows);
  }
  if (oldCount > (rows ? rows.length : 0)) {
    sheet.getRange(2 + (rows ? rows.length : 0), 1, oldCount - (rows ? rows.length : 0), GB_COLS).clearContent();
  }
}

function gb_replaceGroupRows_(sheet, groupId, newRows, opId) {
  var last = sheet.getLastRow();
  var existing = last > 1 ? sheet.getRange(2, 1, last - 1, GB_COLS).getValues() : [];
  var start = -1;
  var end = -1;
  var i;
  for (i = 0; i < existing.length; i++) {
    if (String(existing[i][GB_COL.GROUP_ID]) === String(groupId)) {
      if (start < 0) start = i;
      end = i;
    }
  }
  var backup = start < 0 ? [] : existing.slice(start, end + 1);
  gb_opSet_(opId + ':' + groupId, { status: 'backup', rowCount: backup.length });
  if (start < 0) {
    if (!newRows.length) return;
    gb_ensureShipDateTextFormat_(sheet, existing.length + 2, newRows.length);
    sheet.getRange(existing.length + 2, 1, newRows.length, GB_COLS).setValues(newRows);
    return;
  }
  var oldLen = end - start + 1;
  var sheetStart = start + 2;
  if (newRows.length === oldLen) {
    gb_ensureShipDateTextFormat_(sheet, sheetStart, newRows.length);
    sheet.getRange(sheetStart, 1, newRows.length, GB_COLS).setValues(newRows);
    return;
  }
  sheet.deleteRows(sheetStart, oldLen);
  if (newRows.length) {
    sheet.insertRows(sheetStart, newRows.length);
    gb_ensureShipDateTextFormat_(sheet, sheetStart, newRows.length);
    sheet.getRange(sheetStart, 1, newRows.length, GB_COLS).setValues(newRows);
  }
}

function gb_takeOrder_(groups, orderId) {
  var gi, oi, orders;
  for (gi = 0; gi < groups.length; gi++) {
    orders = groups[gi].orders || [];
    for (oi = 0; oi < orders.length; oi++) {
      if (orders[oi].id === orderId) {
        var order = orders.splice(oi, 1)[0];
        groups[gi].orders = orders;
        return { groupId: groups[gi].id, order: order };
      }
    }
  }
  return null;
}

function gb_ensureGroup_(groups, groupId, seed) {
  var i;
  for (i = 0; i < groups.length; i++) if (groups[i].id === groupId) return groups[i];
  var g = seed || {
    id: groupId, name: groupId, status: '已登記', closingDate: '', saleEndDate: '',
    officialShipDate: '', jpyAmount: '', orderId: '', logisticsId: '', purchaseLink: '', orders: []
  };
  g.id = groupId;
  g.orders = g.orders || [];
  groups.push(g);
  return g;
}

function gb_rowsForOneOrder_(group, orderId) {
  var clone = {};
  var k;
  for (k in group) clone[k] = group[k];
  var orders = [];
  var i;
  for (i = 0; i < (group.orders || []).length; i++) {
    if (group.orders[i].id === orderId) orders.push(group.orders[i]);
  }
  clone.orders = orders;
  return gb_buildFlatRows_([clone], { skipSettings: true });
}

function gb_replaceOrderRows_(sheet, orderId, newRows, opId) {
  var last = sheet.getLastRow();
  var existing = last > 1 ? sheet.getRange(2, 1, last - 1, GB_COLS).getValues() : [];
  var indexes = [];
  var i;
  for (i = 0; i < existing.length; i++) {
    if (String(existing[i][GB_COL.ORDER_ID]) === String(orderId)) indexes.push(i);
  }
  var backup = [];
  for (i = 0; i < indexes.length; i++) backup.push(existing[indexes[i]]);
  gb_opSet_(opId + ':order:' + orderId, { status: 'backup', rowCount: backup.length });
  if (!indexes.length) {
    if (!newRows.length) return { rows: 0 };
    gb_ensureShipDateTextFormat_(sheet, existing.length + 2, newRows.length);
    sheet.getRange(existing.length + 2, 1, newRows.length, GB_COLS).setValues(newRows);
    return { rows: newRows.length };
  }
  var contiguous = indexes[indexes.length - 1] - indexes[0] + 1 === indexes.length;
  if (!contiguous) throw new Error('訂單列不連續，已停止寫入以免影響其他訂單');
  var sheetStart = indexes[0] + 2;
  if (newRows.length === indexes.length) {
    gb_ensureShipDateTextFormat_(sheet, sheetStart, newRows.length);
    sheet.getRange(sheetStart, 1, newRows.length, GB_COLS).setValues(newRows);
    return { rows: newRows.length };
  }
  sheet.deleteRows(sheetStart, indexes.length);
  if (newRows.length) {
    sheet.insertRows(sheetStart, newRows.length);
    gb_ensureShipDateTextFormat_(sheet, sheetStart, newRows.length);
    sheet.getRange(sheetStart, 1, newRows.length, GB_COLS).setValues(newRows);
  }
  return { rows: newRows.length };
}

function gb_patchSharedGroupColumns_(sheet, group) {
  var last = sheet.getLastRow();
  if (last < 2) return { rows: 0, columns: 0 };
  var existing = sheet.getRange(2, 1, last - 1, GB_COLS).getValues();
  var sample = gb_buildFlatRows_([group], { skipSettings: true });
  var sampleRow = null;
  var i;
  for (i = 0; i < sample.length; i++) {
    if (String(sample[i][GB_COL.GROUP_ID]) === String(group.id)) { sampleRow = sample[i]; break; }
  }
  if (!sampleRow) return { rows: 0, columns: 0 };
  var values = [];
  for (i = GB_COL.SHIP_DATE; i <= GB_COL.GROUP_LINK; i++) values.push(sampleRow[i]);
  var n = 0;
  for (i = 0; i < existing.length; i++) {
    if (String(existing[i][GB_COL.GROUP_ID]) !== String(group.id)) continue;
    var same = true;
    var c;
    for (c = 0; c < values.length; c++) {
      if (String(existing[i][GB_COL.SHIP_DATE + c] == null ? '' : existing[i][GB_COL.SHIP_DATE + c]) !== String(values[c] == null ? '' : values[c])) same = false;
    }
    if (same) continue;
    gb_ensureShipDateTextFormat_(sheet, i + 2, 1);
    sheet.getRange(i + 2, GB_COL.SHIP_DATE + 1, 1, values.length).setValues([values]);
    n++;
  }
  return { rows: n, columns: values.length };
}

function gb_appendChangeLog_(rev, orderIds, groupIds) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  GB_SETTINGS_CACHE_ = null;
  var raw = gb_loadSettingsMap_(sheet).map.gb_changeLog || '[]';
  var list = [];
  try { list = JSON.parse(String(raw)); } catch (e2) { list = []; }
  if (!Array.isArray(list)) list = [];
  list.push({ rev: String(rev), orderIds: orderIds, groupIds: groupIds, at: new Date().getTime() });
  if (list.length > 40) list = list.slice(list.length - 40);
  gb_upsertSetting_(sheet, 'gb_changeLog', JSON.stringify(list));
}

function gb_findGroup_(groups, groupId) {
  var i;
  for (i = 0; i < groups.length; i++) if (groups[i].id === groupId) return groups[i];
  return null;
}

function gb_applyMutationsLocked_(payload, currentRev) {
  var all = gb_fetchAllData_();
  var groups = all.groups || [];
  var affected = {};
  var orderOps = {};
  var patchedGroups = {};
  var mutations = payload.mutations || [];
  payload.orderRevisions = payload.orderRevisions || {};
  payload.groupRevisions = payload.groupRevisions || {};
  var mi, m, found, g, order, oi, k;
  for (mi = 0; mi < mutations.length; mi++) {
    m = mutations[mi];
    if (m.op === 'deleteOrder') {
      found = gb_takeOrder_(groups, m.orderId);
      if (found) {
        affected[found.groupId] = true;
        orderOps[m.orderId] = { mode: 'delete', groupId: found.groupId };
      }
    } else if (m.op === 'upsertOrder') {
      found = gb_takeOrder_(groups, m.order.id);
      if (found && found.groupId !== m.groupId) affected[found.groupId] = true;
      g = gb_ensureGroup_(groups, m.groupId, m.group || null);
      order = m.order;
      if (order.items && order.items.length) order.totalTwd = gb_calcItemsTotalTwd_(order.items);
      order.balance = gb_calcOrderBalance_(order.totalTwd, order.deposit, order.domesticShip, order.intlShip);
      var replaced = false;
      for (oi = 0; oi < g.orders.length; oi++) {
        if (g.orders[oi].id === order.id) { g.orders[oi] = order; replaced = true; }
      }
      if (!replaced) g.orders.push(order);
      affected[m.groupId] = true;
      orderOps[order.id] = { mode: 'upsert', groupId: m.groupId };
    } else if (m.op === 'patchGroup') {
      g = gb_ensureGroup_(groups, m.groupId, null);
      var fields = m.fields || {};
      var patchable = {
        officialShipDate: true, name: true, status: true, closingDate: true, saleEndDate: true,
        purchaseDate: true, jpyAmount: true, orderId: true, logisticsId: true, purchaseLink: true
      };
      for (k in fields) {
        if (k === 'orders' || k === 'id' || k === 'groupRevision') continue;
        if (!patchable[k]) throw new Error('不支援用局部更新修改這個團務欄位：' + k);
        g[k] = fields[k];
      }
      affected[m.groupId] = true;
      patchedGroups[m.groupId] = true;
    }
  }
  var revSettings = gb_loadSettingsMap_().map;
  for (oid in orderOps) {
    if (payload.orderRevisions[oid] == null || String(payload.orderRevisions[oid]) === '') {
      throw new Error('缺少這筆訂單的版本，請重新載入後再儲存。');
    }
    if (String(payload.orderRevisions[oid]) !== gb_orderRev_(revSettings, oid)) {
      throw new Error('這筆訂單已在另一個畫面更新，請重新整理後再儲存。');
    }
  }
  for (gid in patchedGroups) {
    if (payload.groupRevisions[gid] == null || String(payload.groupRevisions[gid]) === '') {
      throw new Error('缺少這個團的共同欄位版本，請重新載入後再儲存。');
    }
    if (String(payload.groupRevisions[gid]) !== gb_groupRev_(revSettings, gid)) {
      throw new Error('這個團的共同欄位已在另一個畫面更新，請重新整理後再儲存。');
    }
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_ORDERS);
  var opId = payload.operationId || ('mut_' + new Date().getTime());
  var writes = [];
  var oid;
  for (oid in orderOps) {
    if (orderOps[oid].mode === 'delete') {
      var removed = gb_replaceOrderRows_(sheet, oid, [], opId);
      writes.push({ orderId: oid, rows: removed.rows, mode: 'delete' });
    } else {
      g = gb_findGroup_(groups, orderOps[oid].groupId);
      var built = g ? gb_rowsForOneOrder_(g, oid) : [];
      var one = gb_replaceOrderRows_(sheet, oid, built, opId);
      writes.push({ orderId: oid, rows: one.rows, mode: 'order', columns: GB_COLS });
    }
  }
  var gid;
  for (gid in patchedGroups) {
    g = gb_findGroup_(groups, gid);
    if (!g) continue;
    var patched = gb_patchSharedGroupColumns_(sheet, g);
    writes.push({ groupId: gid, rows: patched.rows, columns: patched.columns, mode: 'groupFields' });
  }
  var rollups = [];
  for (gid in affected) {
    var check = gb_rawGroupCheck_(gid);
    if (!check.ok) throw new Error('整團彙整與明細不一致：' + gid);
    rollups.push(check);
  }
  var settingsSheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var revNum = parseInt(currentRev, 10);
  if (isNaN(revNum)) revNum = 0;
  var nextRev = String(revNum + 1);
  var orderIdList = [];
  var groupIdList = [];
  for (oid in orderOps) orderIdList.push(oid);
  for (gid in affected) groupIdList.push(gid);
  if (payload.paymentReports) gb_writePaymentReports_(settingsSheet, payload.paymentReports);
  if (payload.consolidationShipments) gb_writeConsolidationShipments_(settingsSheet, payload.consolidationShipments);
  gb_upsertSetting_(settingsSheet, 'gb_dataRevision', nextRev);
  var orderRevisionsOut = {};
  var groupRevisionsOut = {};
  for (oid in orderOps) orderRevisionsOut[oid] = gb_bumpRevMap_(settingsSheet, 'gb_orderRevMap', oid);
  for (gid in patchedGroups) groupRevisionsOut[gid] = gb_bumpRevMap_(settingsSheet, 'gb_groupRevMap', gid);
  gb_appendChangeLog_(nextRev, orderIdList, groupIdList);
  return {
    status: 'success', dataRevision: nextRev, rollups: rollups, writes: writes, sync: 'complete', operationId: opId,
    orderRevisions: orderRevisionsOut, groupRevisions: groupRevisionsOut
  };
}

function gb_rawGroupCheck_(groupId) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_ORDERS);
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, GB_COLS).getValues() : [];
  var byOrder = {};
  var orderIds = [];
  var total = 0;
  var i;
  for (i = 0; i < rows.length; i++) {
    if (String(rows[i][GB_COL.GROUP_ID]) !== String(groupId)) continue;
    var oid = String(rows[i][GB_COL.ORDER_ID] || '');
    if (!oid) continue;
    var sig = [GB_COL.TOTAL_TWD, GB_COL.DEPOSIT, GB_COL.DOMESTIC, GB_COL.INTL, GB_COL.BALANCE, GB_COL.PAY_STATUS, GB_COL.PAYMENT_INFO].map(function (c) {
      return String(rows[i][c] == null ? '' : rows[i][c]);
    }).join('|');
    if (!byOrder[oid]) {
      byOrder[oid] = sig;
      orderIds.push(oid);
      total += Number(rows[i][GB_COL.TOTAL_TWD]) || 0;
    } else if (byOrder[oid] !== sig) {
      return { ok: false, groupId: groupId, orderId: oid };
    }
  }
  return { ok: true, groupId: groupId, orderCount: orderIds.length, totalTwd: total };
}

// Ported business rules: Ledger.gs
/**
 * Ledger — 行程 / 記帳明細 / 預設品項 / 設定（裝置維度）
 * 使用容器試算表 SpreadsheetApp.getActiveSpreadsheet()
 */

var LD_SHEET_TRIPS = '行程';
var LD_SHEET_TX = '記帳明細';
var LD_SHEET_ITEMS = '預設品項';
var LD_SHEET_SETTINGS = '記帳設定';
var LD_PROP_CURRENT_TRIPS = 'HEINA_LEDGER_CURRENT_TRIPS_JSON';
/** 獨立 Apps Script 專案（未綁定試算表）時，於指令碼屬性設定試算表 ID */
var LD_PROP_SPREADSHEET_ID = 'HEINA_SPREADSHEET_ID';

var ld_ssCache_ = null;

/**
 * 取得記帳用的容器試算表。
 * 1) 已綁定：getActiveSpreadsheet()
 * 2) 編輯器執行但無 active：ScriptProperties HEINA_SPREADSHEET_ID → openById
 */
function ld_ss_() {
  if (ld_ssCache_) return ld_ssCache_;
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty(LD_PROP_SPREADSHEET_ID);
    if (id) {
      try {
        ss = SpreadsheetApp.openById(String(id).trim());
      } catch (e2) {
        throw new Error(
          '無法開啟試算表（ID=' +
            id +
            '）：' +
            (e2 && e2.message ? e2.message : e2) +
            '。請確認 ID 正確且腳本有試算表存取權。'
        );
      }
    }
  }
  if (!ss) {
    throw new Error(
      '找不到試算表：請將 Apps Script「綁定」到目標 Google 試算表（擴充功能 → Apps Script），' +
        '或在指令碼屬性設定 ' +
        LD_PROP_SPREADSHEET_ID +
        ' 後設定 Apps Script 指令碼屬性。'
    );
  }
  ld_cacheSpreadsheetId_(ss);
  ld_ssCache_ = ss;
  return ss;
}

/** 記住試算表 ID，方便僅在編輯器執行 smoke test 時仍能 openById */
function ld_cacheSpreadsheetId_(ss) {
  try {
    var id = ss && ss.getId ? ss.getId() : '';
    if (id) {
      PropertiesService.getScriptProperties().setProperty(LD_PROP_SPREADSHEET_ID, String(id));
    }
  } catch (e) {
    /* ignore */
  }
}

/**
 * 手動綁定試算表 ID（供獨立 GAS 專案或編輯器 smoke test 使用）。
 * @param {string} spreadsheetId
 */

function ld_flush_() {
  try {
    SpreadsheetApp.flush();
  } catch (e) {
    /* ignore */
  }
}

function ld_uuid_() {
  return Utilities.getUuid();
}

function ld_getCurrentTripMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty(LD_PROP_CURRENT_TRIPS);
  if (!raw) return {};
  try {
    var o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch (e) {
    return {};
  }
}

function ld_saveCurrentTripMap_(map) {
  PropertiesService.getScriptProperties().setProperty(LD_PROP_CURRENT_TRIPS, JSON.stringify(map || {}));
}

function ld_setCurrentTrip_(clientId, tripId) {
  var m = ld_getCurrentTripMap_();
  m[String(clientId)] = String(tripId);
  ld_saveCurrentTripMap_(m);
  return { ok: true };
}

function ld_ensureSheets_() {
  var ss = ld_ss_();
  ld_renameIfNeeded_(ss, 'Trips', LD_SHEET_TRIPS);
  ld_renameIfNeeded_(ss, 'Transactions', LD_SHEET_TX);
  ld_renameIfNeeded_(ss, 'Items', LD_SHEET_ITEMS);
  ld_renameIfNeeded_(ss, 'Settings', LD_SHEET_SETTINGS);
  ld_renameIfNeeded_(ss, '設定', LD_SHEET_SETTINGS);

  var trips = ss.getSheetByName(LD_SHEET_TRIPS);
  if (!trips) trips = ss.insertSheet(LD_SHEET_TRIPS);
  ld_ensureHeader_(trips, ['行程ID', '行程名稱', '建立時間', '裝置ID']);

  var tx = ss.getSheetByName(LD_SHEET_TX);
  if (!tx) tx = ss.insertSheet(LD_SHEET_TX);
  ld_ensureHeader_(tx, ['記錄ID', '行程ID', '金額', '品項備註', '類型', '分類', '日期', '建立時間', '裝置ID', '付款方式', '幣別']);

  var items = ss.getSheetByName(LD_SHEET_ITEMS);
  if (!items) items = ss.insertSheet(LD_SHEET_ITEMS);
  ld_ensureHeader_(items, ['品項ID', '品項名稱', '建立時間', '裝置ID']);

  var setSh = ss.getSheetByName(LD_SHEET_SETTINGS);
  if (!setSh) setSh = ss.insertSheet(LD_SHEET_SETTINGS);
  ld_ensureHeader_(setSh, ['裝置ID', '設定鍵', '設定值', '更新時間']);
}

function ld_renameIfNeeded_(ss, oldName, newName) {
  var oldSh = ss.getSheetByName(oldName);
  var newSh = ss.getSheetByName(newName);
  if (oldSh && !newSh) oldSh.setName(newName);
}

function ld_ensureHeader_(sheet, headerZh) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headerZh);
    return;
  }
  var lastCol = Math.max(sheet.getLastColumn(), headerZh.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  for (var i = 0; i < headerZh.length; i++) {
    var col = headerZh[i];
    if (header.indexOf(col) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
    }
  }
}

function ld_headerToIndex_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var key = String(headerRow[i] || '').trim();
    if (key) map[key] = i;
  }
  return map;
}

function ld_pickIndex_(map, keys, fallback) {
  for (var i = 0; i < keys.length; i++) {
    if (map[keys[i]] !== undefined) return map[keys[i]];
  }
  return fallback;
}

function ld_indexMapTrips_(headerRow) {
  var map = ld_headerToIndex_(headerRow);
  return {
    id: ld_pickIndex_(map, ['行程ID', 'id'], 0),
    name: ld_pickIndex_(map, ['行程名稱', 'name'], 1),
    createdAt: ld_pickIndex_(map, ['建立時間', 'createdAt'], 2),
    clientId: ld_pickIndex_(map, ['裝置ID', 'clientId'], 3)
  };
}

function ld_indexMapTx_(headerRow) {
  var map = ld_headerToIndex_(headerRow);
  return {
    id: ld_pickIndex_(map, ['記錄ID', 'id'], 0),
    tripId: ld_pickIndex_(map, ['行程ID', 'tripId'], 1),
    amount: ld_pickIndex_(map, ['金額', 'amount'], 2),
    note: ld_pickIndex_(map, ['品項備註', 'note'], 3),
    type: ld_pickIndex_(map, ['類型', 'type'], 4),
    category: ld_pickIndex_(map, ['分類', 'category'], 5),
    date: ld_pickIndex_(map, ['日期', 'date'], 6),
    timestamp: ld_pickIndex_(map, ['建立時間', 'timestamp'], 7),
    clientId: ld_pickIndex_(map, ['裝置ID', 'clientId'], 8),
    payMethod: ld_pickIndex_(map, ['付款方式', 'payMethod'], 9),
    currency: ld_pickIndex_(map, ['幣別', 'currency'], 10)
  };
}

function ld_indexMapItems_(headerRow) {
  var map = ld_headerToIndex_(headerRow);
  return {
    id: ld_pickIndex_(map, ['品項ID', 'id'], 0),
    name: ld_pickIndex_(map, ['品項名稱', 'name'], 1),
    createdAt: ld_pickIndex_(map, ['建立時間', 'createdAt'], 2),
    clientId: ld_pickIndex_(map, ['裝置ID', 'clientId'], 3)
  };
}

function ld_indexMapSettings_(headerRow) {
  var map = ld_headerToIndex_(headerRow);
  return {
    clientId: ld_pickIndex_(map, ['裝置ID', 'clientId'], 0),
    key: ld_pickIndex_(map, ['設定鍵', 'key'], 1),
    value: ld_pickIndex_(map, ['設定值', 'value'], 2),
    updatedAt: ld_pickIndex_(map, ['更新時間', 'updatedAt'], 3)
  };
}

function ld_defaultSettings_() {
  return {
    defaultCurrency: 'JPY',
    defaultPayMethod: '現金',
    defaultPersonalCategory: '購物',
    confirmBeforeDelete: '開',
    autoClearAfterSave: '開'
  };
}

function ld_listTrips_(clientId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_TRIPS);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  var header = values[0];
  var idx = ld_indexMapTrips_(header);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[idx.clientId] || '') !== String(clientId)) continue;
    out.push({
      id: String(row[idx.id]),
      name: String(row[idx.name] || ''),
      createdAt: Number(row[idx.createdAt] || 0),
      clientId: String(row[idx.clientId] || '')
    });
  }
  return out.filter(function (x) { return x.id; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
}

function ld_listTransactions_(clientId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_TX);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  var idx = ld_indexMapTx_(values[0]);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[idx.clientId] || '') !== String(clientId)) continue;
    out.push({
      id: String(row[idx.id]),
      tripId: String(row[idx.tripId] || ''),
      amount: Number(row[idx.amount] || 0),
      note: String(row[idx.note] || ''),
      type: String(row[idx.type] || 'business'),
      category: String(row[idx.category] || ''),
      date: String(row[idx.date] || ''),
      timestamp: Number(row[idx.timestamp] || 0),
      clientId: String(row[idx.clientId] || ''),
      payMethod: String(row[idx.payMethod] || ''),
      currency: String(row[idx.currency] || '')
    });
  }
  return out.filter(function (x) { return x.id; }).sort(function (a, b) { return b.timestamp - a.timestamp; });
}

function ld_listItems_(clientId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_ITEMS);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  var idx = ld_indexMapItems_(values[0]);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[idx.clientId] || '') !== String(clientId)) continue;
    out.push({
      id: String(row[idx.id]),
      name: String(row[idx.name] || ''),
      createdAt: Number(row[idx.createdAt] || 0),
      clientId: String(row[idx.clientId] || '')
    });
  }
  return out.filter(function (x) { return x.id; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
}

function ld_getSettings_(clientId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_SETTINGS);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return ld_defaultSettings_();
  var idx = ld_indexMapSettings_(values[0]);
  var map = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[idx.clientId] || '') !== String(clientId)) continue;
    var k = String(row[idx.key] || '');
    if (k) map[k] = String(row[idx.value] || '');
  }
  var def = ld_defaultSettings_();
  for (var key in map) {
    if (Object.prototype.hasOwnProperty.call(map, key)) def[key] = map[key];
  }
  return def;
}

function ld_getInitData_(clientId) {
  if (!clientId) throw new Error('缺少裝置ID（clientId）');
  ld_ensureSheets_();
  var trips = ld_listTrips_(clientId);
  var tripMap = ld_getCurrentTripMap_();
  var currentTripId = tripMap[String(clientId)] || null;
  if (currentTripId && !trips.some(function (t) { return t.id === currentTripId; })) currentTripId = null;
  if (!currentTripId && trips.length) currentTripId = trips[0].id;
  if (!currentTripId && services.writesEnabled !== false) {
    ld_createTrip_(clientId, '甜蜜代購行');
    trips = ld_listTrips_(clientId);
    currentTripId = trips[0] ? trips[0].id : null;
  }
  return {
    appName: '記帳系統（Sheets版）',
    trips: trips,
    currentTripId: currentTripId,
    transactions: ld_listTransactions_(clientId),
    items: ld_listItems_(clientId),
    settings: ld_getSettings_(clientId)
  };
}

function ld_createTrip_(clientId, name) {
  ld_ensureSheets_();
  if (!clientId) throw new Error('缺少裝置ID（clientId）');
  if (!name || !String(name).trim()) throw new Error('行程名稱必填');
  var sh = ld_ss_().getSheetByName(LD_SHEET_TRIPS);
  var id = ld_uuid_();
  var createdAt = Date.now();
  sh.appendRow([id, String(name).trim(), createdAt, String(clientId)]);
  ld_flush_();
  var m = ld_getCurrentTripMap_();
  m[String(clientId)] = id;
  ld_saveCurrentTripMap_(m);
  return { id: id, name: String(name).trim(), createdAt: createdAt, clientId: String(clientId) };
}

function ld_addTransaction_(clientId, payload) {
  ld_ensureSheets_();
  if (!clientId) throw new Error('缺少裝置ID（clientId）');
  if (!payload) throw new Error('缺少 payload');
  ['tripId', 'amount', 'type', 'date'].forEach(function (k) {
    if (payload[k] === undefined || payload[k] === null || payload[k] === '') {
      throw new Error('缺少欄位：' + k);
    }
  });
  var sh = ld_ss_().getSheetByName(LD_SHEET_TX);
  var id = ld_uuid_();
  var timestamp = Date.now();
  var amount = Number(payload.amount);
  if (!isFinite(amount)) throw new Error('金額必須是數字');
  var type = String(payload.type) === 'personal' ? 'personal' : 'business';
  var category = type === 'business' ? '代購成本' : String(payload.category || '其他');
  var note = String(payload.note || (type === 'business' ? '代購商品' : category));
  var date = String(payload.date || '');
  var payMethod = String(payload.payMethod || '');
  var currency = String(payload.currency || '');
  sh.appendRow([
    id, String(payload.tripId), amount, note, type, category, date, timestamp,
    String(clientId), payMethod, currency
  ]);
  ld_flush_();
  return {
    id: id, tripId: String(payload.tripId), amount: amount, note: note, type: type, category: category,
    date: date, timestamp: timestamp, clientId: String(clientId), payMethod: payMethod, currency: currency
  };
}

function ld_deleteTransaction_(clientId, txId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_TX);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true };
  var idx = ld_indexMapTx_(values[0]);
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[idx.id] || '') === String(txId) && String(r[idx.clientId] || '') === String(clientId)) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function ld_createItemsBatch_(clientId, rawText) {
  ld_ensureSheets_();
  if (!clientId) throw new Error('缺少裝置ID（clientId）');
  if (!rawText || !String(rawText).trim()) return [];
  var parts = String(rawText).split(/[,\n\/|，、;；]+/g).map(function (s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
  var existed = ld_listItems_(clientId);
  var existedSet = {};
  for (var e = 0; e < existed.length; e++) {
    existedSet[String(existed[e].name || '').trim().toLowerCase()] = true;
  }
  var sh = ld_ss_().getSheetByName(LD_SHEET_ITEMS);
  var createdAt = Date.now();
  var added = [];
  for (var p = 0; p < parts.length; p++) {
    var name = parts[p];
    var key = name.toLowerCase();
    if (existedSet[key]) continue;
    existedSet[key] = true;
    var id = ld_uuid_();
    sh.appendRow([id, name, createdAt, String(clientId)]);
    added.push({ id: id, name: name, createdAt: createdAt, clientId: String(clientId) });
  }
  return added;
}

function ld_deleteItem_(clientId, itemId) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_ITEMS);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true };
  var idx = ld_indexMapItems_(values[0]);
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[idx.id] || '') === String(itemId) && String(r[idx.clientId] || '') === String(clientId)) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function ld_deleteTrip_(clientId, tripId) {
  ld_ensureSheets_();
  var txSh = ld_ss_().getSheetByName(LD_SHEET_TX);
  var txValues = txSh.getDataRange().getValues();
  if (txValues.length > 1) {
    var idx = ld_indexMapTx_(txValues[0]);
    for (var i = txValues.length - 1; i >= 1; i--) {
      var r = txValues[i];
      if (String(r[idx.clientId] || '') === String(clientId) && String(r[idx.tripId] || '') === String(tripId)) {
        txSh.deleteRow(i + 1);
      }
    }
  }
  var tripSh = ld_ss_().getSheetByName(LD_SHEET_TRIPS);
  var tripValues = tripSh.getDataRange().getValues();
  if (tripValues.length > 1) {
    var idxT = ld_indexMapTrips_(tripValues[0]);
    for (var j = tripValues.length - 1; j >= 1; j--) {
      var r2 = tripValues[j];
      if (String(r2[idxT.clientId] || '') === String(clientId) && String(r2[idxT.id] || '') === String(tripId)) {
        tripSh.deleteRow(j + 1);
        break;
      }
    }
  }
  return { ok: true };
}

function ld_duplicateTrip_(clientId, sourceTripId, newTripName) {
  ld_ensureSheets_();
  var trips = ld_listTrips_(clientId);
  var src = null;
  for (var t = 0; t < trips.length; t++) {
    if (trips[t].id === String(sourceTripId)) { src = trips[t]; break; }
  }
  var baseName = (newTripName && String(newTripName).trim())
    ? String(newTripName).trim()
    : ((src ? src.name : '行程') + '（複寫）');
  var newTrip = ld_createTrip_(clientId, baseName);
  var txs = ld_listTransactions_(clientId).filter(function (x) { return String(x.tripId) === String(sourceTripId); });
  var txSh = ld_ss_().getSheetByName(LD_SHEET_TX);
  for (var i = 0; i < txs.length; i++) {
    var t2 = txs[i];
    var id = ld_uuid_();
    var ts = Date.now();
    txSh.appendRow([
      id, newTrip.id, Number(t2.amount || 0), String(t2.note || ''),
      String(t2.type || 'business'), String(t2.category || ''), String(t2.date || ''),
      ts, String(clientId), String(t2.payMethod || ''), String(t2.currency || '')
    ]);
  }
  return { ok: true, newTripId: newTrip.id };
}

function ld_overwriteTrip_(clientId, sourceTripId, targetTripId) {
  ld_ensureSheets_();
  var txSh = ld_ss_().getSheetByName(LD_SHEET_TX);
  var txValues = txSh.getDataRange().getValues();
  if (txValues.length > 1) {
    var idx = ld_indexMapTx_(txValues[0]);
    for (var i = txValues.length - 1; i >= 1; i--) {
      var r = txValues[i];
      if (String(r[idx.clientId] || '') === String(clientId) && String(r[idx.tripId] || '') === String(targetTripId)) {
        txSh.deleteRow(i + 1);
      }
    }
  }
  var srcTx = ld_listTransactions_(clientId).filter(function (x) { return String(x.tripId) === String(sourceTripId); });
  for (var j = 0; j < srcTx.length; j++) {
    var t3 = srcTx[j];
    var id2 = ld_uuid_();
    var ts2 = Date.now();
    txSh.appendRow([
      id2, String(targetTripId), Number(t3.amount || 0), String(t3.note || ''),
      String(t3.type || 'business'), String(t3.category || ''), String(t3.date || ''),
      ts2, String(clientId), String(t3.payMethod || ''), String(t3.currency || '')
    ]);
  }
  return { ok: true };
}

function ld_saveSettings_(clientId, settingsObj) {
  ld_ensureSheets_();
  var sh = ld_ss_().getSheetByName(LD_SHEET_SETTINGS);
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var idx = ld_indexMapSettings_(header);
  var now = Date.now();
  var rowIndex = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[idx.clientId] || '') !== String(clientId)) continue;
    var k = String(r[idx.key] || '');
    if (k) rowIndex[k] = i + 1;
  }
  Object.keys(settingsObj).forEach(function (k) {
    var v = String(settingsObj[k] != null ? settingsObj[k] : '');
    if (!k) return;
    if (rowIndex[k]) {
      sh.getRange(rowIndex[k], idx.value + 1).setValue(v);
      sh.getRange(rowIndex[k], idx.updatedAt + 1).setValue(now);
    } else {
      sh.appendRow([String(clientId), k, v, now]);
    }
  });
  return { ok: true };
}

function ld_resetSheetsForClient_(clientId) {
  ld_ensureSheets_();
  if (!clientId) throw new Error('缺少裝置ID（clientId）');
  var ss = ld_ss_();
  var jobs = [
    { sheet: ss.getSheetByName(LD_SHEET_TRIPS), idxFn: ld_indexMapTrips_ },
    { sheet: ss.getSheetByName(LD_SHEET_TX), idxFn: ld_indexMapTx_ },
    { sheet: ss.getSheetByName(LD_SHEET_ITEMS), idxFn: ld_indexMapItems_ },
    { sheet: ss.getSheetByName(LD_SHEET_SETTINGS), idxFn: ld_indexMapSettings_ }
  ];
  for (var j = 0; j < jobs.length; j++) {
    var sh = jobs[j].sheet;
    if (!sh) continue;
    var vals = sh.getDataRange().getValues();
    if (vals.length <= 1) continue;
    var header = vals[0];
    var idx = jobs[j].idxFn(header);
    var cIdx = idx.clientId;
    for (var i = vals.length - 1; i >= 1; i--) {
      if (String(vals[i][cIdx] || '') === String(clientId)) sh.deleteRow(i + 1);
    }
  }
  var m = ld_getCurrentTripMap_();
  delete m[String(clientId)];
  ld_saveCurrentTripMap_(m);
  ld_createTrip_(clientId, '甜蜜代購行');
  return { ok: true };
}

// Ported business rules: Preorder.gs
/** Preorder — normalized Groups / Orders / Items on the active spreadsheet */

var PO_SHEET_GROUPS = 'Groups';
var PO_SHEET_ORDERS = 'Orders';
var PO_SHEET_ITEMS = 'Items';

function po_getOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function po_ensureSheets_(ss) {
  var g = po_getOrCreateSheet_(ss, PO_SHEET_GROUPS);
  var o = po_getOrCreateSheet_(ss, PO_SHEET_ORDERS);
  var i = po_getOrCreateSheet_(ss, PO_SHEET_ITEMS);

  var groupsHeaders = [
    'groupId', 'name', 'status', 'closingDate', 'saleEndDate', 'purchaseDate',
    'purchasePlace', 'officialShipDate',
    'jpyAmount', 'creditCard', 'orderId', 'logisticsId', 'purchaseLink',
    'createdAt', 'updatedAt'
  ];
  var ordersHeaders = [
    'orderId', 'groupId', 'customerName', 'paymentStatus', 'paymentInfo',
    'deposit', 'domesticShip', 'intlShip', 'totalTwd', 'balance',
    'createdAt', 'updatedAt'
  ];
  var itemsHeaders = [
    'itemId', 'orderId', 'name', 'qty', 'jpy', 'twd',
    'createdAt', 'updatedAt'
  ];

  po_setHeaderIfEmpty_(g, groupsHeaders);
  po_setHeaderIfEmpty_(o, ordersHeaders);
  po_setHeaderIfEmpty_(i, itemsHeaders);
}

function po_setHeaderIfEmpty_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return;
  }
  var cur = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = true;
  for (var c = 0; c < headers.length; c++) {
    if (String(cur[c] || '').trim() !== '') { empty = false; break; }
  }
  if (empty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function po_clearData_(sheet) {
  var lr = sheet.getLastRow();
  var lc = sheet.getLastColumn();
  if (lr > 1) sheet.getRange(2, 1, lr, lc).clearContent();
}

function po_safeStr_(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function po_safeNum_(v) {
  if (v === undefined || v === null || v === '') return 0;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function po_safeId_(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function po_writeAllData_(groups) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  po_ensureSheets_(ss);
  var shG = ss.getSheetByName(PO_SHEET_GROUPS);
  var shO = ss.getSheetByName(PO_SHEET_ORDERS);
  var shI = ss.getSheetByName(PO_SHEET_ITEMS);
  po_clearData_(shG);
  po_clearData_(shO);
  po_clearData_(shI);

  var now = new Date();
  var groupRows = [];
  var orderRows = [];
  var itemRows = [];

  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    if (!g) continue;
    var groupId = po_safeId_(g.id);
    groupRows.push([
      groupId,
      po_safeStr_(g.name),
      po_safeStr_(g.status),
      po_safeStr_(g.closingDate),
      po_safeStr_(g.saleEndDate),
      po_safeStr_(g.purchaseDate),
      po_safeStr_(g.purchasePlace),
      po_safeStr_(g.officialShipDate),
      po_safeNum_(g.jpyAmount),
      po_safeStr_(g.creditCard),
      po_safeStr_(g.orderId),
      po_safeStr_(g.logisticsId),
      po_safeStr_(g.purchaseLink),
      now, now
    ]);

    var orders = Array.isArray(g.orders) ? g.orders : [];
    for (var oi = 0; oi < orders.length; oi++) {
      var o = orders[oi];
      if (!o) continue;
      var orderId = po_safeId_(o.id);
      orderRows.push([
        orderId,
        groupId,
        po_safeStr_(o.customerName),
        po_safeStr_(o.paymentStatus),
        po_safeStr_(o.paymentInfo),
        po_safeNum_(o.deposit),
        po_safeNum_(o.domesticShip),
        po_safeNum_(o.intlShip),
        po_safeNum_(o.totalTwd),
        po_safeNum_(o.balance),
        now, now
      ]);

      var items = Array.isArray(o.items) ? o.items : [];
      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        if (!it) continue;
        itemRows.push([
          po_safeId_(it.id),
          orderId,
          po_safeStr_(it.name),
          po_safeNum_(it.qty),
          po_safeNum_(it.jpy),
          po_safeNum_(it.twd),
          now, now
        ]);
      }
    }
  }

  if (groupRows.length > 0) shG.getRange(2, 1, groupRows.length, groupRows[0].length).setValues(groupRows);
  if (orderRows.length > 0) shO.getRange(2, 1, orderRows.length, orderRows[0].length).setValues(orderRows);
  if (itemRows.length > 0) shI.getRange(2, 1, itemRows.length, itemRows[0].length).setValues(itemRows);

  return { ok: true, spreadsheetUrl: ss.getUrl(), stats: { groups: groupRows.length, orders: orderRows.length, items: itemRows.length } };
}

function po_readSheetAsObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(String);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blank = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] != null) { blank = false; break; }
    }
    if (blank) continue;
    var obj = {};
    for (var c2 = 0; c2 < headers.length; c2++) {
      obj[headers[c2]] = row[c2];
    }
    out.push(obj);
  }
  return out;
}

function po_readAllData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  po_ensureSheets_(ss);
  var shG = ss.getSheetByName(PO_SHEET_GROUPS);
  var shO = ss.getSheetByName(PO_SHEET_ORDERS);
  var shI = ss.getSheetByName(PO_SHEET_ITEMS);

  var groups = po_readSheetAsObjects_(shG);
  var orders = po_readSheetAsObjects_(shO);
  var items = po_readSheetAsObjects_(shI);

  var itemsByOrder = {};
  for (var ii = 0; ii < items.length; ii++) {
    var it = items[ii];
    var oid = po_safeId_(it.orderId);
    if (!oid) continue;
    if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
    itemsByOrder[oid].push({
      id: po_safeId_(it.itemId),
      name: po_safeStr_(it.name),
      qty: Number(it.qty || 0),
      jpy: Number(it.jpy || 0),
      twd: Number(it.twd || 0)
    });
  }

  var ordersByGroup = {};
  for (var oi = 0; oi < orders.length; oi++) {
    var o = orders[oi];
    var gid = po_safeId_(o.groupId);
    var oid2 = po_safeId_(o.orderId);
    if (!gid || !oid2) continue;
    if (!ordersByGroup[gid]) ordersByGroup[gid] = [];
    ordersByGroup[gid].push({
      id: oid2,
      customerName: po_safeStr_(o.customerName),
      paymentStatus: po_safeStr_(o.paymentStatus) || '未付款',
      paymentInfo: po_safeStr_(o.paymentInfo),
      deposit: Number(o.deposit || 0),
      domesticShip: Number(o.domesticShip || 0),
      intlShip: Number(o.intlShip || 0),
      totalTwd: Number(o.totalTwd || 0),
      balance: Number(o.balance || 0),
      items: itemsByOrder[oid2] || []
    });
  }

  var out = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    var gid3 = po_safeId_(g.groupId);
    if (!gid3) continue;
    out.push({
      id: gid3,
      name: po_safeStr_(g.name),
      status: po_safeStr_(g.status) || '已登記',
      closingDate: po_safeStr_(g.closingDate),
      saleEndDate: po_safeStr_(g.saleEndDate),
      purchaseDate: po_safeStr_(g.purchaseDate),
      purchasePlace: po_safeStr_(g.purchasePlace),
      officialShipDate: po_safeStr_(g.officialShipDate),
      jpyAmount: po_safeStr_(g.jpyAmount),
      creditCard: po_safeStr_(g.creditCard),
      orderId: po_safeStr_(g.orderId),
      logisticsId: po_safeStr_(g.logisticsId),
      purchaseLink: po_safeStr_(g.purchaseLink),
      orders: ordersByGroup[gid3] || []
    });
  }
  out.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  return out;
}

/**
 * 顧客預購查單：暱稱與下單時完全一致；Portal 文案與開團查詢共用系統設定。
 * @param {{customerName:string}} pl
 */
function po_customerLookup_(pl) {
  var rawQ = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var lookupPin = pl && pl.lookupPin != null ? String(pl.lookupPin) : '';
  var all = gb_fetchAllData_();
  var portalConfig = all.portalConfig || gb_buildPortalConfigFromSettings_({});
  var matches = [];
  if (!rawQ) {
    return { portalConfig: portalConfig, matches: matches };
  }

  var groups = po_readAllData_();
  var portalCustomers = all.portalLookupCustomers || [];
  var qLower = rawQ.toLowerCase();
  var candidateMap = {};

  function addCandidate(n) {
    var key = String(n || '').trim();
    if (key) candidateMap[key] = true;
  }

  var gi, oi, g, o, orders, namePool = {}, i;
  for (gi = 0; gi < groups.length; gi++) {
    g = groups[gi];
    orders = g.orders || [];
    for (oi = 0; oi < orders.length; oi++) {
      o = orders[oi];
      var cn = String(o.customerName || '').trim();
      if (cn) namePool[cn] = true;
      if (String(o.id || '').trim().toLowerCase() === qLower) addCandidate(cn);
    }
  }
  for (var pi = 0; pi < portalCustomers.length; pi++) {
    var pc = portalCustomers[pi];
    if (pc && pc.name) namePool[String(pc.name).trim()] = true;
    if (pc && pc.lineDisplayName) namePool[String(pc.lineDisplayName).trim()] = true;
  }

  var poolKeys = Object.keys(namePool);
  for (i = 0; i < poolKeys.length; i++) {
    if (poolKeys[i].toLowerCase() === qLower) addCandidate(poolKeys[i]);
  }
  if (Object.keys(candidateMap).length === 0) {
    for (i = 0; i < poolKeys.length; i++) {
      if (poolKeys[i].toLowerCase().indexOf(qLower) >= 0) addCandidate(poolKeys[i]);
    }
  }
  if (Object.keys(candidateMap).length === 0) addCandidate(rawQ);

  var authorized = {};
  var candKeys = Object.keys(candidateMap);
  var authOkAny = false;
  var lastAuthMsg = '查單密碼錯誤';
  for (i = 0; i < candKeys.length; i++) {
    var auth = gb_verifyLookupPin_(candKeys[i], lookupPin, portalCustomers);
    if (auth.ok) {
      authorized[candKeys[i].toLowerCase()] = true;
      authOkAny = true;
    } else if (auth.message) {
      lastAuthMsg = auth.message;
    }
  }
  if (!authOkAny) {
    return { portalConfig: portalConfig, matches: matches, lookupError: lastAuthMsg };
  }

  for (gi = 0; gi < groups.length; gi++) {
    g = groups[gi];
    orders = g.orders || [];
    for (oi = 0; oi < orders.length; oi++) {
      o = orders[oi];
      var on = String(o.customerName || '').trim();
      if (!authorized[on.toLowerCase()]) continue;
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
        order: {
          id: o.id,
          customerName: o.customerName,
          paymentStatus: o.paymentStatus,
          paymentInfo: o.paymentInfo,
          deposit: o.deposit,
          domesticShip: o.domesticShip,
          intlShip: o.intlShip,
          totalTwd: o.totalTwd,
          balance: o.balance,
          items: o.items || []
        }
      });
    }
  }
  return { portalConfig: portalConfig, matches: matches };
}

// Ported business rules: SystemHub.gs
/**
 * 系統資料中樞：以試算表分頁集中儲存任意 JSON（category + key 唯一）。
 * 分頁「Heina系統資料」：category | key | value_json | updated_at | note
 * 分頁「Heina系統日誌」：append-only 稽核（timestamp | category | action | key | snippet | note）
 * 單格上限約 5 萬字元，value_json 請控制體積。
 */

var SHUB_SHEET_DATA = 'Heina系統資料';
var SHUB_SHEET_LOG = 'Heina系統日誌';

function shub_ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 建立分頁與表頭（已存在則不覆寫內容） */
function shub_ensureSheets_() {
  var ss = shub_ss_();
  var d = ss.getSheetByName(SHUB_SHEET_DATA);
  if (!d) {
    d = ss.insertSheet(SHUB_SHEET_DATA);
    d.appendRow(['category', 'key', 'value_json', 'updated_at', 'note']);
    d.setFrozenRows(1);
    d.getRange('A1:E1').setFontWeight('bold');
  }
  var l = ss.getSheetByName(SHUB_SHEET_LOG);
  if (!l) {
    l = ss.insertSheet(SHUB_SHEET_LOG);
    l.appendRow(['timestamp', 'category', 'action', 'key', 'snippet', 'note']);
    l.setFrozenRows(1);
    l.getRange('A1:F1').setFontWeight('bold');
  }
}

/**
 * @param {string} category
 * @param {string} key
 * @param {*} value 會 JSON.stringify；已是字串則原樣寫入
 * @param {string=} note
 * @return {{ok:boolean, row:number}}
 */
function shub_put_(category, key, value, note) {
  shub_ensureSheets_();
  var cat = String(category || '').trim();
  var k = String(key || '').trim();
  if (!cat || !k) throw new Error('systemhub put: category 與 key 必填');
  var json = typeof value === 'string' ? value : JSON.stringify(value);
  var now = new Date().toISOString();
  var n = note != null ? String(note) : '';

  var sh = shub_ss_().getSheetByName(SHUB_SHEET_DATA);
  var last = sh.getLastRow();
  var row = 0;
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last, 2).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === cat && String(keys[i][1]) === k) {
        row = 2 + i;
        break;
      }
    }
  }
  if (row > 0) {
    sh.getRange(row, 3, 1, 3).setValues([[json, now, n]]);
  } else {
    sh.appendRow([cat, k, json, now, n]);
    row = sh.getLastRow();
  }
  shub_appendLog_(cat, 'put', k, shub_snippet_(json), n);
  return { ok: true, row: row };
}

/**
 * @return {{category:string,key:string,value:*,valueRaw:string,updatedAt:string,note:string}|null}
 */
function shub_get_(category, key) {
  shub_ensureSheets_();
  var cat = String(category || '').trim();
  var k = String(key || '').trim();
  if (!cat || !k) return null;
  var sh = shub_ss_().getSheetByName(SHUB_SHEET_DATA);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === cat && String(rows[i][1]) === k) {
      var raw = String(rows[i][2] != null ? rows[i][2] : '');
      var parsed = shub_tryParseJson_(raw);
      return {
        category: cat,
        key: k,
        value: parsed,
        valueRaw: raw,
        updatedAt: String(rows[i][3] != null ? rows[i][3] : ''),
        note: String(rows[i][4] != null ? rows[i][4] : '')
      };
    }
  }
  return null;
}

/**
 * @return {Array<{category:string,key:string,value:*,valueRaw:string,updatedAt:string,note:string}>}
 */
function shub_list_(category) {
  shub_ensureSheets_();
  var cat = String(category || '').trim();
  var sh = shub_ss_().getSheetByName(SHUB_SHEET_DATA);
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return out;
  var rows = sh.getRange(2, 1, last, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (cat && String(rows[i][0]) !== cat) continue;
    var raw = String(rows[i][2] != null ? rows[i][2] : '');
    out.push({
      category: String(rows[i][0]),
      key: String(rows[i][1]),
      value: shub_tryParseJson_(raw),
      valueRaw: raw,
      updatedAt: String(rows[i][3] != null ? rows[i][3] : ''),
      note: String(rows[i][4] != null ? rows[i][4] : '')
    });
  }
  return out;
}

/** @return {{ok:boolean, deleted:boolean}} */
function shub_delete_(category, key) {
  shub_ensureSheets_();
  var cat = String(category || '').trim();
  var k = String(key || '').trim();
  if (!cat || !k) throw new Error('systemhub delete: category 與 key 必填');
  var sh = shub_ss_().getSheetByName(SHUB_SHEET_DATA);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, deleted: false };
  var keys = sh.getRange(2, 1, last, 2).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === cat && String(keys[i][1]) === k) {
      sh.deleteRow(2 + i);
      shub_appendLog_(cat, 'delete', k, '', '');
      return { ok: true, deleted: true };
    }
  }
  return { ok: true, deleted: false };
}

/**
 * 僅寫日誌，不動主表。
 * @param {string} category
 * @param {string} action
 * @param {string=} key
 * @param {string=} jsonOrText
 * @param {string=} note
 */
function shub_log_(category, action, key, jsonOrText, note) {
  shub_ensureSheets_();
  var k = key != null ? String(key) : '';
  var j = jsonOrText != null ? String(jsonOrText) : '';
  shub_appendLog_(String(category || ''), String(action || ''), k, shub_snippet_(j), note != null ? String(note) : '');
  return { ok: true };
}

function shub_appendLog_(category, action, key, snippet, note) {
  var sh = shub_ss_().getSheetByName(SHUB_SHEET_LOG);
  if (!sh) return;
  sh.appendRow([new Date().toISOString(), category, action, key, snippet, note]);
}

function shub_snippet_(s) {
  var t = String(s || '');
  return t.length > 500 ? t.substring(0, 500) + '…' : t;
}

function shub_tryParseJson_(raw) {
  var r = String(raw || '').trim();
  if (!r) return null;
  try {
    return JSON.parse(r);
  } catch (e) {
    return raw;
  }
}

/** 手動測試：執行後看 Execution log */

// Ported business rules: Storefront.gs
/**
 * 官網現貨商城：目錄存於「系統設定」JSON，公開 API 不回傳倉位等內部欄位。
 */

var SF_CATALOG_KEY = 'publicSpotCatalogJson';

function sf_getSettingsSheet_() {
  gb_initSheets_();
  return SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
}

function sf_readSetting_(key) {
  var sheet = sf_getSettingsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return '';
  var rows = sheet.getRange(2, 1, last, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) return String(rows[i][1] || '');
  }
  return '';
}

function sf_sanitizeProduct_(p) {
  return {
    id: String(p.id || ''),
    name: String(p.name || ''),
    imageUrl: String(p.imageUrl || ''),
    sku: String(p.sku || ''),
    category: String(p.category || ''),
    twdPrice: Number(p.twdPrice) || 0,
    stockQty: Math.max(0, Number(p.stockQty) || 0),
    status: String(p.status || 'on_sale'),
    notes: String(p.notes || ''),
  };
}

/**
 * 顧客官網讀取上架現貨（不需登入）。
 */
function sf_getCatalog_() {
  var raw = sf_readSetting_(SF_CATALOG_KEY);
  var list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
  }
  var products = [];
  for (var i = 0; i < list.length; i++) {
    var p = sf_sanitizeProduct_(list[i]);
    if (p.status === 'on_sale' && p.stockQty > 0 && p.name) {
      products.push(p);
    }
  }
  return { products: products, updatedAt: new Date().toISOString() };
}

/**
 * 後台發布現貨至官網（寫入試算表設定）。
 * @param {Object} payload { products: Array }
 */
function sf_publishCatalog_(payload) {
  payload = payload || {};
  var src = payload.products || [];
  var out = [];
  for (var i = 0; i < src.length; i++) {
    out.push(sf_sanitizeProduct_(src[i]));
  }
  var sheet = sf_getSettingsSheet_();
  gb_upsertSetting_(sheet, SF_CATALOG_KEY, JSON.stringify(out));
  return { ok: true, count: out.length };
}

// Ported business rules: Web.gs
function heinaIsPublicAction_(mod, act) {
  if (mod === 'auth' && act === 'login') return true;
  if (mod === 'groupbuy') {
    if (act === 'customerLookup') return true;
    if (act === 'publicRevision') return true;
    if (act === 'changeLookupPin') return true;
    if (act === 'submitPaymentReport') return true;
    if (act === 'listPublicGroups') return true;
    if (act === 'verifyBankViewerAccess') return true;
    if (act === 'publicBootstrap') return true;
    if (act === 'customerBalanceMemos') return true;
  }
  if (mod === 'preorder' && act === 'customerLookup') return true;
  if (mod === 'storefront' && act === 'getCatalog') return true;
  return false;
}

/**
 * Single RPC for the SPA.
 * @param {string} json JSON.stringify({ module, action, payload, adminToken? })
 * @return {*}
 */
function unifiedApi(json) {
  var req = JSON.parse(json);
  var mod = req.module;
  var act = req.action;
  var pl = req.payload;

  if (!heinaIsPublicAction_(mod, act)) {
    if (!heinaAdminTokenValid_(req.adminToken)) {
      throw new Error('需要管理員登入');
    }
  }

  if (mod === 'auth') {
    if (act === 'login') return heinaAdminLogin_(pl);
    if (act === 'changePassword') return heinaAdminChangePassword_(pl);
    if (act === 'session') return { ok: heinaAdminTokenValid_(req.adminToken) };
  }
  if (mod === 'groupbuy') {
    if (act === 'getAppData') return gb_fetchAllData_();
    if (act === 'peekRevision') return gb_peekRevision_();
    if (act === 'fetchSlice') return gb_fetchSlice_(pl);
    if (act === 'saveAppData') return gb_performSave_(pl);
    if (act === 'saveBankJournal') return gb_saveBankJournal_(pl);
    if (act === 'deleteBankJournalRows') return gb_deleteBankJournalRows_(pl);
    if (act === 'restoreBankJournalRows') return gb_restoreBankJournalRows_(pl);
    if (act === 'syncPortalLookupCustomers') return gb_syncPortalLookupCustomers_(pl);
    if (act === 'changeLookupPin') return gb_changeLookupPin_(pl);
    if (act === 'customerLookup') return gb_customerLookup_(pl);
    if (act === 'publicRevision') return gb_publicRevision_();
    if (act === 'submitPaymentReport') return gb_submitPaymentReport_(pl);
    if (act === 'confirmPaymentReport') return gb_confirmPaymentReport_(pl);
    if (act === 'deletePaymentReport') return gb_deletePaymentReport_(pl);
    if (act === 'revertPaymentReport') return gb_revertPaymentReport_(pl);
    if (act === 'updatePaymentReportLineFlags') return gb_updatePaymentReportLineFlags_(pl);
    if (act === 'supplementPaymentReport') return gb_supplementPaymentReport_(pl);
    if (act === 'listPublicGroups') return gb_publicGroupCatalog_();
    if (act === 'publicBootstrap') return gb_publicBootstrap_();
    if (act === 'customerBalanceMemos') return gb_customerBalanceMemos_(pl);
    if (act === 'getBankViewerAdmin') return gb_getBankViewerAdmin_();
    if (act === 'saveBankViewer') return gb_saveBankViewer_(pl);
    if (act === 'verifyBankViewerAccess') return gb_verifyBankViewerAccess_(pl);
    if (act === 'exportDataPack') return gb_exportDataPack_();
    if (act === 'importDataPack') return gb_importDataPack_(pl);
  }
  if (mod === 'ledger') {
    if (act === 'getInitData') return ld_getInitData_(pl.clientId);
    if (act === 'createTrip') return ld_createTrip_(pl.clientId, pl.name);
    if (act === 'setCurrentTrip') return ld_setCurrentTrip_(pl.clientId, pl.tripId);
    if (act === 'addTransaction') return ld_addTransaction_(pl.clientId, pl.payload);
    if (act === 'deleteTransaction') return ld_deleteTransaction_(pl.clientId, pl.txId);
    if (act === 'createItemsBatch') return ld_createItemsBatch_(pl.clientId, pl.rawText);
    if (act === 'deleteItem') return ld_deleteItem_(pl.clientId, pl.itemId);
    if (act === 'deleteTrip') return ld_deleteTrip_(pl.clientId, pl.tripId);
    if (act === 'duplicateTrip') return ld_duplicateTrip_(pl.clientId, pl.sourceTripId, pl.newTripName || '');
    if (act === 'overwriteTrip') return ld_overwriteTrip_(pl.clientId, pl.sourceTripId, pl.targetTripId);
    if (act === 'saveSettings') return ld_saveSettings_(pl.clientId, pl.settingsObj);
    if (act === 'resetSheetsForClient') return ld_resetSheetsForClient_(pl.clientId);
  }
  if (mod === 'preorder') {
    if (act === 'export') return po_readAllData_();
    if (act === 'save') return po_writeAllData_(pl);
    if (act === 'customerLookup') return po_customerLookup_(pl);
  }
  if (mod === 'systemhub') {
    if (act === 'ensureSheets') {
      shub_ensureSheets_();
      return { ok: true };
    }
    if (act === 'put') return shub_put_(pl.category, pl.key, pl.value, pl.note);
    if (act === 'get') return shub_get_(pl.category, pl.key);
    if (act === 'list') return shub_list_(pl.category || '');
    if (act === 'delete') return shub_delete_(pl.category, pl.key);
    if (act === 'appendLog') return shub_log_(pl.category, pl.action, pl.key, pl.json, pl.note);
  }
  if (mod === 'storefront') {
    if (act === 'getCatalog') return sf_getCatalog_();
    if (act === 'publishCatalog') return sf_publishCatalog_(pl);
  }
  throw new Error('Unknown module/action: ' + mod + '/' + act);
}

return { dispatch: req => unifiedApi(JSON.stringify(req)), authorized: req => heinaIsPublicAction_(req.module, req.action) || heinaAdminTokenValid_(req.adminToken) };
}
