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

function gb_setGroupPortalFields_(group) {
  var sh = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var id = String(group.id || '');
  var imageUrls = group.imageUrls || [];
  if ((!imageUrls || !imageUrls.length) && group.coverImageUrl) {
    imageUrls = [String(group.coverImageUrl)];
  }
  var cover = String(group.coverImageUrl || (imageUrls.length ? imageUrls[0] : '') || '');
  gb_upsertSetting_(sh, 'gb_description_' + id, String(group.description || ''));
  gb_upsertSetting_(sh, 'gb_coverImage_' + id, cover.length > 49000 ? '' : cover);
  gb_upsertSetting_(sh, 'gb_remarks_' + id, String(group.remarks || ''));
  gb_upsertSetting_(sh, 'gb_channel_' + id, String(group.channel || ''));
  if (group.opsActive === false) gb_upsertSetting_(sh, 'gb_opsActive_' + id, '0');
  else gb_upsertSetting_(sh, 'gb_opsActive_' + id, '1');
  if (group.portalListed === false) gb_upsertSetting_(sh, 'gb_portalListed_' + id, '0');
  else gb_upsertSetting_(sh, 'gb_portalListed_' + id, '1');
  gb_upsertSetting_(sh, 'gb_stockAlert_' + id, group.stockAlert ? '1' : '0');
  gb_upsertSetting_(sh, 'gb_stockAlertNote_' + id, String(group.stockAlertNote || ''));
  gb_writeGroupImages_(sh, id, imageUrls);
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
  var bankJournal = journalRows.map(function (r) {
    var note = String(r[6] || '');
    var m = note.match(/#(\d{5})/) || note.match(/後五碼\s*(\d{5})/);
    return { id: r[0], date: r[1], bank: r[2], type: r[3], amount: r[4], category: r[5], note: note, lastFive: m ? m[1] : '' };
  });

  var settings = gb_loadSettingsMap_(settingsSheet).map;
  var exchangeRate = settings.exchangeRate ? Number(settings.exchangeRate) : 0.22;
  var portalConfig = gb_buildPortalConfigFromSettings_(settings);

  var bankViewerCfg = gb_migrateBankPassword_(settingsSheet, settings, gb_readBankViewerConfig_(settings));
  return {
    groups: Object.keys(groupsMap).map(function (k) { return groupsMap[k]; }),
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
  var all = gb_fetchAllData_();
  var portalConfig = all.portalConfig;
  var matches = [];
  if (!rawQ) return { portalConfig: portalConfig, matches: matches };

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
  if (!authOkAny) return { portalConfig: portalConfig, matches: matches, lookupError: lastAuthMsg };

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
  return { portalConfig: portalConfig, matches: matches };
}

function gb_emptyGroupRow_(g, exportDate) {
  return [
    '', '', '', '', '', '', '', '', '', '', '', '',
    g.officialShipDate, g.name, g.id, g.status || '已登記',
    g.closingDate, g.saleEndDate, g.purchaseDate || '', g.jpyAmount,
    g.orderId, g.logisticsId, g.purchaseLink || '', '', '', exportDate
  ];
}

function gb_orderStubRow_(g, o, exportDate) {
  return [
    o.customerName, '', '', '', '', '', o.totalTwd, o.deposit, o.domesticShip, o.intlShip,
    o.balance, o.paymentStatus, g.officialShipDate, g.name, g.id, g.status || '已登記',
    g.closingDate, g.saleEndDate, g.purchaseDate || '', g.jpyAmount,
    g.orderId, g.logisticsId, g.purchaseLink || '', o.id, o.paymentInfo || '', exportDate
  ];
}

function gb_buildFlatRows_(groups) {
  var rows = [];
  var exportDate = new Date().toISOString().slice(0, 10);
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    gb_setGroupCreditCard_(g.id, g.creditCard || '');
    gb_setGroupPortalFields_(g);
    gb_setGroupCostFields_(g);
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
          g.officialShipDate, g.name, g.id, g.status || '已登記',
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
  if (last > 1) sheet.getRange(2, 1, last, 7).clearContent();
  var list = bankJournal || [];
  var jRows = [];
  for (var i = 0; i < list.length; i++) {
    var j = list[i];
    jRows.push([j.id, j.date, j.bank, j.type, j.amount, j.category, gb_journalNoteWithFive_(j)]);
  }
  if (jRows.length > 0) {
    sheet.getRange(2, 1, jRows.length, 7).setValues(jRows);
  }
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

function gb_saveBankJournal_(pl) {
  var all = gb_fetchAllData_();
  var incoming = (pl && pl.bankJournal) || [];
  var mode = pl && pl.mode ? String(pl.mode) : 'replace';
  var next = mode === 'upsert' ? gb_upsertJournalRows_(all.bankJournal || [], incoming) : incoming;
  gb_writeJournalSheet_(next);
  return { status: 'success', bankJournal: next };
}

function gb_performSave_(payload) {
  gb_initSheets_();
  var settingsSheetForRev = SpreadsheetApp.getActive().getSheetByName(GB_SHEET_SETTINGS);
  var revCache = gb_loadSettingsMap_(settingsSheetForRev);
  var currentRev = String(revCache.map.gb_dataRevision || '0');
  if (payload && payload.dataRevision != null && String(payload.dataRevision) !== '' && String(payload.dataRevision) !== currentRev) {
    throw new Error('資料已在另一個畫面更新，請重新整理後再儲存，避免蓋過剛改的內容。');
  }
  var ss = SpreadsheetApp.getActive();
  var orderSheet = ss.getSheetByName(GB_SHEET_ORDERS);
  var settingsSheet = ss.getSheetByName(GB_SHEET_SETTINGS);

  var last = orderSheet.getLastRow();
  if (last > 1) orderSheet.getRange(2, 1, last, GB_COLS).clearContent();

  var rows = gb_buildFlatRows_(payload.groups || []);
  if (rows.length > 0) {
    orderSheet.getRange(2, 1, rows.length, GB_COLS).setValues(rows);
  }

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
  } else if (!String(want).trim()) {
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: false, reason: 'empty_password' });
    result = { ok: false, message: '團主尚未設定查詢密碼，請私訊索取。' };
  } else if (!heinaSafeEqual_(accessPassword, want)) {
    nextCfg = gb_appendBankViewerLog_(cfg, { customerName: customerName, ok: false, reason: 'bad_password' });
    result = { ok: false, message: '查詢密碼錯誤。請向團主索取最新密碼後再試。' };
  } else {
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
  var all = gb_fetchAllData_();
  var auth = gb_verifyLookupPin_(name, pin, all.portalLookupCustomers || []);
  if (!auth.ok) return { ok: false, message: auth.message || '查單密碼錯誤', memos: [] };
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
  var cur = currentPin.replace(/\D/g, '').slice(0, 4);
  var next = newPin.replace(/\D/g, '').slice(0, 4);
  var confirm = confirmPin.replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(cur)) return { ok: false, message: '請輸入目前的 4 位數密碼' };
  if (!/^\d{4}$/.test(next)) return { ok: false, message: '新密碼須為 4 位數字' };
  if (next !== confirm) return { ok: false, message: '兩次新密碼不一致' };
  if (next === cur) return { ok: false, message: '新密碼不可與目前密碼相同' };
  var auth = gb_verifyLookupPin_(name, cur, all.portalLookupCustomers || []);
  if (!auth.ok) return { ok: false, message: auth.message || '目前密碼錯誤' };
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
  var customerName = pl && pl.customerName ? String(pl.customerName).trim() : '';
  var remittanceDate = pl && pl.remittanceDate ? String(pl.remittanceDate).trim() : '';
  var lastFive = pl && pl.lastFive ? String(pl.lastFive).trim() : '';
  var totalAmount = Math.round(Number(pl && pl.totalAmount) || 0);
  var orderIds = pl && pl.orderIds ? pl.orderIds : [];
  if (!customerName) return { ok: false, message: '請先查詢訂單' };
  if (!remittanceDate) return { ok: false, message: '請填寫匯款日期' };
  if (!/^\d{5}$/.test(lastFive)) return { ok: false, message: '後五碼需為 5 位數字' };
  if (totalAmount <= 0) return { ok: false, message: '請填寫匯款總金額' };
  if (!orderIds.length) return { ok: false, message: '請至少勾選一筆待付訂單' };

  var all = gb_fetchAllData_();
  var groups = all.groups || [];
  var reports = all.paymentReports || [];
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
  gb_writePaymentReports_(ss.getSheetByName(GB_SHEET_SETTINGS), reports);
  return {
    ok: true,
    reportId: report.id,
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

function gb_confirmPaymentReport_(pl) {
  var reportId = pl && pl.reportId ? String(pl.reportId) : '';
  var bank = pl && pl.remittanceBank ? String(pl.remittanceBank) : '待分類';
  var lineDeposits = pl && pl.lineDeposits ? pl.lineDeposits : null;
  var selectedOrderIds = pl && pl.selectedOrderIds ? pl.selectedOrderIds : null;
  if (!reportId) return { ok: false, message: '缺少回報 ID' };
  var all = gb_fetchAllData_();
  var reports = all.paymentReports || [];
  var idx = -1;
  for (var i = 0; i < reports.length; i++) {
    if (reports[i].id === reportId && reports[i].status === 'pending') idx = i;
  }
  if (idx < 0) return { ok: false, message: '找不到待確認的付款回報' };
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
    id: report.journalEntryId || ('j_pr_' + Date.now()),
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
    source: report.source || 'customer'
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
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: nextReports
  });
  gb_writeJournalSheet_(gb_upsertJournalRows_(all.bankJournal || [], [journalRow]));
  return { ok: true, message: '已確認付款' };
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
  if (!line.needsSupplement) return { ok: false, message: '此筆未標記需補款' };

  var supplementInfo = gb_formatRemittancePaymentInfo_(
    remittanceDate,
    remittanceBank,
    note || ('補款' + addAmount)
  );
  var groups = all.groups || [];
  for (var gi = 0; gi < groups.length; gi++) {
    var orders = groups[gi].orders || [];
    for (var oi = 0; oi < orders.length; oi++) {
      if (orders[oi].id !== orderId) continue;
      var newDeposit = (Number(orders[oi].deposit) || 0) + addAmount;
      var payInfo = orders[oi].paymentInfo || '';
      orders[oi].paymentStatus = '已付訂金';
      orders[oi].deposit = newDeposit;
      orders[oi].balance = gb_calcOrderBalance_(orders[oi].totalTwd, newDeposit, orders[oi].domesticShip, orders[oi].intlShip);
      orders[oi].paymentInfo = payInfo ? payInfo + ' · ' + supplementInfo : supplementInfo;
    }
  }
  var journalRow = {
    id: 'j_sup_' + Date.now(),
    date: remittanceDate,
    bank: remittanceBank || '待分類',
    type: '收入',
    amount: addAmount,
    category: '團購訂金',
    note: report.customerName + ' 補款 ' + line.groupName + ' · ' + (note || '補款')
  };
  var newLineDep = line.deposit + addAmount;
  var lineExp = gb_lineExpectedDeposit_(line);
  var updatedLine = {
    orderId: line.orderId,
    groupId: line.groupId,
    groupName: line.groupName,
    lookupCode: line.lookupCode,
    expectedDeposit: line.expectedDeposit != null ? line.expectedDeposit : line.deposit,
    deposit: newLineDep,
    needsSupplement: newLineDep < lineExp,
    supplementTotal: (line.supplementTotal || 0) + addAmount
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
    totalAmount: report.totalAmount + addAmount,
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
  gb_performSave_({
    groups: groups,
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: reports
  });
  gb_writeJournalSheet_(gb_upsertJournalRows_(all.bankJournal || [], [journalRow]));
  return { ok: true, message: '補款已入帳' };
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
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: reports
  });
  return { ok: true, message: '已返回待確認' };
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
    exchangeRate: all.exchangeRate,
    portalConfig: all.portalConfig,
    paymentReports: nextReports
  });
  return { ok: true, message: '已刪除付款回報' };
}
