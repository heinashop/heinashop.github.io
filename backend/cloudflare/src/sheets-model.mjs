import { createHash, randomUUID } from 'node:crypto';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const present = v => v !== '' && v !== null && v !== undefined;
function cellValue(v) {
  if (v === '' || v == null) return {};
  if (v instanceof Date) return { stringValue: v.toISOString() };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('數值無效');
    return { numberValue: v };
  }
  if (String(v).length > 50000) throw new Error('單一儲存格超過 50000 字元');
  // Store text literally, including strings beginning with '='. No formula injection.
  return { stringValue: String(v) };
}
function col(s) { return [...s].reduce((n,c) => n*26+c.charCodeAt(0)-64,0); }
class Range {
  constructor(sheet, row, column, rows=1, columns=1) {
    if (typeof row === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(row);
      if (!m) throw new Error('不支援的儲存格範圍');
      column=col(m[1]); row=Number(m[2]); rows=Number(m[4]||m[2])-row+1; columns=col(m[3]||m[1])-column+1;
    }
    if (![row,column,rows,columns].every(n=>Number.isInteger(n)&&n>0)) throw new Error('儲存格範圍無效');
    if (rows*columns > 1000000) throw new Error('單次讀寫範圍過大');
    Object.assign(this,{sheet,row,column,rows,columns});
  }
  grid() { return {sheetId:this.sheet.id,startRowIndex:this.row-1,endRowIndex:this.row-1+this.rows,startColumnIndex:this.column-1,endColumnIndex:this.column-1+this.columns}; }
  getValues() { return Array.from({length:this.rows},(_,r)=>Array.from({length:this.columns},(_,c)=>this.sheet.data[this.row-1+r]?.[this.column-1+c]??'')); }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setValues(values) {
    if (values.length!==this.rows || values.some(r=>r.length!==this.columns)) throw new Error('寫入資料與範圍大小不符');
    const cells=values.map(row=>({values:row.map(v=>({userEnteredValue:cellValue(v)}))}));
    if (JSON.stringify(values)===JSON.stringify(this.getValues())) return this;
    this.sheet.ensure(this.row-1+this.rows,this.column-1+this.columns);
    for(let r=0;r<this.rows;r++) {
      const row=this.sheet.data[this.row-1+r] ||= [];
      for(let c=0;c<this.columns;c++) row[this.column-1+c]=values[r][c]??'';
    }
    this.sheet.book.requests.push({updateCells:{range:this.grid(),rows:cells,fields:'userEnteredValue'}});
    return this;
  }
  clearContent() { return this.setValues(Array.from({length:this.rows},()=>Array(this.columns).fill(''))); }
  setNumberFormat(pattern) {
    if (pattern!=='@') throw new Error('不支援的數值格式');
    this.sheet.ensure(this.row-1+this.rows,this.column-1+this.columns);
    this.sheet.book.requests.push({repeatCell:{range:this.grid(),cell:{userEnteredFormat:{numberFormat:{type:'TEXT',pattern:'@'}}},fields:'userEnteredFormat.numberFormat'}});
    return this;
  }
  setFontWeight(weight) {
    this.sheet.ensure(this.row-1+this.rows,this.column-1+this.columns);
    this.sheet.book.requests.push({repeatCell:{range:this.grid(),cell:{userEnteredFormat:{textFormat:{bold:weight==='bold'}}},fields:'userEnteredFormat.textFormat.bold'}});
    return this;
  }
}
class Sheet {
  constructor(book, properties, data=[]) {
    this.book=book; this.id=properties.sheetId; this.name=properties.title;
    this.rows=properties.gridProperties?.rowCount||1000; this.columns=properties.gridProperties?.columnCount||26;
    this.data=data;
  }
  getName() { return this.name; }
  getLastRow() { for(let r=this.data.length-1;r>=0;r--) if(this.data[r]?.some(present)) return r+1; return 0; }
  getLastColumn() { let n=0; for(const row of this.data) if(row) for(let c=row.length-1;c>=n;c--) if(present(row[c])) {n=c+1;break;} return n; }
  getRange(...args) { return new Range(this,...args); }
  getDataRange() { return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn())); }
  ensure(rows, columns) {
    for (const [key,wanted,dimension] of [['rows',rows,'ROWS'],['columns',columns,'COLUMNS']]) {
      if (wanted>this[key]) { this.book.requests.push({appendDimension:{sheetId:this.id,dimension,length:wanted-this[key]}}); this[key]=wanted; }
    }
  }
  appendRow(row) { this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]); return this; }
  setFrozenRows(n) { this.book.requests.push({updateSheetProperties:{properties:{sheetId:this.id,gridProperties:{frozenRowCount:n}},fields:'gridProperties.frozenRowCount'}}); return this; }
  setName(name) {
    if(this.book.getSheetByName(name)) throw new Error('工作表名稱已存在');
    this.book.requests.push({updateSheetProperties:{properties:{sheetId:this.id,title:name},fields:'title'}}); this.name=name; return this;
  }
  deleteRow(row) { return this.deleteRows(row,1); }
  deleteRows(row,count) {
    if(!Number.isInteger(row)||!Number.isInteger(count)||row<1||count<1||row+count-1>this.rows||count===this.rows) throw new Error('刪除列範圍無效');
    this.book.requests.push({deleteDimension:{range:{sheetId:this.id,dimension:'ROWS',startIndex:row-1,endIndex:row-1+count}}});
    this.data.splice(row-1,count); this.rows-=count; return this;
  }
  insertRows(row,count) {
    if(!Number.isInteger(row)||!Number.isInteger(count)||row<1||count<1||row>this.rows+1) throw new Error('插入列範圍無效');
    if(row===this.rows+1) this.book.requests.push({appendDimension:{sheetId:this.id,dimension:'ROWS',length:count}});
    else this.book.requests.push({insertDimension:{range:{sheetId:this.id,dimension:'ROWS',startIndex:row-1,endIndex:row-1+count},inheritFromBefore:row>1}});
    while(this.data.length<row-1) this.data.push([]);
    this.data.splice(row-1,0,...Array.from({length:count},()=>[])); this.rows+=count; return this;
  }
}
export class Workbook {
  constructor(id, sheets=[]) { this.id=id; this.requests=[]; this.sheets=sheets.map(s=>new Sheet(this,s.properties,s.values||[])); }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/'+this.id+'/edit'; }
  getName() { return 'Heina'; }
  getSheetByName(name) { return this.sheets.find(s=>s.name===name)||null; }
  insertSheet(name) {
    if(this.getSheetByName(name)) throw new Error('工作表名稱已存在');
    const id=Math.max(0,...this.sheets.map(s=>s.id))+1;
    const properties={sheetId:id,title:name,gridProperties:{rowCount:1000,columnCount:26}};
    this.requests.push({addSheet:{properties}});
    const sheet=new Sheet(this,properties); this.sheets.push(sheet); return sheet;
  }
}
export function createServices(book,state,env) {
  state.props ||= {}; state.cache ||= {};
  const props={
    getProperty(k) { if(own(state.props,k)) return state.props[k]; return env[k] == null ? null : String(env[k]); },
    setProperty(k,v) { state.props[k]=String(v); return props; },
    deleteProperty(k) { state.props[k]=null; return props; },
  };
  const transient={};
  const persistent=k=>k.startsWith('heina_auth_')||k==='heina_admin_fail';
  const cache={
    get(k) { const x=(persistent(k)?state.cache:transient)[k]; return x&&x.expires>Date.now()?x.value:null; },
    put(k,v,ttl=600) { (persistent(k)?state.cache:transient)[k]={value:String(v),expires:Date.now()+ttl*1000}; },
    remove(k) { delete (persistent(k)?state.cache:transient)[k]; },
  };
  for(const [k,v] of Object.entries(state.cache)) if(v.expires<=Date.now()) delete state.cache[k];
  const spreadsheet={getActive:()=>book,getActiveSpreadsheet:()=>book,flush:()=>{},openById:id=>{if(id!==book.id)throw new Error('拒絕存取未授權試算表');return book;}};
  return {
    writesEnabled:env.HEINA_WRITES_ENABLED==='true', SpreadsheetApp:spreadsheet, PropertiesService:{getScriptProperties:()=>props}, CacheService:{getScriptCache:()=>cache},
    // Requests are serialized by the owning Durable Object until the atomic Sheets batch completes.
    LockService:{getDocumentLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    Session:{getScriptTimeZone:()=> 'Asia/Taipei'},
    Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>[...createHash(algorithm).update(String(value)).digest()],
      formatDate:(date,timeZone,pattern)=>{
        if(pattern!=='yyyy-MM-dd') throw new Error('不支援的日期格式');
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
        const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
      },
      sleep:()=>{throw new Error('操作尚在處理，請重新載入後再試');},
    },
  };
}
