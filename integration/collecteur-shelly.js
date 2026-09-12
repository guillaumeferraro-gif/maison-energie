/* Maison Energie — installer sur UN Shelly compatible Scripts, pas sur tous.
 * Aucune commande de relais. Mesures en W integrees en Wh, fenetres UTC.
 * File d'attente RAM : 30 minutes ; perdue au redemarrage. Voir LIRE-MOI.md.
 */
let CFG = {
  confirmed: false, // Passer a true UNIQUEMENT apres verification des voies.
  topology: "unknown", // "load" = consommation totale ; "grid" = echange reseau signe.
  url: "COLLER_URL_APPS_SCRIPT_EXEC",
  token: "COLLER_WRITE_TOKEN",
  meters: [
    { key: "solar", ip: "192.168.1.15", gen: "auto", channel: 0, invert: false },
    { key: "home", ip: "192.168.1.11", gen: "auto", channel: 0, invert: false },
    { key: "pool", ip: "192.168.1.11", gen: "auto", channel: 1, invert: false },
    { key: "heatpump", ip: "192.168.1.17", gen: "auto", channel: 0, invert: false },
    { key: "waterheater", ip: "192.168.1.17", gen: "auto", channel: 1, invert: false }
  ]
};
let NAMES = ["solar", "home", "pool", "heatpump", "waterheater", "import", "export"];
let devices = [], queue = [], current = null, previous = null;
let reading = false, sending = false, lastAttempt = 0, dropped = 0;

