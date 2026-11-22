import { createPrivateKey, createSign } from 'node:crypto';
import { Workbook } from './sheets-model.mjs';
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets/';
const TOKEN='https://oauth2.googleapis.com/token';
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
export class GoogleSheets {
  constructor(env, fetcher=fetch) { this.env=env;this.fetcher=fetcher;this.token=null; }
  async accessToken() {
    if(this.token&&this.token.expires>Date.now()+60000) return this.token.value;
    const credentials=JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON||'{}');
    if(!credentials.client_email||!credentials.private_key) throw new Error('尚未設定 Google 服務帳號');
    const now=Math.floor(Date.now()/1000);
    const input=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:TOKEN,iat:now,exp:now+3600});
    const signature=createSign('RSA-SHA256').update(input).sign(createPrivateKey(credentials.private_key)).toString('base64url');
    const res=await this.fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature}),signal:AbortSignal.timeout(20000)});
    if(!res.ok) throw new Error('Google 服務帳號授權失敗，請檢查私鑰與 API 設定');
    const data=await res.json(); if(!data.access_token) throw new Error('Google 授權回應無效');
    this.token={value:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};return this.token.value;
  }
  async request(suffix, body) {
    const token=await this.accessToken();
    const res=await this.fetcher(SHEETS+encodeURIComponent(this.env.HEINA_SPREADSHEET_ID)+suffix,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
    if(!res.ok) throw new Error('Google Sheets API 失敗（HTTP '+res.status+'）；請核對授權、配額及試算表設定');
    return res.json();
  }
  async load({readOnly=false}={}) {
    if(readOnly && this.snapshot && this.snapshot.at > Date.now()-3000) return new Workbook(this.env.HEINA_SPREADSHEET_ID,structuredClone(this.snapshot.sheets));
    const fields='sheets(properties,data(startRow,startColumn,rowData(values(effectiveValue,effectiveFormat/numberFormat)))),properties/timeZone';
    const data=await this.request('?includeGridData=true&fields='+encodeURIComponent(fields));
    const timeZone=data.properties?.timeZone||'Asia/Taipei';
    const sheets=(data.sheets||[]).map(s=>{
      if(s.properties.sheetType&&s.properties.sheetType!=='GRID') throw new Error('目前後端僅支援一般格線工作表');
      const values=[];
      for(const block of s.data||[]) for(let r=0;r<(block.rowData||[]).length;r++) {
        const row=values[(block.startRow||0)+r] ||= [];
        for(let c=0;c<(block.rowData[r].values||[]).length;c++) {
          const cell=block.rowData[r].values[c],v=cell.effectiveValue||{};
          let value=v.stringValue??v.numberValue??v.boolValue??'';
          if(v.errorValue) value=v.errorValue.message||'#ERROR!';
          if(typeof value==='number'&&['DATE','DATE_TIME'].includes(cell.effectiveFormat?.numberFormat?.type)) value=serialDate(value,timeZone);
          row[(block.startColumn||0)+c]=value;
        }
      }
      return {properties:s.properties,values};
    });
    this.snapshot={at:Date.now(),sheets:structuredClone(sheets)};
    return new Workbook(this.env.HEINA_SPREADSHEET_ID,sheets);
  }
  async commit(book) {
    if(!book.requests.length) return;
    this.snapshot=null;
    const body={requests:book.requests};
    if(Buffer.byteLength(JSON.stringify(body))>8000000) throw new Error('單次寫入超過 8MB，請分批儲存');
    // One atomic batch. Never automatically retry a write after an ambiguous network failure.
    await this.request(':batchUpdate',body);
  }
}
export function serialDate(serial,timeZone) {
  const wall=new Date(Math.round((serial-25569)*86400000));
  let instant=wall.getTime();
  for(let i=0;i<2;i++) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
    const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    instant+=wall.getTime()-represented;
  }
  return new Date(instant);
}
