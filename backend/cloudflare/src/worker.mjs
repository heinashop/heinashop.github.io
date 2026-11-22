import { createHash, randomUUID } from 'node:crypto';
import { createBusiness } from './business.mjs';
import { createServices, Workbook } from './sheets-model.mjs';
import { GoogleSheets } from './google-sheets.mjs';

const READS=new Set([
 'auth/session','groupbuy/getAppData','groupbuy/peekRevision','groupbuy/fetchSlice','groupbuy/customerLookup','groupbuy/publicRevision',
 'groupbuy/listPublicGroups','groupbuy/publicBootstrap','groupbuy/customerBalanceMemos','groupbuy/getBankViewerAdmin','groupbuy/verifyBankViewerAccess','groupbuy/exportDataPack',
 'ledger/getInitData','preorder/export','preorder/customerLookup','systemhub/get','systemhub/list','storefront/getCatalog',
]);
const ACTIONS={
 auth:['login','session','changePassword','migrationStatus','resolvePending'],
 groupbuy:['getAppData','peekRevision','fetchSlice','saveAppData','saveBankJournal','deleteBankJournalRows','restoreBankJournalRows','syncPortalLookupCustomers','changeLookupPin','customerLookup','publicRevision','submitPaymentReport','confirmPaymentReport','deletePaymentReport','revertPaymentReport','updatePaymentReportLineFlags','supplementPaymentReport','listPublicGroups','publicBootstrap','customerBalanceMemos','getBankViewerAdmin','saveBankViewer','verifyBankViewerAccess','exportDataPack','importDataPack'],
 ledger:['getInitData','createTrip','setCurrentTrip','addTransaction','deleteTransaction','createItemsBatch','deleteItem','deleteTrip','duplicateTrip','overwriteTrip','saveSettings','resetSheetsForClient'],
 preorder:['export','save','customerLookup'],
 systemhub:['ensureSheets','put','get','list','delete','appendLog'],
 storefront:['getCatalog','publishCatalog'],
};
export function isRead(req) { return READS.has(req.module+'/'+req.action); }
export function validateRequest(req) {
 if(!req||typeof req!=='object'||Array.isArray(req)||!Object.hasOwn(ACTIONS,req.module)||!ACTIONS[req.module].includes(req.action)) throw new Error('不支援的 API 操作');
 if(req.adminToken!=null&&(typeof req.adminToken!=='string'||req.adminToken.length>512)) throw new Error('登入憑證格式無效');
 return req;
}
export function json(data,status=200,headers={}) { return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}}); }
async function readBody(request) {
 if(Number(request.headers.get('Content-Length')||0)>8000000) throw new Error('請求超過 8MB');
 if(!request.body) throw new Error('缺少請求內容');
 const reader=request.body.getReader(),chunks=[];let bytes=0;
 try { while(true) {const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8000000)throw new Error('請求超過 8MB');chunks.push(value);} }
 finally { await reader.cancel().catch(()=>{}); }
 return validateRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
function configured(env) { return Boolean(env.HEINA_SPREADSHEET_ID&&env.GOOGLE_SERVICE_ACCOUNT_JSON&&env.HEINA_ADMIN_PASSWORD&&env.ALLOWED_ORIGINS); }
export default {
 async fetch(request,env) {
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const allowed=String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(origin&&!allowed.includes(origin)) return json({ok:false,error:'不允許的網站來源'},403);
  const headers=origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  if(url.pathname==='/health'&&request.method==='GET') return json({ok:configured(env),backend:'cloudflare-sheets',writesEnabled:env.HEINA_WRITES_ENABLED==='true'},configured(env)?200:503,headers);
  if(url.pathname!=='/api'||request.method!=='POST') return json({ok:false,error:'找不到 API'},404,headers);
  if(!configured(env)) return json({ok:false,error:'後端尚未完成設定'},503,headers);
  let req;
  try { req=await readBody(request); } catch { return json({ok:false,error:'請求格式無效、操作不支援或資料過大'},400,headers); }
  try {
   const id=env.HEINA_COORDINATOR.idFromName(env.HEINA_SPREADSHEET_ID);
   const stub=env.HEINA_COORDINATOR.get(id);
   const internal=new Request('https://internal/api',{method:'POST',headers:{'Content-Type':'application/json','X-Client-Key':createHash('sha256').update(request.headers.get('CF-Connecting-IP')||'unknown').digest('hex')},body:JSON.stringify(req)});
   const response=await stub.fetch(internal);
   return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  } catch { return json({ok:false,error:'後端暫時無法回應，請重新載入確認資料後再試'},503,headers); }
 },
};

