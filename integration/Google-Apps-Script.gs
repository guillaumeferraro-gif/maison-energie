/** Maison Energie — bound to a NEW Google Sheet. Runtime V8.
 * Run initialiser() once, deploy as web app (execute as yourself, anyone).
 * Only numeric energy data; separate bearer tokens for reading and ingestion.
 * Archive maintenance is idempotent; raw data is deleted only after archive flush.
 */
const ZONE = 'Europe/Paris';
const DAY = 86400000;
const METRIC_NAMES = ['solaire','maison','piscine','pac','chauffe_eau','achat','injection'];
const HEADERS = ['minute_utc_ms',...METRIC_NAMES.map(x=>x+'_Wh'),...METRIC_NAMES.map(x=>x+'_secondes')];

function initialiser() {
  const p = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Ouvrez ce script depuis Extensions > Apps Script dans un nouveau Google Sheet.');
  if (!p.getProperty('SPREADSHEET_ID')) p.setProperty('SPREADSHEET_ID',active.getId());
  for (const k of ['READ_TOKEN','WRITE_TOKEN']) if (!p.getProperty(k)) p.setProperty(k,Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''));
  active.setSpreadsheetTimeZone(ZONE);
  if (!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='maintenance')) ScriptApp.newTrigger('maintenance').timeBased().everyHours(1).create();
  // Keys are in Project settings > Script properties; do not publish or log them.
  console.log('Initialisé. Copiez READ_TOKEN et WRITE_TOKEN depuis les propriétés du script.');
}
function db_() {
  const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if(!id)throw new Error('Lancez initialiser() dans Apps Script.');
  return SpreadsheetApp.openById(id);
}
function json_(v) {return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function doGet() {return json_({ok:true,service:'Maison Energie',message:'API POST authentifiée. Aucune mesure publique.'});}
function doPost(e) {
  let lock;
  try {
    if(!e||!e.postData||e.postData.contents.length>32000)throw new Error('Requête invalide.');
    const b=JSON.parse(e.postData.contents),prop=PropertiesService.getScriptProperties();
    if(!['ingest','history'].includes(b.action))throw new Error('Action inconnue.');
    const expected=prop.getProperty(b.action==='ingest'?'WRITE_TOKEN':'READ_TOKEN');
    if(!expected||typeof b.token!=='string'||b.token!==expected)throw new Error('Clé incorrecte.');
    lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw new Error('Collecte occupée, réessayez.');
    return json_(b.action==='ingest'?ingest_(db_(),b):history_(db_(),b));
  } catch(err) {return json_({ok:false,error:err.message});}
  finally {if(lock&&lock.hasLock())lock.releaseLock();}
}
function sheet_(db,name) {
  let s=db.getSheetByName(name);
  if(!s){s=db.insertSheet(name);s.getRange(1,1,1,15).setValues([HEADERS]);s.setFrozenRows(1);s.getRange(1,1,1,15).setFontWeight('bold').setBackground('#dcefe7');if(s.getMaxColumns()>15)s.deleteColumns(16,s.getMaxColumns()-15);}
  return s;
}
function rows_(s) {return s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,15).getValues():[];}
function append_(s,rows) {
  if(!rows.length)return;
  const end=s.getLastRow()+rows.length;if(end>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),end-s.getMaxRows());
  s.getRange(s.getLastRow()+1,1,rows.length,15).setValues(rows);
}
function uniqueAppend_(s,rows) {
  const last=s.getLastRow(),seen=new Set(last>1?s.getRange(2,1,last-1,1).getValues().map(r=>Number(r[0])):[]);
  const fresh=rows.filter(r=>{if(seen.has(r[0]))return false;seen.add(r[0]);return true;});append_(s,fresh);return fresh.length;
}
function rowFromPayload_(r,now) {
  if(!r||!Number.isSafeInteger(r.t)||r.t%60000!==0||r.t>now+120000||r.t<now-2*DAY||!Array.isArray(r.wh)||!Array.isArray(r.seconds)||r.wh.length!==7||r.seconds.length!==7)throw new Error('Minute invalide ou trop ancienne.');
  const energy=[],coverage=[];
  for(let i=0;i<7;i++){
    const w=r.wh[i],s=r.seconds[i];
    if(typeof s!=='number'||!Number.isFinite(s)||s<0||s>60.01||typeof w!=='number'||!Number.isFinite(w)||w<0||w>20000)throw new Error('Valeur ou durée de mesure invalide.');
    energy.push(s?Math.round(w*1000000)/1000000:0);coverage.push(Math.min(60,s));
  }
  return [r.t,...energy,...coverage];
}
function ingest_(db,b) {
  if(typeof b.batch!=='string'||b.batch.length>100||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>10)throw new Error('Lot invalide (1 à 10 minutes).');
  const groups={},now=Date.now();
  for(const input of b.rows){const r=rowFromPayload_(input,now),name='m'+Utilities.formatDate(new Date(r[0]),'UTC','yyyyMMdd');(groups[name]||(groups[name]=[])).push(r);}
  let added=0;for(const name of Object.keys(groups))added+=uniqueAppend_(sheet_(db,name),groups[name].sort((a,b)=>a[0]-b[0]));
  SpreadsheetApp.flush();return {ok:true,batch:b.batch,added};
}
function dateKey_(t) {return Utilities.formatDate(new Date(t),ZONE,'yyyy-MM-dd');}
function midnight_(key) {
  const target=Date.parse(key+'T00:00:00Z');let t=target;
  for(let i=0;i<3;i++){const local=Utilities.formatDate(new Date(t),ZONE,"yyyy-MM-dd'T'HH:mm:ss");t+=target-Date.parse(local+'Z');}return t;
}
function bucket_(t,g) {
  if(g==='minute'||g==='quarter'||g==='hour'){const step={minute:60000,quarter:900000,hour:3600000}[g];return String(Math.floor(t/step)*step);}
  return Utilities.formatDate(new Date(t),ZONE,g==='day'?'yyyy-MM-dd':g==='month'?'yyyy-MM':'yyyy');
}
function fold_(rows,g) {
  const bins=new Map();
  for(const r of rows){const key=bucket_(r[0],g);if(!bins.has(key))bins.set(key,{key,t:r[0],wh:Array(7).fill(0),seconds:Array(7).fill(0)});const b=bins.get(key);b.t=Math.min(b.t,r[0]);
    for(let i=0;i<7;i++)if(typeof r[8+i]==='number'&&r[8+i]>0&&typeof r[1+i]==='number'&&Number.isFinite(r[1+i])){b.wh[i]+=r[1+i];b.seconds[i]+=r[8+i];}
  }
  return [...bins.values()].sort((a,b)=>a.t-b.t);
}
function history_(db,b) {
  const {from,to,granularity:g}=b,now=Date.now();
  if(!['minute','quarter','hour','day','month','year'].includes(g)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<=from||to-from>6*366*DAY)throw new Error('Période invalide.');
  const maxSpan={minute:2/24,quarter:2,hour:2,day:32,month:367,year:6*366}[g]*DAY;
  if(to-from>maxSpan)throw new Error('La période est trop grande pour cette précision.');
  const names=db.getSheets().map(s=>s.getName()),minutes=[],quarters=[],daily=[];
  for(const name of names){
    if(/^m\d{8}$/.test(name)){
      const day=Date.parse(name.slice(1,5)+'-'+name.slice(5,7)+'-'+name.slice(7,9)+'T00:00:00Z');
      if(day>=to||day+DAY<=from)continue;
    }else if(/^q\d{4}$/.test(name)){
      if(g==='minute')continue;
      const year=+name.slice(1);if(Date.UTC(year,0,1)>=to||Date.UTC(year+1,0,1)<=from)continue;
    }else if(name==='jours'){if(['minute','quarter','hour'].includes(g))continue;}
    else continue;
    for(const r of rows_(db.getSheetByName(name)))if(typeof r[0]==='number'&&r[0]>=from&&r[0]<to)(name==='jours'?daily:name[0]==='q'?quarters:minutes).push(r);
  }
  // Prefer a complete archive if maintenance failed after flush but before deleting its source.
  const days=new Set(daily.map(r=>dateKey_(r[0]))),qs=new Set(quarters.map(r=>bucket_(r[0],'quarter')));
  const all=[...daily,...quarters.filter(r=>!days.has(dateKey_(r[0]))),...minutes.filter(r=>!days.has(dateKey_(r[0]))&&!qs.has(bucket_(r[0],'quarter')))];
  const bars=fold_(all,g).map(b=>({...b,wh:b.wh.map((v,i)=>b.seconds[i]?v:null)}));
  let notice='Google Sheets · heure de Paris';
  if(g==='minute'&&from<now-30*DAY)notice='Les détails minute sont conservés 30 jours. Utilisez 15 min, Heure ou Jour pour une période plus ancienne.';
  else if(['quarter','hour'].includes(g)&&from<now-730*DAY)notice='Les détails de 15 min et d’une heure sont conservés deux ans. Utilisez Jour, Mois ou Année.';
  return {ok:true,bars,notice};
}
function maintenance() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try {
    const db=db_(),now=Date.now();let processed=0;
    // Minute partitions are UTC days. Keep at least 30 days of minute detail.
    for(const s of db.getSheets().filter(s=>/^m\d{8}$/.test(s.getName())).sort((a,b)=>a.getName().localeCompare(b.getName()))){
      const n=s.getName(),start=Date.parse(n.slice(1,5)+'-'+n.slice(5,7)+'-'+n.slice(7,9)+'T00:00:00Z');
      if(start+DAY>=now-30*DAY||processed>=4)continue;
      const grouped={};for(const b of fold_(rows_(s),'quarter')){const t=Number(b.key),name='q'+new Date(t).getUTCFullYear();(grouped[name]||(grouped[name]=[])).push([t,...b.wh,...b.seconds]);}
      for(const name of Object.keys(grouped))uniqueAppend_(sheet_(db,name),grouped[name]);
      SpreadsheetApp.flush();db.deleteSheet(s);processed++;
    }
    // All expired quarter partitions are read together before archiving Paris calendar days.
    // A complete daily archive is flushed before any source is removed; retries skip existing day IDs.
    const cutoff=midnight_(dateKey_(now-730*DAY)),expired=[],partitions=[];
    for(const s of db.getSheets().filter(s=>/^q\d{4}$/.test(s.getName()))){const data=rows_(s),old=data.filter(r=>r[0]<cutoff);if(old.length){for(const r of old)expired.push(r);partitions.push({s,data});}}
    if(expired.length){
      const daily=fold_(expired,'day').map(b=>[midnight_(b.key),...b.wh,...b.seconds]);uniqueAppend_(sheet_(db,'jours'),daily);SpreadsheetApp.flush();
      for(const part of partitions){
        if(part.data.every(r=>r[0]<cutoff)){db.deleteSheet(part.s);continue;}
        const groups=[];let start=null,count=0;
        part.data.forEach((r,i)=>{if(r[0]<cutoff){if(start===null)start=i+2;count++;}else if(start!==null){groups.push([start,count]);start=null;count=0;}});
        if(start!==null)groups.push([start,count]);
        // Delete only rows already archived, bottom-up. Never clear retained measurements.
        groups.reverse().forEach(([row,n])=>part.s.deleteRows(row,n));
      }
    }
  }finally{lock.releaseLock();}
}
