import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusiness} from '../src/business.mjs';
import {Workbook,createServices} from '../src/sheets-model.mjs';
import {serialDate,GoogleSheets} from '../src/google-sheets.mjs';
import worker,{HeinaCoordinator,validateRequest} from '../src/worker.mjs';
import {generateKeyPairSync,createVerify} from 'node:crypto';

const env={HEINA_SPREADSHEET_ID:'test-sheet',HEINA_ADMIN_PASSWORD:'synthetic-admin-test',HEINA_LOOKUP_PIN:'8642',HEINA_BANK_PASSWORD:'synthetic-bank-test',HEINA_WRITES_ENABLED:'true',ALLOWED_ORIGINS:'https://heinashop.com',GOOGLE_SERVICE_ACCOUNT_JSON:'{}'};
const snapshot=b=>b.sheets.map(s=>({properties:{sheetId:s.id,title:s.name,gridProperties:{rowCount:s.rows,columnCount:s.columns}},values:structuredClone(s.data)}));
function fixture() {
 const book=new Workbook('test-sheet'),state={props:{},cache:{}};
 const call=(module,action,payload,token)=>createBusiness(createServices(book,state,env)).dispatch({module,action,payload,adminToken:token});
 const login=call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});
 const admin=(module,action,payload)=>call(module,action,payload,login.token);
 return {book,state,call,admin,token:login.token};
}
function sampleGroup() {return {id:'g1',name:'測試團',status:'已登記',orders:[{id:'o1',customerName:'測試甲',items:[{name:'商品',qty:1,jpy:100,twd:120}],totalTwd:120,deposit:120,domesticShip:0,intlShip:0,balance:0,paymentStatus:'未付款',paymentInfo:''},{id:'o2',customerName:'測試乙',items:[{name:'商品乙',qty:1,jpy:200,twd:240}],totalTwd:240,deposit:240,domesticShip:0,intlShip:0,balance:0,paymentStatus:'未付款',paymentInfo:''}]};}
function seed(f) { f.admin('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]}); }
class Storage {
 constructor(){this.map=new Map();}
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async list({prefix}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)));}
 async transaction(fn){const old=structuredClone(this.map);try{return await fn(this);}catch(e){this.map=old;throw e;}}
 async setAlarm(){}
}
function coordinator(writes='true') {
 const storage=new Storage(),c=new HeinaCoordinator({storage},{...env,HEINA_WRITES_ENABLED:writes});
 let live=new Workbook('test-sheet'),commits=0,loads=0;
 c.sheets={load:async()=>{loads++;return new Workbook('test-sheet',snapshot(live));},commit:async book=>{commits++;live=new Workbook('test-sheet',snapshot(book));}};
 const call=async(module,action,payload,token)=>{
  const response=await c.fetch(new Request('https://internal/api',{method:'POST',body:JSON.stringify({module,action,payload,adminToken:token})}));
  return {status:response.status,...await response.json()};
 };
 return {c,storage,call,get live(){return live;},get commits(){return commits;},get loads(){return loads;}};
}

