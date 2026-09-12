/* Portail Guigui — une seule instance, sur un Shelly compatible Scripts.
 * Aucun mouvement au demarrage. Toutes les impulsions durent 0,5 seconde.
 * Voiture : une impulsion. Pieton : impulsions a t=0, t=5 s, t=35 s.
 * Le portail doit etre ferme avant le mode pieton. Aucun capteur de position.
 */
let PORTAIL = {
  confirmed: false,
  ip: "192.168.1.114",
  channel: 0,
  transport: "auto", // "local" si le script tourne SUR le relais du portail ; sinon auto, 1 ou 2.
  token: "", // Cle privee d'au moins 24 caracteres, identique dans les reglages du tableau de bord.
};

function createGateController(io) {
  let active = null, recent = [], timer = null, cooldownUntil = 0;
  function snapshot(job) {
    let j = job || active;
    return {id:j ? j.id : null, mode:j ? j.mode : null, state:j ? j.state : "idle",
      busy:!!(active && (active.inFlight || active.state === "starting" || active.state === "wait_stop" || active.state === "wait_close")),
      pulses:j ? j.pulses : 0, nextIn:j && j.nextAt ? Math.max(0,Math.ceil((j.nextAt - io.now()) / 1000)) : null,
      cooldown:Math.max(0,Math.ceil((cooldownUntil - io.now()) / 1000)), error:j ? j.error : null, position:"unknown"};
  }
  function clear() { if (timer !== null) { io.cancel(timer); timer = null; } }
  function fail(j, message) {
    clear(); j.inFlight = false; j.nextAt = null;
    if (j.state !== "cancelled") { j.state = "error"; j.error = message; }
    cooldownUntil = Math.max(cooldownUntil,io.now() + 10000);
  }
  function pulse(j, index, due) {
    if (active !== j || j.state === "cancelled") return;
    j.inFlight = true; j.nextAt = null;
    try { io.pulse(function() { return active === j && j.state !== "cancelled"; }, due, function(error,sentAt) {
      j.inFlight = false;
      if (active !== j || j.state === "cancelled") return;
      if (error) { fail(j,error); return; }
      j.pulses = index + 1;
      cooldownUntil = Math.max(cooldownUntil,sentAt + 10000);
      if (j.mode === "car" || index === 2) { j.state = "done"; j.nextAt = null; return; }
      j.state = index === 0 ? "wait_stop" : "wait_close";
      j.nextAt = sentAt + (index === 0 ? 5000 : 30000);
      if (io.now() > j.nextAt) { fail(j,"Reponse trop tardive : suite annulee."); return; }
      let deadline = j.nextAt;
      try { timer = io.schedule(Math.max(1,deadline - io.now()),function() { timer = null; pulse(j,index + 1,deadline); }); }
      catch(e) { fail(j,"Impossible de programmer la suite."); }
    }); } catch(e) { fail(j,"Impossible d'envoyer l'impulsion : suite annulee."); }
  }
  function start(id,mode,closed) {
    if (typeof id !== "string" || id.length < 8 || id.length > 80 || (mode !== "car" && mode !== "pedestrian")) throw new Error("Commande invalide.");
    for (let i = 0; i < recent.length; i++) if (recent[i].id === id) {
      if (recent[i].mode !== mode) throw new Error("Identifiant deja utilise pour un autre mode.");
      return snapshot(recent[i]);
    }
    if (snapshot().busy || io.now() < cooldownUntil) throw new Error("Une commande est deja en cours. Patientez.");
    if (mode === "pedestrian" && closed !== true) throw new Error("Le portail doit etre ferme au depart.");
    let j = {id:id,mode:mode,state:"starting",pulses:0,inFlight:false,nextAt:null,error:null};
    active = j; recent.push(j);
    if (recent.length > 8) { let tail = []; for (let k = 1; k < recent.length; k++) tail.push(recent[k]); recent = tail; }
    pulse(j,0,null); return snapshot(j);
  }
  function cancel(id) {
    if (!active || active.id !== id) throw new Error("Sequence inconnue : actualisez son etat.");
    if (active.state === "done" || active.state === "error" || active.state === "cancelled") return snapshot();
    clear();active.state = "cancelled";active.nextAt = null;
    // An already dispatched pulse cannot be recalled. New starts remain locked while it is in flight.
    cooldownUntil = Math.max(cooldownUntil,io.now() + 10000);
    return snapshot();
  }
  return {start:start,cancel:cancel,status:function(){return snapshot();}};
}

// Node exports let the sequence be tested with a simulated clock and no real device.
if (typeof module !== "undefined" && module.exports) module.exports = {createGateController:createGateController};

