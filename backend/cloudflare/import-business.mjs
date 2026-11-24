import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('../../', import.meta.url);
if (existsSync(new URL('backend/cloudflare/src/business.mjs', base))) throw new Error('Standalone business module already exists; edit it directly. Do not overwrite migration changes.');
const files = ['Secrets.gs','GroupBuy.gs','HeinaSafety.gs','Ledger.gs','Preorder.gs','SystemHub.gs','Storefront.gs','Web.gs'];
const hashes = {};
function strip(source, name) {
  return source.replace(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}\\n?', 'm'), '');
}
const sources = files.map(name => {
  let s = readFileSync(new URL('gas/'+name, base), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  hashes[name] = createHash('sha256').update(s).digest('hex');
  if (name === 'HeinaSafety.gs') {
    s = s.slice(s.indexOf('function gb_assertWritableSpreadsheet_()'), s.indexOf('\nfunction gb_demoClearHazard_('));
    s = strip(s, 'gb_testFailStep_');
  }
  s = s.replace(/^  if \(gb_testFailStep_\(\) === '[^']+'\) \{[\s\S]*?^  \}\n/gm, '');
  if (name === 'Ledger.gs') s = strip(s, 'ld_setSpreadsheetIdForTests_');
  if (name === 'SystemHub.gs') s = strip(s, 'runSystemHubSmokeTest');
  if (name === 'Web.gs') s = s.slice(s.indexOf('function heinaIsPublicAction_'));
  if (name === 'Secrets.gs') s = s.replace('請到 Apps Script → 專案設定 → 指令碼屬性，新增 HEINA_ADMIN_PASSWORD 後重新部署 Web App。', '請在後端設定 HEINA_ADMIN_PASSWORD。');
  return '// Ported business rules: '+name+'\n'+s;
});
let body = sources.join('\n');
for (const marker of ['HEINA_TEST_SHEET_ID_', 'HEINA_TEST_MODE', 'HEINA_FAIL_STEP', 'gb_testFailStep_', 'heinaSeedUi_', 'runSystemHubSmokeTest', 'HtmlService', 'ContentService']) {
  if (body.includes(marker)) throw new Error('Unexpected test/platform code: '+marker);
}
const prefix = '// Standalone business rules. No Apps Script runtime or network dependency.\n// Imported once from the existing tested candidate; edit this module after migration.\nexport function createBusiness(services) {\nconst { SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, Session } = services;\n';
const suffix = '\nreturn { dispatch: req => unifiedApi(JSON.stringify(req)), authorized: req => heinaIsPublicAction_(req.module, req.action) || heinaAdminTokenValid_(req.adminToken) };\n}\n';
writeFileSync(new URL('backend/cloudflare/src/business.mjs', base), prefix+body+suffix);
writeFileSync(new URL('backend/cloudflare/source-manifest.json', base), JSON.stringify({note:'Source provenance only. Backend runs independently of Apps Script.',sha256:hashes}, null, 2)+'\n');
console.log('Ported '+files.length+' business modules; stripped test dispatchers and Apps Script web entry.');
