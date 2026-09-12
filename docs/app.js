/* Maison Énergie — no credentials or measurements are bundled with this app. */
(()=>{
'use strict';
const E=window.Energy,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const labels={solar:'Photovoltaïque',home:'Maison',pool:'Piscine',heatpump:'Pompe à chaleur',waterheater:'Chauffe-eau'};
const defaults={mode:'demo',topology:'unknown',confirmed:false,relayConfirmed:false,sheetsUrl:'',readToken:'',meters:[{key:'solar',ip:'192.168.1.15',gen:'auto',channel:0,invert:false},{key:'home',ip:'192.168.1.11',gen:'auto',channel:0,invert:false},{key:'pool',ip:'192.168.1.11',gen:'auto',channel:1,invert:false},{key:'heatpump',ip:'192.168.1.17',gen:'auto',channel:0,invert:false},{key:'waterheater',ip:'192.168.1.17',gen:'auto',channel:1,invert:false}],relays:[{key:'gate',ip:'192.168.1.114',gen:'auto',channel:0,seconds:.5},{key:'garage',ip:'192.168.1.10',gen:'auto',channel:0,seconds:1}]};
let cfg=structuredClone(defaults);try{const saved=JSON.parse(localStorage.getItem('maison-energy-v1'));if(saved&&Array.isArray(saved.meters)&&saved.meters.length===5&&Array.isArray(saved.relays)&&saved.relays.length===2)cfg={...cfg,...saved};}catch{}
cfg=HomeAccess.migrate(cfg);
let mode=cfg.mode==='live'?'live':'demo',granularity='hour',metric='home',date=E.parts(Date.now()).date,hour=12,live={},lastRead=0,busy=false,historyRequest=0,currentBars=[],fetchGeneration=0;
let proxyToken=null;
const genCache=new Map(),fmt=(n,d=1)=>n.toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){try{localStorage.setItem('maison-energy-v1',JSON.stringify({...cfg,mode}));}catch{toast('Les réglages ne peuvent pas être mémorisés dans ce navigateur.');}}
function power(n,html=true){if(!E.finite(n))return '—';return n>=1000?fmt(n/1000,2)+(html?' <small>kW</small>':' kW'):fmt(n,0)+(html?' <small>W</small>':' W');}
function energy(n){return E.finite(n)?fmt(n/1000,n<1000?3:2)+' <small>kWh</small>':'—';}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6000);}
function isLocal(){return location.protocol!=='https:';}
function validIP(ip){return /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(ip)&&ip.split('.').every(x=>+x<=255);}
function renderMode(){
  $('#mode-badge').textContent=mode==='demo'?'Démonstration':'Direct local';$('#mode-badge').classList.toggle('connected',mode==='live');
  $('#mode-banner').classList.toggle('error-banner',mode==='live'&&(!isLocal()||!cfg.confirmed));
  $('#mode-banner').innerHTML=mode==='demo'?'<span><b>Vous explorez une démonstration.</b> Les valeurs sont simulées.</span><button data-settings>Connecter mes Shelly ↗</button>':!isLocal()?'<span><b>Les IP de la maison sont locales.</b> Pour le direct, ouvrez l’interface HTML téléchargée sur votre Wi-Fi. L’historique Google reste accessible ici.</span><button id="local-download">Télécharger le HTML ↗</button>':'<span><b>Lecture locale des Shelly.</b> Actualisation toutes les 2 secondes. L’historique se configure dans les réglages.</span><button data-settings>Réglages ↗</button>';
  $('#live-label').textContent=mode==='demo'?'SIMULATION':'DIRECT';
  access.render();
}
function demoNow(){const v=Math.sin(Date.now()/9500)*70;return {solar:3840+v,home:1760+v*.45,pool:3,heatpump:1110+v*.35,waterheater:0};}
function paintLive(values,ok=true){
  const f=E.flows(values.solar,values.home,mode==='demo'?'load':cfg.topology);live={...values,...f};
  $('#home-power').innerHTML=power(f.home);$('#solar-power').innerHTML=power(f.solar);
  const exporting=E.finite(f.export)&&f.export>1;$('#grid-title').textContent=exporting?'Surplus vers le réseau':'Prélèvement réseau';$('#grid-power').innerHTML=power(exporting?f.export:f.import);
  $('#home-foot').textContent=E.finite(f.home)?'Puissance instantanée · appareils inclus':'Mesure indisponible ou configuration à vérifier';$('#solar-foot').textContent=E.finite(f.solar)?'Panneaux photovoltaïques':'Mesure indisponible';$('#grid-foot').textContent=E.finite(f.import)?exporting?'Votre surplus est injecté sur le réseau':'Électricité prélevée sur le réseau':'Flux en attente de mesures valides';
  $('#flow-solar').textContent=power(f.solar,false);$('#flow-home').textContent=power(f.home,false);$('#flow-grid').textContent=power(exporting?f.export:f.import,false);
  const cover=E.finite(f.home)&&f.home>0?Math.min(100,f.self/f.home*100):null;
  $('#autonomy').textContent=cover===null?'—':fmt(cover,0)+' %';$('#gauge').style.setProperty('--coverage',(cover??0)+'%');$('#self-power').textContent=power(f.self,false);$('#import-power').textContent=power(f.import,false);
  $('#solar-caption').textContent=E.finite(f.solar)?'Solaire → maison':'Mesure indisponible';$('#grid-caption').textContent=E.finite(f.import)?exporting?'Maison → réseau':'Réseau → maison':'Mesure indisponible';
  $('#solar-line').classList.toggle('stopped',!E.finite(f.solar)||f.solar<=1);$('#grid-line').classList.toggle('stopped',!E.finite(f.import)||(f.import+f.export)<=1);$('#grid-line').style.animationDirection=exporting?'reverse':'normal';$('#grid-line').style.stroke=exporting?'var(--mint)':'var(--grid)';
  $('#flow-summary').textContent=cover===null?'En attente de mesures':cover>=99.5?'La maison est alimentée par le solaire':fmt(cover,0)+' % de la maison alimentés par le solaire';$('#flow-direction').textContent=E.finite(f.export)?exporting?power(f.export,false)+' de surplus':power(f.import,false)+' du réseau':'—';
  $('#update-label').textContent=mode==='demo'?'Simulation · toutes les 2 s':lastRead?(ok?'Lu à ':'Lecture partielle · ')+new Date(lastRead).toLocaleTimeString('fr-FR',{timeZone:E.ZONE}):'En attente de connexion';
  const max=Math.max(...['pool','heatpump','waterheater'].map(k=>values[k]||0),1);
  for(const k of ['pool','heatpump','waterheater']){const n=values[k];$('#device-'+k+' .device-value').innerHTML=power(n);$('#device-'+k+' p').textContent=!E.finite(n)?'Mesure indisponible':n<10?'Au repos':'En fonctionnement';$('#device-'+k+' .mini-track span').style.width=(E.finite(n)?n/max*100:0)+'%';}
}
async function jsonRequest(url,options={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),options.timeout||4000);try{
  if(proxyToken&&/^https?:\/\//.test(url)){options={...options,method:'POST',headers:{'Content-Type':'application/json','X-Maison-Token':proxyToken},body:JSON.stringify({url,method:options.method||'GET',body:options.body||null})};url='/api/request';}
  const r=await fetch(url,{cache:'no-store',...options,signal:c.signal});let data;try{data=await r.json();}catch{throw Error('Réponse illisible (HTTP '+r.status+').');}if(!r.ok||data?.error)throw Error(typeof data?.error==='string'?data.error:'HTTP '+r.status);return data;
}finally{clearTimeout(t);}}
async function readDevice(ip,gen='auto'){
  if(!validIP(ip))throw Error('IP locale invalide');
  if(!isLocal())throw Error('Ouvrir le HTML téléchargé sur le réseau de la maison.');
  const actual=gen==='auto'?genCache.get(ip)||'2':gen;
  try{const d=await jsonRequest('http://'+ip+(actual==='1'?'/status':'/rpc/Shelly.GetStatus'));genCache.set(ip,actual);return d;}
  catch(e){if(gen==='auto'&&!genCache.has(ip)){const d=await jsonRequest('http://'+ip+'/status');genCache.set(ip,'1');return d;}throw e;}
}
async function poll(){
  if(mode==='demo'){paintLive(demoNow());return;}if(busy)return;
  if(!cfg.confirmed||!['load','grid'].includes(cfg.topology)||!isLocal()){paintLive({});return;}
  busy=true;const version=fetchGeneration;
  try{
    const unique=[...new Set(cfg.meters.map(m=>m.ip))];const responses=await Promise.allSettled(unique.map(ip=>readDevice(ip,cfg.meters.find(m=>m.ip===ip).gen)));
    if(version!==fetchGeneration||mode!=='live')return;
    const values={};let count=0;
    for(const m of cfg.meters){const r=responses[unique.indexOf(m.ip)];const n=r.status==='fulfilled'?E.meter(r.value,+m.channel):null;let v=n===null?null:n*(m.invert?-1:1);if(E.finite(v)&&!(m.key==='home'&&cfg.topology==='grid'))v=v < -10?null:Math.max(0,v);values[m.key]=v;if(E.finite(v))count++;}
    lastRead=count?Date.now():0;paintLive(values,count===5);
  }finally{busy=false;}
}
function demoBars(buckets){
  return buckets.map((b,i)=>{const solarShape=['minute','quarter','hour'].includes(granularity)?Math.max(0,Math.sin(((granularity==='minute'?hour+i/60:i/(buckets.length/24))-6)/12*Math.PI)):0.55+.4*Math.sin((i+1)*.7);
    const duration=b.duration/3600,pv=solarShape*(3900+Math.sin(i*1.9)*340)*duration,home=(1200+Math.max(0,Math.sin(i*.63))*900+(i%7===1?600:0))*duration;
    return {...b,wh:[Math.max(0,pv),home,(i%5===2?500:3)*duration,home*.53,(i%8===2?1800:0)*duration,Math.max(0,home-pv),Math.max(0,pv-home)],seconds:Array(7).fill(b.duration)};
  });
}
function chartLabel(b,full=false){
  if(granularity==='year')return E.parts(b.t).year.toString();
  return new Date(b.t).toLocaleString('fr-FR',{timeZone:E.ZONE,...(granularity==='month'?{month:full?'long':'short',...(full?{year:'numeric'}:{})}:granularity==='day'?{day:'numeric',...(full?{month:'long',year:'numeric'}:{})}:{hour:'2-digit',minute:'2-digit',...(full?{timeZoneName:'short'}:{})})});
}
function showTooltip(b,element){
  const index=E.METRICS.indexOf(metric),v=b.wh[index];let text=chartLabel(b,true)+'\n'+labels[metric]+' : '+(v===null?'aucune mesure':fmt(v/1000,3)+' kWh');
  if(metric==='home')text+='\nSolaire : '+(b.wh[0]===null?'aucune mesure':fmt(b.wh[0]/1000,3)+' kWh');
  if((b.seconds[index]||0)<b.duration*.95)text+='\nCouverture : '+fmt((b.seconds[index]||0)/b.duration*100,0)+' % (partiel)';
  const tip=$('#chart-tooltip'),panel=$('#history').getBoundingClientRect(),r=element.getBoundingClientRect();tip.textContent=text;tip.hidden=false;tip.style.top=Math.max(75,r.top-panel.top-65)+'px';tip.style.left=Math.max(12,Math.min(r.left-panel.left,$('#history').clientWidth-255))+'px';
}
function drawChart(bars){
  currentBars=bars;const index=E.METRICS.indexOf(metric),hasSolar=metric==='home',container=$('#chart');
  $('#solar-total-wrap').hidden=!hasSolar;$('#solar-legend').hidden=!hasSolar;$('#chart-metric-label').textContent=metric==='home'?'Consommation':labels[metric];
  const sum=i=>bars.some(b=>b.wh[i]!==null)?bars.reduce((s,b)=>s+(b.wh[i]||0),0):null;
  $('#chart-total').innerHTML=energy(sum(index));$('#chart-solar-total').innerHTML=energy(sum(0));
  const width=Math.max(300,container.clientWidth),height=224,left=44,bottom=30,top=18,w=width-left-8,h=height-bottom-top;
  const max=Math.max(.001,...bars.flatMap(b=>[b.wh[index]||0,hasSolar?b.wh[0]||0:0]).map(x=>x/1000));
  const factor=10**Math.floor(Math.log10(max)),ceiling=Math.ceil(max/factor*2)/2*factor,step=w/bars.length;
  let svg='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Énergie par '+({minute:'minute',quarter:'quart d’heure',hour:'heure',day:'jour',month:'mois',year:'année'}[granularity])+', en kilowattheures">';
  for(let i=0;i<=4;i++){const y=top+h-i*h/4;svg+='<line x1="'+left+'" y1="'+y+'" x2="'+(width-8)+'" y2="'+y+'"/><text x="'+(left-9)+'" y="'+(y+4)+'" text-anchor="end">'+escape(fmt(ceiling*i/4,ceiling<.1?3:ceiling<10?2:0))+'</text>';}
  const labelEvery=Math.max(1,Math.ceil(bars.length/(width<480?5:10)));
  bars.forEach((b,i)=>{const x=left+i*step,bw=Math.max(1,step*(hasSolar?.32:.62));
    [index,...(hasSolar?[0]:[])].forEach((m,j)=>{const value=b.wh[m];if(value!==null){const bh=Math.max(value>0?1:0,value/1000/ceiling*h);svg+='<rect class="'+(j?'bar-solar':'bar-home')+'" x="'+(x+step*.13+j*bw)+'" y="'+(top+h-bh)+'" width="'+Math.max(.8,bw-1)+'" height="'+bh+'" rx="1.5" opacity="'+(b.seconds[m]<b.duration*.95?.5:1)+'"/>';}});
    if(b.wh[index]===null&&(!hasSolar||b.wh[0]===null))svg+='<line x1="'+(x+2)+'" y1="'+(top+h-2)+'" x2="'+(x+step-2)+'" y2="'+(top+h-2)+'" style="stroke:#bac5c9;stroke-width:2;stroke-dasharray:2 2"/>';
    if(i%labelEvery===0)svg+='<text x="'+(x+step/2)+'" y="'+(height-5)+'" text-anchor="middle">'+escape(chartLabel(b))+'</text>';
    const accessible=chartLabel(b,true)+', '+labels[metric]+', '+(b.wh[index]===null?'aucune mesure':fmt(b.wh[index]/1000,3)+' kWh');
    svg+='<rect class="hit" data-bar="'+i+'" tabindex="0" role="img" aria-label="'+escape(accessible)+'" x="'+x+'" y="'+top+'" width="'+step+'" height="'+h+'"/>';
  });container.innerHTML=svg+'</svg>';
  for(const el of container.querySelectorAll('[data-bar]')){const show=()=>showTooltip(bars[+el.dataset.bar],el);el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('click',show);el.addEventListener('pointerleave',()=>$('#chart-tooltip').hidden=true);el.addEventListener('blur',()=>$('#chart-tooltip').hidden=true);}
}
function emptyChart(title,message){currentBars=[];$('#chart').innerHTML='<div class="chart-empty"><b>'+escape(title)+'</b><span>'+escape(message)+'</span></div>';$('#chart-total').textContent='—';$('#chart-solar-total').textContent='—';}
async function loadHistory(){
  const request=++historyRequest;$('#chart-tooltip').hidden=true;$('#chart-hour').hidden=granularity!=='minute';
  $$('.granularity button').forEach(b=>{const selected=b.dataset.granularity===granularity;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  $$('[data-metric]').forEach(b=>{const selected=b.dataset.metric===metric;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  const dayRange=E.range(date,'hour'),hours=Math.round((dayRange.to-dayRange.from)/3600000);
  hour=Math.min(hour,hours-1);
  $('#chart-hour').innerHTML=Array.from({length:hours},(_,i)=>'<option value="'+i+'">'+new Date(dayRange.from+i*3600000).toLocaleTimeString('fr-FR',{timeZone:E.ZONE,hour:'2-digit',minute:'2-digit',...(hours!==24?{timeZoneName:'short'}:{})})+'</option>').join('');$('#chart-hour').value=hour;
  const buckets=E.buckets(date,granularity,hour);
  if(mode==='demo'){drawChart(demoBars(buckets));$('#chart-note').textContent='Données simulées · chaque barre correspond à la durée choisie';return;}
  $('#chart-note').textContent='Historique Google Sheets · mise à jour par lots de 5 minutes';
  if(!cfg.sheetsUrl||!cfg.readToken){emptyChart('L’historique attend ses premières mesures','Reliez Google Sheets dans les réglages et installez le collecteur Shelly.');return;}
  emptyChart('Chargement de l’historique…','Lecture des mesures enregistrées.');
  try{
    const from=buckets[0].t,to=buckets.at(-1).t+buckets.at(-1).duration*1000;
    const data=await jsonRequest(cfg.sheetsUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'history',token:cfg.readToken,from,to,granularity}),timeout:25000});
    if(request!==historyRequest)return;if(!data.ok||!Array.isArray(data.bars))throw Error(data.error||'Réponse Google non reconnue');
    const map=new Map(data.bars.map(b=>[b.key,b])),bars=buckets.map(b=>({...b,wh:map.get(b.key)?.wh||Array(7).fill(null),seconds:map.get(b.key)?.seconds||Array(7).fill(0)}));
    if(!data.bars.length){emptyChart('Aucune mesure pour cette période',data.notice||'Le collecteur doit être installé et avoir envoyé ses premiers relevés.');}
    else drawChart(bars);
    const index=E.METRICS.indexOf(metric),partial=bars.some(b=>b.seconds[index]<b.duration*.95);
    $('#chart-note').textContent=(data.notice||'Google Sheets · heure de Paris')+(partial?' · Périodes incomplètes : barres atténuées ou pointillés':'');
  }catch(e){if(request!==historyRequest)return;emptyChart('Historique indisponible','Vérifiez l’adresse /exec, la clé de lecture et le déploiement Apps Script. '+(e.name==='AbortError'?'Délai dépassé.':e.message));}
}
function configRows(items,relay=false){return '<div class="config-head"><span>Mesure</span><span>IP locale</span><span>Génération</span><span>Canal</span><span>'+(relay?'Durée':'Signe')+'</span></div>'+items.map(m=>'<div class="config-row" data-config="'+m.key+'"><span class="row-name">'+escape(relay?(m.key==='gate'?'Portail':'Garage'):labels[m.key])+'</span><input data-field="ip" value="'+escape(m.ip)+'" aria-label="IP '+m.key+'" placeholder="192.168.1.…" autocomplete="off"><select data-field="gen" aria-label="Génération '+m.key+'">'+'<option value="auto">Auto</option>'+'<option value="1">Gen 1</option><option value="2">Gen 2 / 3 / 4</option></select><select data-field="channel" aria-label="Canal '+m.key+'"><option value="0">0</option><option value="1">1</option></select>'+(relay?'<select data-field="seconds" '+(m.key==='gate'?'disabled':'')+' aria-label="Durée '+m.key+'"><option value="0.5">0,5 s</option><option value="1">1 s</option><option value="2">2 s</option></select>':'<label><input type="checkbox" data-field="invert" '+(m.invert?'checked':'')+'>Inverser</label>')+'</div>').join('');}
function openSettings(){
  $('#meter-configs').innerHTML=configRows(cfg.meters);$('#relay-configs').innerHTML=configRows(cfg.relays,true);
  for(const m of [...cfg.meters,...cfg.relays]){const r=$('[data-config="'+m.key+'"]');r.querySelector('[data-field="gen"]').value=m.gen;r.querySelector('[data-field="channel"]').value=m.channel;if(m.seconds)r.querySelector('[data-field="seconds"]').value=m.seconds;}
  $('#mapping-confirmed').checked=cfg.confirmed;$('#relay-confirmed').checked=cfg.relayConfirmed;$('#topology').value=cfg.topology;$('#sheets-url').value=cfg.sheetsUrl;$('#read-token').value=cfg.readToken;$('#form-message').textContent='';$('#diagnostics').hidden=true;
  $('#connection-hint').textContent=isLocal()?'Les mesures en direct sont lues sur votre Wi-Fi. Le collecteur Shelly continue l’enregistrement quand cette page est fermée.':'Cette version en ligne permet d’explorer le tableau de bord et de lire Google Sheets. Pour contacter vos IP locales, téléchargez l’interface HTML et ouvrez-la sur le Wi-Fi de la maison.';
  access.fillSettings();$('#settings-dialog').showModal();
}
function readForm(){
  const read=m=>{const row=$('[data-config="'+m.key+'"]');const n={...m};for(const k of ['ip','gen','channel','seconds','invert']){const el=row.querySelector('[data-field="'+k+'"]');if(el)n[k]=k==='invert'?el.checked:['channel','seconds'].includes(k)?+el.value:el.value.trim();}return n;};
  return {...cfg,...access.readSettings(),meters:cfg.meters.map(read),relays:cfg.relays.map(read),confirmed:$('#mapping-confirmed').checked,relayConfirmed:$('#relay-confirmed').checked,topology:$('#topology').value,sheetsUrl:$('#sheets-url').value.trim(),readToken:$('#read-token').value.trim()};
}
function validateConfig(c){
  if(c.meters.some(m=>!validIP(m.ip)))throw Error('Renseignez une IP locale valide pour chaque mesure.');
  for(const ip of new Set(c.meters.map(m=>m.ip)))if(new Set(c.meters.filter(m=>m.ip===ip).map(m=>m.gen)).size>1)throw Error('Les voies d’un même Shelly doivent avoir la même génération.');
  if(new Set(c.meters.map(m=>m.ip+':'+m.channel)).size!==5)throw Error('Deux mesures utilisent le même canal : vérifiez les affectations.');
  if(c.confirmed&&c.topology==='unknown')throw Error('Choisissez l’emplacement de la pince « maison » avant de valider ses mesures.');
  if(c.sheetsUrl&&!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.sheetsUrl))throw Error('L’adresse Google Apps Script doit commencer par https://script.google.com/macros/s/ et finir par /exec.');
  if(c.relays.some(r=>r.ip&&!validIP(r.ip)))throw Error('L’IP du portail ou du garage est invalide.');
  access.validate(c);
}
async function testShelly(){
  const c=readForm(),out=$('#diagnostics');out.hidden=false;out.textContent='Lecture des compteurs…';$('#test-shelly').disabled=true;
  try{const ips=[...new Set(c.meters.map(m=>m.ip))],results=await Promise.allSettled(ips.map(ip=>readDevice(ip,c.meters.find(m=>m.ip===ip).gen)));
    out.textContent=ips.map((ip,i)=>{const r=results[i];if(r.status==='rejected')return ip+' : '+r.reason.message+'\n';let text=ip+' · Gen '+genCache.get(ip)+'\n';for(let ch=0;ch<2;ch++)text+='  Canal '+ch+' : '+power(E.meter(r.value,ch),false)+'\n';return text;}).join('\n');
  }finally{$('#test-shelly').disabled=false;}
}
function downloadHtml(){const a=document.createElement('a');a.href='maison-energie.html';a.download='maison-energie.html';a.click();}
function changeDate(direction){
  let d=new Date(date+'T12:00:00Z');
  if(granularity==='month'||granularity==='year')d.setUTCFullYear(d.getUTCFullYear()+direction);
  else if(granularity==='day'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);}
  else d.setUTCDate(d.getUTCDate()+direction);
  date=d.toISOString().slice(0,10);$('#chart-date').value=date;loadHistory();
}
const access=HomeAccess.create({get:()=>cfg,mode:()=>mode,isLocal,request:jsonRequest,toast,validIP});
$('#device-grid').innerHTML=[['pool','pool'],['heatpump','fan'],['waterheater','water']].map(([k,icon])=>'<article class="device-card" id="device-'+k+'"><span class="device-icon"><svg><use href="#i-'+icon+'"/></svg></span><div><h3>'+labels[k]+'</h3><p>En attente</p></div><strong class="device-value">—</strong><div class="mini-track"><span></span></div></article>').join('');
$('#today-label').textContent=new Date().toLocaleDateString('fr-FR',{timeZone:E.ZONE,weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase();
$('#chart-date').value=date;$('#chart-hour').innerHTML=Array.from({length:25},(_,i)=>'<option value="'+i+'">'+i+'e heure</option>').join('');$('#chart-hour').value=hour;
document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-settings'))openSettings();if(el.id==='local-download'||el.id==='download-html')downloadHtml();if(el.dataset.granularity){granularity=el.dataset.granularity;loadHistory();}if(el.dataset.metric){metric=el.dataset.metric;loadHistory();}if(el.dataset.pulse)access.requestPulse(el.dataset.pulse,el.dataset.gateMode);});
$('#settings-form').addEventListener('submit',e=>{e.preventDefault();try{const next=readForm();validateConfig(next);cfg=next;mode='live';fetchGeneration++;lastRead=0;genCache.clear();save();$('#settings-dialog').close();renderMode();access.refresh();paintLive({});poll();loadHistory();}catch(e){$('#form-message').textContent=e.message;}});
$('[data-close]').onclick=()=>$('#settings-dialog').close();$('#demo-mode').onclick=()=>{mode='demo';fetchGeneration++;save();$('#settings-dialog').close();renderMode();access.refresh();poll();loadHistory();};$('#test-shelly').onclick=testShelly;
$('#cancel-pulse').onclick=()=>{access.cancelPending();$('#pulse-dialog').close();};$('#confirm-pulse').onclick=access.sendPulse;
$('#chart-date').onchange=e=>{if(!e.target.value)return;date=e.target.value;loadHistory();};$('#chart-hour').onchange=e=>{hour=+e.target.value;loadHistory();};$('#previous-date').onclick=()=>changeDate(-1);$('#next-date').onclick=()=>changeDate(1);$('#refresh-history').onclick=loadHistory;
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(currentBars.length)drawChart(currentBars);},120);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){poll();access.tick();if(mode==='live')loadHistory();}});
setInterval(()=>{if(!document.hidden){poll();access.tick();}if(mode==='live'&&lastRead&&Date.now()-lastRead>12000)paintLive({});},2000);
setInterval(()=>{if(!document.hidden&&mode==='live')loadHistory();},300000);
async function initialize(){
  if(location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname))try{const r=await fetch('/api/session');if(r.ok)proxyToken=(await r.json()).token;}catch{}
  renderMode();access.refresh();poll();loadHistory();
}initialize();
// Optional browser agent API. It shares the visible chart state; no device command is exposed.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const register=t=>{try{Promise.resolve(document.modelContext.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_energy_dashboard',description:'Lire les puissances affichées et leur origine. Une démonstration renvoie explicitement des valeurs simulées.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode,simulated:mode==='demo',readAt:lastRead||null,watts:live})});
  register({name:'set_energy_chart',description:'Choisir la durée des barres et la mesure du graphique visible, sans commander d’appareil.',inputSchema:{type:'object',properties:{granularity:{type:'string',enum:['minute','quarter','hour','day','month','year']},metric:{type:'string',enum:['home','pool','heatpump','waterheater']}},required:['granularity','metric'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!input||!['minute','quarter','hour','day','month','year'].includes(input.granularity)||!['home','pool','heatpump','waterheater'].includes(input.metric))throw Error('Sélection invalide');granularity=input.granularity;metric=input.metric;await loadHistory();return {granularity,metric,mode,bars:currentBars.length};}});
}
})();
