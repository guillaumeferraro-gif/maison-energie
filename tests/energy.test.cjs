const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('../dist/energy-core.js');
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('Shelly: two channels, real zeroes, explicit invalid values, EM1 and Switch',()=>{
  assert.equal(E.meter({emeters:[{power:1900},{power:0}]},1),0);
  assert.equal(E.meter({emeters:[{power:999,is_valid:false}]},0),null);
  assert.equal(E.meter({meters:[{power:0}]},0),0);
  assert.equal(E.meter({'em1:1':{act_power:1700}},1),1700);
  assert.equal(E.meter({'switch:0':{apower:800}},0),800);
  assert.equal(E.meter({'em1:1':{act_power:1700,errors:['power_meter_failure']}},1),null);
  assert.equal(E.meter({'em1:1':{act_power:null}},1),null);
  assert.equal(E.meter({},0),null);
});
test('Energy balances preserve signed network measurements without double counting devices',()=>{
  assert.deepEqual(E.flows(3840,1760,'load'),{solar:3840,home:1760,import:0,export:2080,self:1760});
  assert.deepEqual(E.flows(3840,-2080,'grid'),E.flows(3840,1760,'load'));
  assert.deepEqual(E.flows(0,1100,'grid'),{solar:0,home:1100,import:1100,export:0,self:0});
  assert.equal(E.flows(100,-500,'grid').home,null);
  assert.equal(E.flows(-100,500,'load').solar,null);
  assert.equal(E.flows(null,500,'load').home,500);
  assert.equal(E.flows(500,null,'load').solar,500);
  assert.equal(E.flows(null,500,'grid').home,null);
  assert.equal(E.flows(0,0,'load').home,0);
});
test('Minute integration divides a changing signal across the boundary and does not fill outages',()=>{
  const byMinute={};const add=(t,i,w,s)=>{const r=byMinute[t]||(byMinute[t]={wh:Array(7).fill(0),seconds:Array(7).fill(0)});r.wh[i]+=w;r.seconds[i]+=s;};
  E.integrate({t:55000,values:[0,null,0]},{t:65000,values:[3600,null,0]},add);
  approx(byMinute[0].wh[0],1.25);approx(byMinute[60000].wh[0],3.75);
  approx(byMinute[0].seconds[0],5);assert.equal(byMinute[0].seconds[1],0);assert.equal(byMinute[0].seconds[2],5);
  E.integrate({t:65000,values:[3600]},{t:100000,values:[3600]},add);
  approx(byMinute[60000].wh[0],3.75);
});
test('Paris calendar: 23 / 25 hours, leap day and repeated hour have distinct minute buckets',()=>{
  assert.equal(E.buckets('2026-03-29','hour').length,23);
  assert.equal(E.buckets('2026-10-25','hour').length,25);
  assert.equal(E.buckets('2028-02-15','day').length,29);
  const fall=E.buckets('2026-10-25','hour');assert.notEqual(fall[2].key,fall[3].key);
  assert.equal(E.buckets('2026-10-25','minute',24).length,60);
  assert.equal(E.parts(E.midnight('2026-09-11')).date,'2026-09-11');
});