/** One instance per spreadsheet; explicit promise queue covers network awaits as well as synchronous work. */
export class HeinaCoordinator {
 constructor(ctx,env) { this.ctx=ctx;this.env=env;this.sheets=new GoogleSheets(env);this.tail=Promise.resolve();this.depth=0; }
 async fetch(request) {
  if(this.depth>=20) return json({ok:false,error:'系統忙碌，請稍候再試'},429);
  this.depth++;
  const task=this.tail.then(()=>this.handle(request));
  this.tail=task.catch(()=>{});
  try {return await task;} finally {this.depth--;}
 }
 async handle(request) {
  let req;
  try {req=validateRequest(await request.json());} catch {return json({ok:false,error:'請求格式無效'},400);}
  const state=await this.ctx.storage.get('state')||{props:{},cache:{}};
  let before=structuredClone(state.props);
  const key=request.headers.get('X-Client-Key')||'unknown';
  const minute=Math.floor(Date.now()/60000),rateKey='rate:'+key;
  const rate=await this.ctx.storage.get(rateKey)||{minute,count:0};
  if(rate.minute!==minute) {rate.minute=minute;rate.count=0;}
  rate.count++;
  await this.ctx.storage.put(rateKey,rate);
  await this.ctx.storage.setAlarm(Date.now()+120000);
  if(rate.count>120) return json({ok:false,error:'請求過於頻繁，請稍候再試'},429);
  const early=createBusiness(createServices(new Workbook(this.env.HEINA_SPREADSHEET_ID),state,this.env));
  if(!early.authorized(req)) return json({ok:false,error:'需要管理員登入'},401);
  if(req.module==='auth' && ['migrationStatus','resolvePending'].includes(req.action)) {
   const pending=await this.ctx.storage.get('pendingCommit');
   if(req.action==='migrationStatus') return json({ok:true,result:{writesEnabled:this.env.HEINA_WRITES_ENABLED==='true',pending:pending?{id:pending.id,at:pending.at,operation:pending.operation}:null}});
   if(!pending) return json({ok:true,result:{resolved:true}});
   if(req.payload?.pendingId!==pending.id) return json({ok:false,error:'待核對操作已變更，請重新讀取狀態'},409);
   try {
    const book=await this.sheets.load();
    const marker=book.getSheetByName('系統設定')?.getDataRange().getValues().find(r=>r[0]==='heina_worker_commit')?.[1]||'';
    if(marker===pending.id) {
     state.props=pending.props;
     await this.ctx.storage.transaction(async tx=>{await tx.put('state',state);await tx.delete('pendingCommit');});
     return json({ok:true,result:{resolved:true,committed:true}});
    }
    if(Date.now()-pending.at<300000 || req.payload?.confirmUncommitted!==true || req.payload?.observedMarker!==String(marker)) return json({ok:false,error:'請等待至少五分鐘，人工核對試算表與最後寫入標記，再明確確認此操作未寫入'},409);
    await this.ctx.storage.delete('pendingCommit');
    return json({ok:true,result:{resolved:true,committed:false}});
   } catch {return json({ok:false,error:'無法核對 Google Sheets 寫入結果'},503);}
  }
  if(req.module==='auth') {
   try {const result=early.dispatch(req);await this.ctx.storage.put('state',state);return json({ok:true,result});}
   catch {state.props=before;await this.ctx.storage.put('state',state);return json({ok:false,error:'登入操作失敗'},400);}
  }
  const write=!isRead(req) || (req.module==='ledger' && req.action==='getInitData' && this.env.HEINA_WRITES_ENABLED==='true');
  if(write&&this.env.HEINA_WRITES_ENABLED!=='true') return json({ok:false,error:'目前為唯讀驗收模式，尚未啟用寫入'},403);
  let book;
  try {
   book=await this.sheets.load({readOnly:!write});
   const pending=await this.ctx.storage.get('pendingCommit');
   if(pending) {
    const sh=book.getSheetByName('系統設定');
    const marker=sh?.getDataRange().getValues().find(row=>row[0]==='heina_worker_commit')?.[1];
    if(marker===pending.id) {
     state.props=pending.props;
     before=structuredClone(state.props);
     await this.ctx.storage.transaction(async tx=>{await tx.put('state',state);await tx.delete('pendingCommit');});
    } else if(write) return json({ok:false,error:'上一筆寫入結果尚待核對，暫停寫入；請由管理者依設定文件處理'},503);
   }
   const business=createBusiness(createServices(book,state,this.env));
   if(!business.authorized(req)) return json({ok:false,error:'需要重新登入'},401);
   const result=business.dispatch(req);
   if(write&&result?.ok===false) {state.props=before;await this.ctx.storage.put('state',state);return json({ok:true,result});}
   if(write&&book.requests.length) {
    const sh=book.getSheetByName('系統設定')||book.insertSheet('系統設定');
    const rows=sh.getDataRange().getValues(),row=rows.findIndex(r=>r[0]==='heina_worker_commit');
    const id=randomUUID();
    if(row>=0) sh.getRange(row+1,2).setValue(id);else sh.appendRow(['heina_worker_commit',id]);
    await this.ctx.storage.put('pendingCommit',{id,at:Date.now(),props:state.props,operation:req.module+'/'+req.action});
    await this.sheets.commit(book);
    await this.ctx.storage.transaction(async tx=>{await tx.put('state',state);await tx.delete('pendingCommit');});
   } else {
    if(!write) state.props=before;
    await this.ctx.storage.put('state',state);
   }
   return json({ok:true,result});
  } catch(error) {
   // Pending marker remains after an uncertain API result. A later read reconciles committed writes.
   state.props=before;
   await this.ctx.storage.put('state',state);
   const message=error instanceof Error?error.message:'後端操作失敗';
   return json({ok:false,error:message},400);
  }
 }
 async alarm() {
  const items=await this.ctx.storage.list({prefix:'rate:'});
  const cutoff=Math.floor(Date.now()/60000)-2;
  for(const [key,value] of items) if(value.minute<cutoff) await this.ctx.storage.delete(key);
 }
}