test('anonymous admin actions are rejected before accessing Sheets',async()=>{const f=coordinator();assert.equal((await f.call('groupbuy','getAppData')).status,401);assert.equal(f.loads,0);});
test('login, session, password change invalidate the old token',()=>{const f=fixture();assert.equal(f.call('auth','session',{},f.token).ok,true);assert.equal(f.admin('auth','changePassword',{currentPassword:env.HEINA_ADMIN_PASSWORD,newPassword:'synthetic-new-test'}).ok,true);assert.throws(()=>f.admin('groupbuy','getAppData'),/登入/);assert.equal(f.call('auth','login',{password:'synthetic-new-test'}).ok,true);});
test('group data round-trips and stale or absent revisions fail',()=>{const f=fixture();seed(f);const data=f.admin('groupbuy','getAppData');assert.equal(data.groups[0].orders.length,2);assert.notEqual(data.dataRevision,'0');assert.throws(()=>f.admin('groupbuy','saveAppData',{groups:[]}),/版本/);assert.throws(()=>f.admin('groupbuy','saveAppData',{dataRevision:'0',groups:[]}),/更新/);assert.equal(f.admin('groupbuy','getAppData').groups[0].orders.length,2);});
test('customer lookup rejects wrong PIN and isolates customers',()=>{const f=fixture();seed(f);const bad=f.call('groupbuy','customerLookup',{customerName:'測試甲',lookupPin:'0000'});assert.equal(bad.matches.length,0);const good=f.call('groupbuy','customerLookup',{customerName:'測試甲',lookupPin:'8642'});assert.equal(good.matches.length,1);assert.ok(!JSON.stringify(good.matches).includes('測試乙'));});
test('payment reporting is idempotent and cannot select another customer order',()=>{const f=fixture();seed(f);const payload={customerName:'測試甲',lookupPin:'8642',remittanceDate:'2026-11-22',lastFive:'12345',totalAmount:120,orderIds:['o1'],clientRequestId:'synthetic-payment-1'};const bad=f.call('groupbuy','submitPaymentReport',{...payload,orderIds:['o2']});assert.equal(bad.ok,false);const first=f.call('groupbuy','submitPaymentReport',payload);assert.equal(first.ok,true);const repeat=f.call('groupbuy','submitPaymentReport',payload);assert.equal(repeat.duplicate,true);assert.equal(first.reportId,repeat.reportId);assert.equal(f.admin('groupbuy','getAppData').paymentReports.length,1);});
test('public catalog exposes only published product fields',()=>{const f=fixture();f.admin('storefront','publishCatalog',{products:[{id:'a',name:'公開商品',stockQty:2,status:'on_sale',warehouse:'private',cost:123},{id:'b',name:'未上架',stockQty:3,status:'hidden'}]});const result=f.call('storefront','getCatalog');assert.equal(result.products.length,1);assert.equal(result.products[0].warehouse,undefined);assert.equal(result.products[0].cost,undefined);});
test('ledger initial trip and transactions persist across business invocations',()=>{const f=fixture();const init=f.admin('ledger','getInitData',{clientId:'device-a'});assert.ok(init.currentTripId);f.admin('ledger','addTransaction',{clientId:'device-a',payload:{tripId:init.currentTripId,amount:50,type:'business',date:'2026-11-22'}});assert.equal(f.admin('ledger','getInitData',{clientId:'device-a'}).transactions.length,1);assert.equal(f.admin('ledger','getInitData',{clientId:'device-b'}).transactions.length,0);});
test('preorder and systemhub round-trip through the original schemas',()=>{const f=fixture();f.admin('preorder','save',[sampleGroup()]);assert.equal(f.admin('preorder','export')[0].orders.length,2);f.admin('systemhub','put',{category:'test',key:'a',value:{n:3},note:'test'});assert.deepEqual(f.admin('systemhub','get',{category:'test',key:'a'}).value,{n:3});});
test('range writes remain literal and preserve unrelated cells',()=>{const b=new Workbook('x',[{properties:{sheetId:0,title:'T'},values:[['keep','old'],['other',2]]}]);b.getSheetByName('T').getRange(1,2).setValue('=IMPORTXML("secret")');assert.equal(b.getSheetByName('T').getRange(1,1).getValue(),'keep');assert.equal(b.requests[0].updateCells.rows[0].values[0].userEnteredValue.stringValue,'=IMPORTXML("secret")');assert.equal(b.requests[0].updateCells.fields,'userEnteredValue');});
test('insert/delete row model and batch operations retain sequence',()=>{const b=new Workbook('x',[{properties:{sheetId:0,title:'T'},values:[['h'],['a'],['b']]}]);const s=b.getSheetByName('T');s.deleteRows(2,1);s.insertRows(2,1);s.getRange(2,1).setValue('new');assert.deepEqual(s.getDataRange().getValues(),[['h'],['new'],['b']]);assert.deepEqual(b.requests.map(r=>Object.keys(r)[0]),['deleteDimension','insertDimension','updateCells']);});
test('Google date serial preserves Taiwan calendar day',()=>{const d=serialDate(25569,'Asia/Taipei');assert.equal(d.toISOString(),'1969-12-31T16:00:00.000Z');});
test('unknown and prototype action names fail closed',()=>{for(const req of [{module:'__proto__',action:'x'},{module:'auth',action:'constructor'},{module:'test',action:'seed'}])assert.throws(()=>validateRequest(req));});
test('CORS rejects unapproved origins and GET cannot invoke mutations',async()=>{assert.equal((await worker.fetch(new Request('https://api/api',{method:'POST',headers:{Origin:'https://evil.example'}}),env)).status,403);assert.equal((await worker.fetch(new Request('https://api/api?payload=x'),env)).status,404);const pre=await worker.fetch(new Request('https://api/api',{method:'OPTIONS',headers:{Origin:'https://heinashop.com'}}),env);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),'https://heinashop.com');});
test('health reports missing setup without leaking credentials',async()=>{const response=await worker.fetch(new Request('https://api/health'),{});assert.equal(response.status,503);assert.ok(!(await response.text()).includes('synthetic'));});
test('read-only stage never commits even if business initialization prepares cells',async()=>{const f=coordinator('false');const login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});await f.call('groupbuy','getAppData',{},login.result.token);const ledger=await f.call('ledger','getInitData',{clientId:'a'},login.result.token);assert.equal(ledger.result.currentTripId,null);const save=await f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[]},login.result.token);assert.equal(save.status,403);assert.equal(f.commits,0);});
test('concurrent whole-group writes: one succeeds, stale one is rejected',async()=>{const f=coordinator();const login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});const token=login.result.token;const out=await Promise.all([f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]},token),f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[]},token)]);assert.equal(out.filter(r=>r.ok).length,1);assert.equal(f.commits,1);const data=await f.call('groupbuy','getAppData',{},token);assert.equal(data.result.groups.length,1);});
test('ambiguous commit is reconciled by the atomic marker, not replayed',async()=>{const f=coordinator();const login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});const token=login.result.token,commit=f.c.sheets.commit;f.c.sheets.commit=async book=>{await commit(book);throw new Error('lost network response');};assert.equal((await f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]},token)).ok,false);assert.ok(await f.storage.get('pendingCommit'));const read=await f.call('groupbuy','getAppData',{},token);assert.equal(read.result.groups.length,1);assert.equal(await f.storage.get('pendingCommit'),undefined);assert.equal(f.commits,1);});
test('unconfirmed failed write blocks subsequent writes, preserves existing rows',async()=>{const f=coordinator();const login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});const token=login.result.token;f.c.sheets.commit=async()=>{throw new Error('network unavailable');};await f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]},token);const retry=await f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]},token);assert.equal(retry.status,503);assert.equal(f.commits,0);});
test('Sheets OAuth JWT is signed, token is reused, and writes use one atomic batch',async()=>{const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});if(url.includes('oauth2')){const jwt=new URLSearchParams(options.body).get('assertion'),parts=jwt.split('.');assert.equal(createVerify('RSA-SHA256').update(parts[0]+'.'+parts[1]).verify(publicKey,Buffer.from(parts[2],'base64url')),true);return Response.json({access_token:'test-token',expires_in:3600});}assert.equal(options.headers.Authorization,'Bearer test-token');return Response.json(url.includes('batchUpdate')?{}:{sheets:[]});};const client=new GoogleSheets({...env,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})})},fetcher);const book=await client.load();book.insertSheet('T').appendRow(['literal']);await client.commit(book);assert.equal(calls.length,3);assert.ok(calls[2].url.endsWith(':batchUpdate'));assert.equal(JSON.parse(calls[2].options.body).requests.length,2);});

