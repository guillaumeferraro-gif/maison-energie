(function(root){
  'use strict';
  const METRICS=['solar','home','pool','heatpump','waterheater','import','export'];
  const ZONE='Europe/Paris';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function meter(s,channel){
    if(!s||!Number.isInteger(channel))return null;
    const a=s.emeters?.[channel]||s.meters?.[channel];
    if(a)return a.is_valid===false||a.errors?.length||!finite(a.power)?null:a.power;
    for(const prefix of ['em1','switch','pm1']){
      const c=s[prefix+':'+channel];
      if(c){const p=c.act_power??c.apower;return c.errors?.length||!finite(p)?null:p;}
    }
    return null;
  }
  function flows(solar,reading,topology){
    const knownSolar=finite(solar)&&solar>=-10?Math.max(0,solar):null;
    const knownHome=topology==='load'&&finite(reading)&&reading>=-10?Math.max(0,reading):null;
    if(knownSolar===null||!finite(reading)||!['load','grid'].includes(topology))return {solar:knownSolar,home:knownHome,import:null,export:null,self:null};
    solar=Math.max(0,solar);
    let home=topology==='grid'?solar+reading:reading;
    if(home < -10)return {solar,home:null,import:null,export:null,self:null};
    home=Math.max(0,home);
    const grid=home-solar;
    return {solar,home,import:Math.max(0,grid),export:Math.max(0,-grid),self:Math.min(home,solar)};
  }
  function parts(t){
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t));
    const g=k=>p.find(x=>x.type===k).value;
    return {year:+g('year'),month:+g('month'),day:+g('day'),date:g('year')+'-'+g('month')+'-'+g('day')};
  }
  function key(t,g){
    if(['minute','quarter','hour'].includes(g)){const ms={minute:60000,quarter:900000,hour:3600000}[g];return String(Math.floor(t/ms)*ms);}
    const p=parts(t);return g==='day'?p.date:g==='month'?p.date.slice(0,7):String(p.year);
  }
  function aggregate(rows,g){
    const out=new Map();
    for(const row of rows){
      const k=key(row.t,g);
      if(!out.has(k))out.set(k,{key:k,t:row.t,wh:Array(7).fill(0),seconds:Array(7).fill(0)});
      const b=out.get(k);b.t=Math.min(b.t,row.t);
      for(let i=0;i<7;i++)if(finite(row.wh[i])&&finite(row.seconds[i])&&row.seconds[i]>0){b.wh[i]+=row.wh[i];b.seconds[i]+=row.seconds[i];}
    }
    return [...out.values()].sort((a,b)=>a.t-b.t).map(b=>({...b,wh:b.wh.map((w,i)=>b.seconds[i]?w:null)}));
  }
  // Midnight in Paris, including CET/CEST. Search avoids the host machine's timezone.
  function midnight(date){
    const target=date+'T00:00:00';let t=Date.parse(target+'Z');
    for(let n=0;n<3;n++){
      const p=new Intl.DateTimeFormat('sv-SE',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(t));
      t+=Date.parse(target+'Z')-Date.parse(p.replace(' ','T')+'Z');
    }return t;
  }
  function dayShift(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
  function range(date,g){
    const p=date.split('-').map(Number);let start=date,end=dayShift(date,1);
    if(g==='day'){start=date.slice(0,7)+'-01';end=new Date(Date.UTC(p[0],p[1],1)).toISOString().slice(0,10);}
    if(g==='month'){start=p[0]+'-01-01';end=(p[0]+1)+'-01-01';}
    if(g==='year'){start=(p[0]-4)+'-01-01';end=(p[0]+1)+'-01-01';}
    return {from:midnight(start),to:midnight(end)};
  }
  function buckets(date,g,hour=12){
    let {from,to}=range(date,g);const out=[];
    if(g==='minute'){from+=hour*3600000;to=Math.min(to,from+3600000);}
    if(['minute','quarter','hour'].includes(g)){
      const step={minute:60000,quarter:900000,hour:3600000}[g];
      for(let t=from;t<to;t+=step)out.push({key:key(t,g),t,duration:(Math.min(to,t+step)-t)/1000});
    }else{
      let d=new Date(from+12*3600000);let dateKey=parts(d).date;
      while(midnight(dateKey)<to){
        let next;
        if(g==='day')next=dayShift(dateKey,1);
        else if(g==='month'){const p=dateKey.split('-').map(Number);next=new Date(Date.UTC(p[0],p[1],1)).toISOString().slice(0,10);}
        else next=(+dateKey.slice(0,4)+1)+'-01-01';
        const t=midnight(dateKey);out.push({key:key(t,g),t,duration:(midnight(next)-t)/1000});dateKey=next;
      }
    }return out;
  }
  function integrate(previous,current,accumulate,maxGap=15000){
    if(!previous||current.t<=previous.t||current.t-previous.t>maxGap)return;
    let t=previous.t;
    while(t<current.t){const minute=Math.floor(t/60000)*60000,end=Math.min(current.t,minute+60000),seconds=(end-t)/1000;
      for(let i=0;i<7;i++)if(finite(previous.values[i])&&finite(current.values[i])){
        const delta=current.values[i]-previous.values[i],span=current.t-previous.t;
        const startW=previous.values[i]+delta*(t-previous.t)/span,endW=previous.values[i]+delta*(end-previous.t)/span;
        accumulate(minute,i,(startW+endW)/2*seconds/3600,seconds);
      }
      t=end;
    }
  }
  const api={METRICS,ZONE,finite,meter,flows,parts,key,aggregate,midnight,dayShift,range,buckets,integrate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.Energy=api;
})(typeof globalThis!=='undefined'?globalThis:this);