function number(v) { return typeof v === "number" && v === v && v !== Infinity && v !== -Infinity; }
function now() { let s = Shelly.getComponentStatus("sys"); return s && s.unixtime ? s.unixtime * 1000 : null; }
function zeroes() { return [0, 0, 0, 0, 0, 0, 0]; }
function blank(t) { return {t:t, wh:zeroes(), seconds:zeroes()}; }
function readPower(s, ch) {
  if (!s) return null;
  let a = s.emeters ? s.emeters[ch] : (s.meters ? s.meters[ch] : null);
  if (a) return a.is_valid === false || (a.errors && a.errors.length) || !number(a.power) ? null : a.power;
  let names = ["em1:", "switch:", "pm1:"];
  for (let i = 0; i < 3; i++) {
    a = s[names[i] + ch];
    if (a) { let p = number(a.act_power) ? a.act_power : a.apower; return (a.errors && a.errors.length) || !number(p) ? null : p; }
  }
  return null;
}
function nextMinute(t) {
  if (current && current.t !== t) {
    if (queue.length >= 30) { let tail = []; for (let j = 1; j < queue.length; j++) tail.push(queue[j]); queue = tail; dropped++; }
    queue.push(current);
  }
  if (!current || current.t !== t) current = blank(t);
}
function integrate(sample) {
  if (previous && sample.t > previous.t && sample.t - previous.t <= 15000) {
    let t = previous.t;
    while (t < sample.t) {
      let minute = Math.floor(t / 60000) * 60000;
      let end = Math.min(sample.t, minute + 60000), seconds = (end - t) / 1000;
      nextMinute(minute);
      for (let i = 0; i < 7; i++) {
        if (number(previous.values[i]) && number(sample.values[i])) {
          let delta = sample.values[i] - previous.values[i], span = sample.t - previous.t;
          let startW = previous.values[i] + delta * (t - previous.t) / span;
          let endW = previous.values[i] + delta * (end - previous.t) / span;
          current.wh[i] += (startW + endW) / 2 * seconds / 3600;
          current.seconds[i] += seconds;
        }
      }
      t = end;
    }
  }
  // Finalize elapsed minute even when all sensors are offline. Zero coverage is not zero consumption.
  nextMinute(Math.floor(sample.t / 60000) * 60000);
  previous = sample;
}
function finishRead(values) {
  reading = false;
  let t = now(); if (!t) { previous = null; return; }
  let solar = values[0], home = values[1];
  if (number(solar)) solar = solar < -10 ? null : Math.max(0, solar);
  if (CFG.topology === "grid") home = number(solar) && number(home) ? solar + home : null;
  if (number(home)) home = home < -10 ? null : Math.max(0, home);
  values[0] = solar; values[1] = home;
  for (let j = 2; j < 5; j++) if (number(values[j])) values[j] = values[j] < -10 ? null : Math.max(0, values[j]);
  values[5] = number(solar) && number(home) ? Math.max(0, home - solar) : null;
  values[6] = number(solar) && number(home) ? Math.max(0, solar - home) : null;
  integrate({t:t, values:values});
  upload();
}
function collectDevice(index, values) {
  if (index >= devices.length) { finishRead(values); return; }
  let d = devices[index], gen = d.detected || (d.gen === "1" ? "1" : "2");
  let url = "http://" + d.ip + (gen === "1" ? "/status" : "/rpc/Shelly.GetStatus");
  Shelly.call("HTTP.GET", {url:url, timeout:3}, function(result, code) {
    if ((!result || code !== 0 || result.code !== 200) && d.gen === "auto" && !d.detected && gen === "2") {
      d.detected = "1"; collectDevice(index, values); return;
    }
    let status = null;
    if (code === 0 && result && result.code === 200) {
      try { status = JSON.parse(result.body); } catch (e) { print("Reponse illisible : " + d.ip); }
      if (status && !status.error) d.detected = gen;
    }
    for (let i = 0; i < CFG.meters.length; i++) {
      let m = CFG.meters[i];
      if (m.ip === d.ip) { let p = readPower(status, m.channel); values[i] = number(p) ? p * (m.invert ? -1 : 1) : null; }
    }
    collectDevice(index + 1, values);
  });
}
function acknowledge(result, code, sent, id, redirects) {
  // ContentService may respond with a 302; fetch only its trusted output URL.
  if (code === 0 && result && result.code >= 300 && result.code < 400 && redirects < 3) {
    let loc = result.headers ? (result.headers.location || result.headers.Location) : null;
    if (loc && loc.indexOf("https://script.googleusercontent.com/") === 0) {
      Shelly.call("HTTP.GET", {url:loc, timeout:12}, function(r, c) { acknowledge(r, c, sent, id, redirects + 1); }); return;
    }
  }
  sending = false;
  let ack = null;
  if (code === 0 && result && result.code === 200) { try { ack = JSON.parse(result.body); } catch (e) {} }
  if (ack && ack.ok === true && ack.batch === id) {
    // Remove by minute ID: safe even if an extended outage overflowed the queue while sending.
    let keep = [];
    for (let i = 0; i < queue.length; i++) { let found = false; for (let j = 0; j < sent.length; j++) if (queue[i].t === sent[j].t) found = true; if (!found) keep.push(queue[i]); }
    queue = keep;
    print("Google OK, minutes : " + sent.length + ", attente : " + queue.length + ", perdues : " + dropped);
  } else print("Google non confirme. Lot conserve pour nouvel essai.");
}
function upload() {
  let t = now();
  if (!t || sending || !queue.length || t - lastAttempt < 300000) return;
  lastAttempt = t; sending = true;
  let batch = []; for (let i = 0; i < queue.length && i < 10; i++) batch.push(queue[i]);
  let id = String(batch[0].t) + "-" + String(batch[batch.length - 1].t);
  let body = JSON.stringify({action:"ingest", token:CFG.token, batch:id, rows:batch});
  Shelly.call("HTTP.POST", {url:CFG.url, body:body, content_type:"application/json", timeout:12}, function(r, c) { acknowledge(r, c, batch, id, 0); });
}
function sample() { if (reading || !now()) return; reading = true; collectDevice(0, [null,null,null,null,null,null,null]); }
function start() {
  if (!CFG.confirmed || (CFG.topology !== "grid" && CFG.topology !== "load") || CFG.url.indexOf("https://script.google.com/macros/s/") !== 0 || CFG.token.length < 24) {
    print("Configurer confirmed, topology, URL et WRITE_TOKEN avant demarrage."); return;
  }
  for (let i = 0; i < CFG.meters.length; i++) {
    let m = CFG.meters[i]; if (m.key !== NAMES[i]) { print("Conserver l'ordre des cinq mesures."); return; }
    let found = false;
    for (let j = 0; j < devices.length; j++) if (devices[j].ip === m.ip) { found = true; if (devices[j].gen !== m.gen) { print("Generations incoherentes pour une meme IP."); return; } }
    if (!found) devices.push({ip:m.ip, gen:m.gen, detected:null});
    for (let j = 0; j < i; j++) if (CFG.meters[j].ip === m.ip && CFG.meters[j].channel === m.channel) { print("Canal affecte deux fois."); return; }
  }
  lastAttempt = now() || 0;
  Timer.set(5000, true, sample); sample();
  print("Collecteur actif. Garder un seul collecteur ; aucun relais commande.");
}
start();