if (typeof Shelly !== "undefined") {
  let detected = null;
  function clock() { return Shelly.getUptimeMs(); }
  function configured() {
    return PORTAIL.confirmed === true && typeof PORTAIL.token === "string" && PORTAIL.token.length >= 24 &&
      (PORTAIL.channel === 0 || PORTAIL.channel === 1) &&
      (PORTAIL.transport === "local" || PORTAIL.transport === "auto" || PORTAIL.transport === "1" || PORTAIL.transport === "2");
  }
  function remote(path,cb) {
    Shelly.call("HTTP.GET",{url:"http://" + PORTAIL.ip + path,timeout:2},function(r,code) {
      if (code !== 0 || !r || r.code !== 200) { cb("Shelly injoignable : commande non confirmee.",null); return; }
      let data = null;try { data = JSON.parse(r.body); } catch(e) {}
      if (!data || data.error || (typeof data.code === "number" && data.code < 0)) { cb("Reponse du relais invalide.",null); return; }
      cb(null,data);
    });
  }
  function identify(cb) {
    if (PORTAIL.transport === "local") {
      let wifi = Shelly.getComponentStatus("wifi"), eth = Shelly.getComponentStatus("eth");
      if ((!wifi || wifi.sta_ip !== PORTAIL.ip) && (!eth || eth.ip !== PORTAIL.ip)) { cb("Ce script ne tourne pas sur le Shelly du portail.",null);return; }
      cb(null,"local"); return;
    }
    if (PORTAIL.transport === "1" || PORTAIL.transport === "2") { cb(null,PORTAIL.transport); return; }
    if (detected) { cb(null,detected); return; }
    remote("/shelly",function(err,data) {
      if (err) { cb(err,null); return; }
      if (data.gen >= 2) detected = "2";
      else if (typeof data.type === "string") detected = "1";
      else { cb("Generation Shelly non reconnue.",null); return; }
      cb(null,detected);
    });
  }
  function dispatch(isActive,deadline,done) {
    identify(function(error,gen) {
      if (error) { done(error,0); return; }
      function afterStatus(err,status) {
        if (!isActive()) { done("Annulee.",0); return; }
        if (err) { done(err,0); return; }
        let on = gen === "1" ? (status.relays && status.relays[PORTAIL.channel] ? status.relays[PORTAIL.channel].ison : null) : status.output;
        if (on !== false) { done("Relais actif ou etat inconnu : suite annulee.",0); return; }
        if (deadline !== null && clock() > deadline + 1000) { done("Echeance depassee : suite annulee.",0); return; }
        let sentAt = clock();
        function ack(e,r) {
          if (e || !r || (gen === "1" ? r.ison !== true : r.was_on !== false)) { done(e || "Impulsion non confirmee : suite annulee.",sentAt); return; }
          done(null,sentAt);
        }
        // OFF is timed by the relay itself, even if this script or its network fails.
        if (gen === "local") Shelly.call("Switch.Set",{id:PORTAIL.channel,on:true,toggle_after:0.5},function(r,c){ack(c === 0 ? null : "Impulsion refusee.",r);});
        else remote(gen === "1" ? "/relay/"+PORTAIL.channel+"?turn=on&timer=0.5" : "/rpc/Switch.Set?id="+PORTAIL.channel+"&on=true&toggle_after=0.5",ack);
      }
      if (gen === "local") afterStatus(null,Shelly.getComponentStatus("switch:" + PORTAIL.channel) || {});
      else remote(gen === "1" ? "/status" : "/rpc/Switch.GetStatus?id="+PORTAIL.channel,afterStatus);
    });
  }
  let controller = createGateController({now:clock,schedule:function(ms,fn){return Timer.set(ms,false,fn);},cancel:function(id){Timer.clear(id);},pulse:dispatch});
  function reply(response,code,value) {
    response.code = code;response.body = JSON.stringify(value);
    response.headers = [["Content-Type","application/json"],["Cache-Control","no-store"],["Access-Control-Allow-Origin","*"]];response.send();
  }
  HTTPServer.registerEndpoint("gate",function(request,response) {
    if (request.method !== "POST") { reply(response,405,{ok:false,error:"POST requis."});return; }
    if (!request.body || request.body.length > 1000) { reply(response,400,{ok:false,error:"Requete invalide."});return; }
    let b;try { b = JSON.parse(request.body); } catch(e) { reply(response,400,{ok:false,error:"JSON invalide."});return; }
    if (!b || !PORTAIL.token || PORTAIL.token.length < 24 || b.token !== PORTAIL.token) { reply(response,403,{ok:false,error:"Cle du portail incorrecte."});return; }
    let state;
    try {
      if (b.action === "status") state = controller.status();
      else if (!configured()) throw new Error("Configurer et valider PORTAIL avant activation.");
      else if (b.action === "start") state = controller.start(b.id,b.mode,b.closed);
      else if (b.action === "cancel") state = controller.cancel(b.id);
      else throw new Error("Action inconnue.");
      reply(response,200,{ok:true,ready:configured(),targetIp:PORTAIL.ip,channel:PORTAIL.channel,transport:PORTAIL.transport,job:state});
    } catch(e) { reply(response,409,{ok:false,error:e.message}); }
  });
  print("Controleur portail charge : /script/<ID>/gate. Aucune impulsion au demarrage.");
}
