(function(root){
'use strict';
const virtualDefaults={enabled:false,ip:'',component:'',label:'Composant virtuel',unit:'',falseLabel:'Inactif',trueLabel:'Actif'};
const rechargeVE={enabled:true,ip:'192.168.1.10',component:'boolean:200',label:'Recharge VE',unit:'',falseLabel:'Recharge VE OFF',trueLabel:'Recharge VE On'};
function migrate(config){
  const c={...config,gateController:{url:'',token:'',...config.gateController},virtual:{...virtualDefaults,...config.virtual}};
  c.relays=config.relays.map(r=>({...r}));
  if((c.accessVersion||0)<2){c.relays.find(r=>r.key==='gate').ip='192.168.1.114';c.relays.find(r=>r.key==='garage').ip='192.168.1.10';}
  if((c.virtualVersion||0)<1){
    if(!c.virtual.component||(c.virtual.ip===rechargeVE.ip&&c.virtual.component===rechargeVE.component))c.virtual={...c.virtual,...rechargeVE};
    c.virtualVersion=1;
  }
  c.relays.find(r=>r.key==='gate').seconds=.5;c.accessVersion=2;return c;
}
function virtualPath(component){const m=/^(text|number|boolean|enum):(2\d{2})$/.exec(component);if(!m)throw Error('Identifiant attendu : text:204, number:200, boolean:200 ou enum:200.');return '/rpc/'+m[1][0].toUpperCase()+m[1].slice(1)+'.GetStatus?id='+m[2];}
function controllerUrlValid(value,validIP){try{const u=new URL(value);return u.protocol==='http:'&&validIP(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.port&&/^\/script\/\d+\/gate$/.test(u.pathname);}catch{return false;}}
function create(o){
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  let remote=null,remoteTime=0,remoteError='',reading=false,virtualReading=false,version=0,pending=null,sending=false,demo=null,lastPulse={};
  const get=o.get,mode=o.mode,local=o.isLocal,request=o.request,toast=o.toast;
  function demoState(){
    if(!demo)return {state:'idle',busy:false,pulses:0};
    if(demo.cancelled)return {id:demo.id,state:'cancelled',busy:false,pulses:demo.pulses};
    const elapsed=(Date.now()-demo.at)/1000;
    if(demo.mode==='car')return {id:demo.id,mode:'car',state:'done',busy:false,pulses:1};
    demo.pulses=elapsed<5?1:elapsed<35?2:3;
    return {id:demo.id,mode:demo.mode,state:elapsed<5?'wait_stop':elapsed<35?'wait_close':'done',busy:elapsed<35,pulses:demo.pulses,nextIn:Math.ceil(elapsed<5?5-elapsed:35-elapsed)};
  }
  function current(){return mode()==='demo'?demoState():remote?.job;}
  function controllerConfigured(){const c=get().gateController;return !!(c.url&&c.token);}
  function fresh(){return !!remote&&Date.now()-remoteTime<7000;}
  function render(){
    const c=get(),simulated=mode()==='demo',gate=c.relays.find(r=>r.key==='gate'),garage=c.relays.find(r=>r.key==='garage'),job=current();
    const directReady=c.relayConfirmed&&o.validIP(gate.ip)&&local();
    const useController=controllerConfigured(),ready=simulated||(directReady&&(!useController||(fresh()&&remote.ready)));
    const occupied=!!job?.busy||(job?.cooldown||0)>0;
    $('[data-gate-mode="car"]').disabled=!ready||occupied||sending;
    $('[data-gate-mode="pedestrian"]').disabled=!ready||(!simulated&&!useController)||occupied||sending;
    $('[data-pulse="garage"]').disabled=!simulated&&!(c.relayConfirmed&&o.validIP(garage.ip)&&local());
    $('#gate-status').textContent=simulated?'Démonstration · position inconnue':!directReady?'Canal et modèle à vérifier · position inconnue':useController&&!fresh()?(remoteError||'Contrôleur à relier')+' · position inconnue':useController&&!remote.ready?'Script à configurer · position inconnue':'Position inconnue · sans capteur';
    $('#garage-status').textContent=simulated?'Démonstration · position inconnue':'Position inconnue · sans capteur';
    $('#gate-ip').textContent=gate.ip;$('#garage-ip').textContent=garage.ip;
    const panel=$('#gate-progress'),label=$('#gate-progress-text');panel.hidden=!job||job.state==='idle';
    if(job){
      const prefix=simulated?'Simulation · ':'';
      const texts={starting:'Transmission de la première impulsion…',wait_stop:'1/3 · impulsion d’arrêt dans '+job.nextIn+' s',wait_close:'2/3 · impulsion de fermeture dans '+job.nextIn+' s',done:job.mode==='car'?'Impulsion envoyée · fermeture gérée par le portail':'3/3 · impulsion de fermeture envoyée',cancelled:'Impulsions restantes annulées · le mouvement n’a pas été arrêté',error:job.error||'Séquence interrompue · vérifier le portail'};
      label.textContent=prefix+(texts[job.state]||'Lecture de la séquence…');
      if(!simulated&&useController&&!fresh())label.textContent='Suivi indisponible : la séquence peut continuer sur le Shelly.';
    }
    $('#cancel-gate-sequence').hidden=!job?.busy;$('#cancel-gate-sequence').disabled=!simulated&&!fresh();
    $('#gate-controller-hint').hidden=simulated||useController;
    $('#virtual-title').textContent=c.virtual.label||'Composant virtuel';
    if(!c.virtual.enabled){$('#virtual-value').textContent='À configurer';$('#virtual-status').textContent='Texte, nombre ou état de votre Shelly';}
    else if(simulated){$('#virtual-value').textContent='État inconnu';$('#virtual-status').textContent='Passez en direct sur le réseau maison pour lire ce composant';}
  }
  function fillSettings(){
    const c=get();$('#gate-controller-url').value=c.gateController.url;$('#gate-controller-token').value=c.gateController.token;
    $('#virtual-enabled').checked=c.virtual.enabled;$('#virtual-ip').value=c.virtual.ip;$('#virtual-component').value=c.virtual.component;$('#virtual-name').value=c.virtual.label;$('#virtual-unit').value=c.virtual.unit;
    $('#virtual-false-label').value=c.virtual.falseLabel;$('#virtual-true-label').value=c.virtual.trueLabel;
  }
  function readSettings(){return {gateController:{url:$('#gate-controller-url').value.trim(),token:$('#gate-controller-token').value.trim()},virtual:{enabled:$('#virtual-enabled').checked,ip:$('#virtual-ip').value.trim(),component:$('#virtual-component').value.trim().toLowerCase(),label:$('#virtual-name').value.trim(),unit:$('#virtual-unit').value.trim(),falseLabel:$('#virtual-false-label').value.trim(),trueLabel:$('#virtual-true-label').value.trim()}};}
  function validate(c){
    if(c.gateController.url&&!controllerUrlValid(c.gateController.url,o.validIP))throw Error('Adresse du contrôleur attendue : http://IP_DU_SHELLY/script/ID/gate.');
    if(c.gateController.url&&c.gateController.token.length<24)throw Error('La clé du contrôleur doit contenir au moins 24 caractères.');
    if(c.virtual.enabled){if(!o.validIP(c.virtual.ip))throw Error('Renseignez l’IP du Shelly qui porte le composant virtuel.');virtualPath(c.virtual.component);}
  }
  async function controllerCall(payload){
    const c=get(),gate=c.relays.find(r=>r.key==='gate');
    if(!local()||!controllerUrlValid(c.gateController.url,o.validIP))throw Error('Le contrôleur doit être accessible sur le réseau local.');
    const d=await request(c.gateController.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:c.gateController.token}),timeout:5000});
    if(!d.ok||!d.job)throw Error(d.error||'Réponse du contrôleur invalide.');
    if(d.targetIp!==gate.ip||d.channel!==gate.channel)throw Error('Le script cible un autre relais : vérifiez son IP et son canal.');
    return d;
  }
  async function pollController(){
    if(reading||mode()!=='live'||!local()||!controllerConfigured())return;
    reading=true;const v=version;
    try{const d=await controllerCall({action:'status'});if(v!==version)return;remote=d;remoteTime=Date.now();remoteError='';}
    catch(e){if(v===version){remoteTime=0;remoteError='Contrôleur indisponible';}}
    finally{reading=false;render();}
  }
  async function pollVirtual(){
    const c=get().virtual;if(virtualReading||!c.enabled||mode()!=='live')return;
    if(!local()){$('#virtual-value').textContent='—';$('#virtual-status').textContent='Lecture disponible sur le réseau maison';return;}
    virtualReading=true;const v=version;
    try{
      if(!o.validIP(c.ip))throw Error('IP à configurer');
      const d=await request('http://'+c.ip+virtualPath(c.component));if(v!==version)return;
      if(!Object.prototype.hasOwnProperty.call(d,'value')||d.value===null||(typeof d.value==='number'&&!Number.isFinite(d.value)))throw Error('Valeur absente');
      if(!['string','boolean','number'].includes(typeof d.value))throw Error('Type non pris en charge');
      if(c.component.startsWith('boolean:')&&typeof d.value!=='boolean')throw Error('État booléen attendu');
      $('#virtual-value').textContent=typeof d.value==='boolean'?(d.value?(c.trueLabel||'Actif'):(c.falseLabel||'Inactif')):(typeof d.value==='number'?d.value.toLocaleString('fr-FR',{maximumFractionDigits:3}):d.value)+(c.unit?' '+c.unit:'');
      $('#virtual-status').textContent=c.component+' · lu à '+new Date().toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris'});
    }catch(e){if(v===version){$('#virtual-value').textContent='—';$('#virtual-status').textContent='Composant indisponible · vérifier l’IP et l’identifiant';}}
    finally{virtualReading=false;}
  }
  function refresh(){version++;remote=null;remoteTime=0;remoteError='';$('#virtual-value').textContent='—';$('#virtual-status').textContent='En attente de lecture';render();tick();}
  function tick(){render();pollController();pollVirtual();}
  function requestPulse(key,kind){
    const c=get(),r=c.relays.find(x=>x.key===key),simulated=mode()==='demo';if(!r)return;
    const action=key==='gate'?(kind||'car'):'single';
    if(key==='gate'&&!['car','pedestrian'].includes(action))return;
    if(sending)return;
    if(!simulated&&(!c.relayConfirmed||!o.validIP(r.ip)||!local()))return toast('Vérifiez le canal et le contact sec dans les réglages.');
    if(key==='gate'&&(current()?.busy||(current()?.cooldown||0)>0))return toast('Une séquence est déjà en cours.');
    if(!simulated&&key==='gate'&&((action==='pedestrian'&&!controllerConfigured())||(controllerConfigured()&&(!fresh()||!remote.ready))))return toast('Reliez le script du portail dans les réglages.');
    if(Date.now()-(lastPulse[key]||0)<10000)return toast('Patientez 10 secondes entre deux commandes.');
    pending={...r,seconds:key==='gate'?.5:r.seconds,mode:mode(),action};
    $('#pulse-title').textContent=key==='garage'?'Garage · une impulsion':action==='car'?'Portail · mode voiture':'Portail · mode piéton';
    $('#pulse-description').textContent=(simulated?'Démonstration : aucune commande réelle. ':'')+(key==='garage'?'Une impulsion de '+r.seconds+' seconde(s). Position inconnue.':action==='car'?'Une seule impulsion de 0,5 seconde. Le portail gère ensuite lui-même sa fermeture.':'Trois impulsions de 0,5 seconde : ouverture, arrêt 5 secondes plus tard, puis fermeture 30 secondes après l’arrêt. La séquence continue sur le Shelly si vous fermez cette page.');
    $('#gate-closed-row').hidden=action!=='pedestrian'||simulated;$('#gate-closed').checked=false;
    $('#confirm-pulse').textContent=action==='pedestrian'?'Lancer le mode piéton':'Envoyer l’impulsion';$('#confirm-pulse').disabled=action==='pedestrian'&&!simulated;$('#pulse-dialog').showModal();
  }
  async function single(r){
    let gen=r.gen;
    if(gen==='auto'){const info=await request('http://'+r.ip+'/shelly');gen=info.gen>=2?'2':typeof info.type==='string'?'1':null;if(!gen)throw Error('Modèle à vérifier.');}
    const status=await request('http://'+r.ip+(gen==='1'?'/status':'/rpc/Switch.GetStatus?id='+r.channel));
    const on=gen==='1'?status.relays?.[r.channel]?.ison:status.output;
    if(on!==false)throw Error('Relais déjà actif ou état inconnu.');
    const d=await request('http://'+r.ip+(gen==='1'?'/relay/'+r.channel+'?turn=on&timer='+r.seconds:'/rpc/Switch.Set?id='+r.channel+'&on=true&toggle_after='+r.seconds));
    if(gen==='1'?d.ison!==true:d.was_on!==false)throw Error('Impulsion non confirmée.');
  }
  async function sendPulse(){
    const r=pending;if(!r||sending)return;
    if(r.action==='pedestrian'&&r.mode==='live'&&!$('#gate-closed').checked)return;
    sending=true;$('#confirm-pulse').disabled=true;lastPulse[r.key]=Date.now();render();
    try{
      if(r.mode!==mode())throw Error('Le mode a changé.');
      if(r.mode==='demo'){
        if(r.key==='gate')demo={id:'demo-'+Date.now(),mode:r.action,at:Date.now(),pulses:1};
        toast(r.action==='pedestrian'?'Séquence piéton simulée : 0, 5 et 35 secondes.':'Impulsion simulée · aucun appareil commandé.');
      }else{
        const c=get(),currentRelay=c.relays.find(x=>x.key===r.key);
        if(!c.relayConfirmed||!local()||currentRelay.ip!==r.ip||currentRelay.channel!==r.channel)throw Error('Configuration modifiée.');
        if(r.key==='gate'&&controllerConfigured()){
          if(!fresh()||!remote.ready)throw Error('Relisez l’état du contrôleur.');
          remote=await controllerCall({action:'start',id:globalThis.crypto?.randomUUID?.()||('req-'+Date.now()+'-'+Math.random().toString(36).slice(2)),mode:r.action,closed:r.action==='pedestrian'&&$('#gate-closed').checked});remoteTime=Date.now();
          if(remote.job.state==='error')throw Error(remote.job.error||'Commande refusée.');
          toast(r.action==='car'?'Commande voiture transmise · une seule impulsion.':'Séquence piéton prise en charge par le Shelly.');
        }else{
          if(r.action==='pedestrian')throw Error('Le script piéton doit être installé.');
          await single(r);toast(r.key==='gate'?'Impulsion de 0,5 s acceptée · fermeture gérée par le portail.':'Impulsion acceptée · position inconnue.');
        }
      }
    }catch(e){if(r.key==='gate'&&r.mode==='live'){remoteTime=0;remoteError='Commande non confirmée';}toast(e.message+' Aucune commande ne sera retentée automatiquement.');}
    finally{sending=false;pending=null;$('#confirm-pulse').disabled=false;$('#pulse-dialog').close();render();}
  }
  async function cancelSequence(){
    const j=current();if(!j?.id||!j.busy)return;
    try{if(mode()==='demo'){demo.cancelled=true;}else{remote=await controllerCall({action:'cancel',id:j.id});remoteTime=Date.now();}toast('Impulsions restantes annulées. Cela n’arrête pas un mouvement déjà lancé.');}
    catch(e){remoteTime=0;toast('Annulation non confirmée : la séquence peut continuer sur le Shelly.');}render();
  }
  $('#gate-closed').addEventListener('change',()=>{$('#confirm-pulse').disabled=!$('#gate-closed').checked;});
  $('#cancel-gate-sequence').addEventListener('click',cancelSequence);
  $('#generate-gate-token').addEventListener('click',()=>{const bytes=new Uint8Array(24);if(!globalThis.crypto?.getRandomValues)return toast('Générez une clé privée de 24 caractères ou plus.');crypto.getRandomValues(bytes);$('#gate-controller-token').value=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');toast('Clé générée. Copiez-la dans le script portail.');});
  return {fillSettings,readSettings,validate,render,refresh,tick,requestPulse,sendPulse,cancelPending:()=>{pending=null;}};
}
const api={migrate,virtualPath,controllerUrlValid,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HomeAccess=api;
})(typeof globalThis!=='undefined'?globalThis:this);