test('confirmed payment is booked once and remains confirmed after a duplicate review',()=>{
 const f=fixture();seed(f);
 const report=f.call('groupbuy','submitPaymentReport',{customerName:'測試甲',lookupPin:'8642',remittanceDate:'2026-11-22',lastFive:'12345',totalAmount:120,orderIds:['o1'],clientRequestId:'synthetic-review-payment'});
 const payload={reportId:report.reportId,remittanceBank:'測試銀行',operationId:'synthetic-review-1'};
 assert.equal(f.admin('groupbuy','confirmPaymentReport',payload).ok,true);
 assert.equal(f.admin('groupbuy','confirmPaymentReport',payload).ok,true);
 const data=f.admin('groupbuy','getAppData');assert.equal(data.bankJournal.length,1);assert.equal(data.paymentReports[0].status,'confirmed');
});
test('recovery requires admin, matching operation, elapsed delay and observed marker',async()=>{
 const f=coordinator();assert.equal((await f.call('auth','resolvePending',{})).status,401);
 const login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});const token=login.result.token;
 f.c.sheets.commit=async()=>{throw new Error('network unavailable');};
 await f.call('groupbuy','saveAppData',{dataRevision:'0',groups:[sampleGroup()]},token);
 const status=await f.call('auth','migrationStatus',{},token),id=status.result.pending.id;
 assert.equal(status.result.pending.props,undefined);
 assert.equal((await f.call('auth','resolvePending',{pendingId:id,confirmUncommitted:true,observedMarker:''},token)).status,409);
 const pending=await f.storage.get('pendingCommit');pending.at-=301000;await f.storage.put('pendingCommit',pending);
 assert.equal((await f.call('auth','resolvePending',{pendingId:id,confirmUncommitted:true,observedMarker:'wrong'},token)).status,409);
 assert.equal((await f.call('auth','resolvePending',{pendingId:id,confirmUncommitted:true,observedMarker:''},token)).result.committed,false);
 assert.equal(await f.storage.get('pendingCommit'),undefined);
});
test('coordinator persists ledger initialization across separate HTTP requests',async()=>{
 const f=coordinator(),login=await f.call('auth','login',{password:env.HEINA_ADMIN_PASSWORD});
 const a=await f.call('ledger','getInitData',{clientId:'a'},login.result.token);
 const b=await f.call('ledger','getInitData',{clientId:'a'},login.result.token);
 assert.ok(a.result.currentTripId);assert.equal(a.result.currentTripId,b.result.currentTripId);assert.equal(b.result.trips.length,1);
});
test('read cache is isolated and mutations always load fresh data',async()=>{
 let reads=0;const client=new GoogleSheets(env);client.request=async()=>{reads++;return {sheets:[{properties:{sheetId:0,title:'T'},data:[{rowData:[{values:[{effectiveValue:{stringValue:'original'}}]}]}]}]};};
 const a=await client.load({readOnly:true});a.getSheetByName('T').getRange(1,1).setValue('local-only');
 const b=await client.load({readOnly:true});assert.equal(b.getSheetByName('T').getRange(1,1).getValue(),'original');assert.equal(reads,1);
 await client.load();assert.equal(reads,2);
});