function gas(){
  const Utilities={formatDate(d,zone,format){
    const p=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
    const x=k=>p.find(z=>z.type===k).value;
    return format.replace(/'T'/g,'T').replace(/yyyy/g,x('year')).replace(/MM/g,x('month')).replace(/dd/g,x('day')).replace(/HH/g,x('hour')).replace(/mm/g,x('minute')).replace(/ss/g,x('second'));
  }};
  const context=vm.createContext({Utilities,console,SpreadsheetApp:{flush(){}},Date,Set,Map,Math,Number});
  vm.runInContext(fs.readFileSync(require.resolve('../integration/Google-Apps-Script.gs'),'utf8'),context);
  return context;
}
class Sheet{
  constructor(name,rows=[]){this.name=name;this.data=[Array(15).fill('header'),...rows];}
  getName(){return this.name;}getLastRow(){return this.data.length;}getMaxRows(){return Math.max(1000,this.data.length);}insertRowsAfter(){}
  getRange(row,col,n=1,m=1){return {getValues:()=>this.data.slice(row-1,row-1+n).map(r=>r.slice(col-1,col-1+m)),setValues:rows=>{rows.forEach((r,i)=>this.data[row-1+i]=r);}};}
}
test('Apps Script: ingest retries and duplicate rows create one minute only',()=>{
  const g=gas(),t=Math.floor(Date.now()/60000)*60000-60000,name='m'+g.Utilities.formatDate(new Date(t),'UTC','yyyyMMdd'),s=new Sheet(name),db={getSheetByName:()=>s};
  const row={t,wh:[1,2,3,4,5,6,7],seconds:[60,60,0,60,60,60,60]},batch={batch:'test-batch',rows:[row,row]};
  assert.equal(g.ingest_(db,batch).added,1);assert.equal(g.ingest_(db,batch).added,0);assert.equal(s.data.length,2);assert.equal(s.data[1][3],0);
  assert.throws(()=>g.rowFromPayload_({...row,seconds:[61,60,60,60,60,60,60]},Date.now()));
});
test('Apps Script archive read does not double count a flushed archive awaiting source deletion',()=>{
  const g=gas(),t=E.midnight('2026-09-11'),row=(t,wh,s)=>[t,...Array(7).fill(wh),...Array(7).fill(s)];
  const minute=new Sheet('m20260910',[row(t,100,60)]),q=new Sheet('q2026',[row(t,200,900)]),daily=new Sheet('jours',[row(t,800,86400)]);
  const db={getSheets:()=>[minute,q,daily],getSheetByName:n=>[minute,q,daily].find(s=>s.name===n)};
  const r=g.history_(db,{from:t,to:t+86400000,granularity:'day'});assert.equal(r.bars.length,1);assert.equal(r.bars[0].wh[0],800);
  const hour=g.history_(db,{from:t,to:t+86400000,granularity:'hour'});assert.equal(hour.bars[0].wh[0],200);
  const min=g.history_(db,{from:t,to:t+3600000,granularity:'minute'});assert.equal(min.bars[0].wh[0],100);
});
test('Apps Script aggregation agrees with client buckets across UTC year and French day boundary',()=>{
  const g=gas(),times=['2026-12-31T22:45:00Z','2026-12-31T23:00:00Z','2027-01-01T00:00:00Z'].map(Date.parse);
  for(const t of times)for(const p of ['minute','quarter','hour','day','month','year'])assert.equal(g.bucket_(t,p),E.key(t,p));
  for(const d of ['2026-03-29','2026-10-25','2027-01-01'])assert.equal(g.midnight_(d),E.midnight(d));
  const rs=times.map(t=>[t,...Array(7).fill(10),...Array(7).fill(900)]),bins=g.fold_(rs,'day');assert.equal(bins.length,2);assert.equal(bins[1].wh[0],20);
});
test('Actual Shelly collector handles zero, missing data and minute integration consistently',()=>{
  const c=vm.createContext({console,print(){},Math,JSON,Date,Infinity,Shelly:{getComponentStatus(){return {unixtime:1};}},Timer:{set(){throw Error('Default unconfigured collector must stay stopped');}}});
  vm.runInContext(fs.readFileSync(require.resolve('../integration/collecteur-shelly.js'),'utf8'),c);
  assert.equal(c.readPower({emeters:[{power:0}]},0),0);
  c.integrate({t:55000,values:[0,null,0,null,null,null,null]});c.integrate({t:65000,values:[3600,null,0,null,null,null,null]});
  const state=JSON.parse(vm.runInContext('JSON.stringify({queue:queue,current:current})',c));
  approx(state.queue[0].wh[0],1.25);approx(state.current.wh[0],3.75);assert.equal(state.current.seconds[1],0);
});
