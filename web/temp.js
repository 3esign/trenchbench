
window.onerror = function(msg, url, line, col, error) {
  alert("GLOBAL ERROR:\n" + msg + "\nLine: " + line + "\nCol: " + col + "\nStack: " + (error ? error.stack : ''));
};
const $=s=>document.querySelector(s), cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const money=x=>'$'+(Math.abs(x)>=1e6?(x/1e6).toFixed(2)+'M':Math.abs(x)>=1e3?(x/1e3).toFixed(1)+'K':(+x).toFixed(0));
const money2=x=>'$'+(+x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}), pct=x=>(x>=0?'+':'')+(+x).toFixed(2)+'%';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

const MODEL_COLORS={
  qwen:'#14F195', llama:'#2a78d6', deepseek:'#eb6834', mistral:'#1baf7a',
  gemma:'#eda100', phi:'#e87ba4', nemotron:'#008300', claude:'#4a3aa7',
  gpt:'#e34948', rules:'#666e77', dice:'#778899', vault:'#444444'
};
function modelColor(m){
  if(!m)return '#666e77';
  const str=String(m).toLowerCase();
  for(const[k,col] of Object.entries(MODEL_COLORS)){ if(str.includes(k))return col; }
  let hash=0; for(let i=0;i<str.length;i++) hash=str.charCodeAt(i)+((hash<<5)-hash);
  return `hsl(${Math.abs(hash)%360},65%,52%)`;
}
function short(m){
  if(!m)return '—';
  let s=String(m).replace(/^baseline:/i,'').replace(/:latest$/i,'').replace(/:\w+$/,'');
  if(s.toLowerCase().includes('qwen')) return 'Qwen 2.5';
  if(s.toLowerCase().includes('llama')) return 'Llama 3.1';
  if(s.toLowerCase().includes('deepseek')) return 'DeepSeek R1';
  if(s.toLowerCase().includes('mistral')) return 'Mistral 7B';
  if(s.toLowerCase().includes('gemma')) return 'Gemma 2';
  if(s.toLowerCase().includes('nemotron')) return 'Nemotron';
  return s.length>14?s.slice(0,12)+'…':s;
}
const AGENTS={
  val:   ['Value Val','--a1','<b>Value Val</b><br>Buys Memecoins trading below their own recent average, and waits. Slowest hand at the table.<br><i>Takes profit at +10%, cuts at -7%, holds up to 5 positions.</i>'],
  mom:   ['Momentum Mia','--a2','<b>Momentum Mia</b><br>Buys whatever is already rising hardest and rides it. Brilliant in a trend, punished the moment one breaks.<br><i>Takes profit at +12%, cuts at -5%, holds up to 4.</i>'],
  degen: ['Degen Dex','--a3','<b>Degen Dex</b><br>Chases the loudest memecoin on the board. Highest risk appetite of the eight and the widest outcomes.<br><i>Takes profit at +25%, cuts at -15%, holds up to 4.</i>'],
  contra:['Contrarian Cole','--a4','<b>Contrarian Cole</b><br>Buys the biggest faller, betting the drop overshot. Catches real bottoms and falling knives in roughly equal measure.<br><i>Takes profit at +9%, cuts at -9%, holds up to 5.</i>'],
  mrev:  ['Mean-Reverter Mara','--a5','<b>Mean-Reverter Mara</b><br>Fades anything stretched far from its own average, in either direction. Assumes extremes snap back.<br><i>Takes profit at +7%, cuts at -8%, holds up to 5.</i>'],
  index: ['Index Ivy','--a6','<b>Index Ivy</b><br>Spreads small amounts across Memecoins rather than picking. The closest thing here to just holding the market.<br><i>Takes profit at +6%, cuts at -5%, holds up to 8.</i>'],
  event: ['Event Nia','--a7','<b>Event Nia</b><br>Waits for a violent move in either direction and jumps on it. Trades rarely, then all at once.<br><i>Takes profit at +14%, cuts at -10%, holds up to 4.</i>'],
  rand:  ['Random Randy','--a8','<b>Random Randy</b><br>Flips a coin. He is the control — deliberately given no exit discipline at all, because the other seven are only meaningful measured against pure chance.<br><i>No take-profit, no stop-loss.</i>']};
const acolor=id=>cssv((AGENTS[id]&&AGENTS[id][1])||'--a1'), aname=id=>(AGENTS[id]&&AGENTS[id][0])||id;
const adesc=id=>(AGENTS[id]&&AGENTS[id][2])||'';
const SUPA='https://jydrysrqfqdpadnljnbk.supabase.co', ANON='sb_publishable_abJ2zefe3e5875inLIScHg_twk-mTms';
async function q(p){const r=await fetch(`${SUPA}/rest/v1/${p}`,{headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});if(!r.ok)throw new Error(r.status+' '+p);return r.json()}
async function qTry(a,b){ try{ return await q(a); }catch(e){ if(!b)return null; try{ return await q(b); }catch(e2){ return null; } } }
function mchip(m){if(!m)return'';const c=modelColor(m);return`<span class="mchip" style="border-color:${c}66;color:${c};background:${c}12" data-tip="Model: <b>${m}</b>">${short(m)}</span>`}
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

const S={ list:[], timer:null, lastTick:0, lastDecs:0, lastSess:null, px:{}, beats:0 };

// A visible heartbeat. The page polls whether or not a session is running, so
// starting one from your machine shows up here within a couple of seconds — no
// reload. Every line is something that actually happened, not decoration.
const P=$('#pulse');
function pulse(text, cls='d'){
  const d=new Date(), t=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  const row=document.createElement('div');
  row.className='row new';
  row.innerHTML=`<span class="t">${t}</span><span class="${cls}">${text}</span>`;
  P.appendChild(row);
  while(P.querySelectorAll('.row').length>6) P.querySelector('.row').remove();
  P.classList.add('beat'); setTimeout(()=>P.classList.remove('beat'),500);
}
function pulseState(txt, live){ 
  $('#pulsestate').textContent=txt; 
  P.classList.toggle('idle',!live); 
  document.title = (live?'🟢 ':'') + 'Trench Bench — ' + txt;
}
pulse('connecting to the arena…');

// ---------- hover explanations ----------
const TIPS={
  hit:'<b>Hit rate</b><br>Share of this agent\'s <i>trades</i> that beat the market over the next few rounds. Holds are not counted — they outnumber trades about ten to one and would drown the signal.<br><br>An agent can have a high hit rate and still lose money: right often, wrong when it mattered. That gap is the interesting part.',
  pnl:'<b>P&L</b><br>Percentage change from the money the agent started with. Every agent starts on the same capital, so these are directly comparable.',
  avgpnl:'<b>Average P&L</b><br>Mean return across every counted session. Read it next to <b>Runs</b> — an average over one session is not a ranking.',
  runs:'<b>Runs</b><br>How many counted sessions this average is built from. Sessions too short for a full outcome horizon never count.',
  agentsplayed:'<b>Agents played</b><br>How many different strategies this model has run. The pairing rotates every session, so this climbs toward 8 — that is what stops "best model" from secretly meaning "best strategy".',
  modelsplayed:'<b>Models played</b><br>How many different models have run this strategy, and in what proportion. The coloured bar shows the split.',
  pairing:'<b>Pairing effect</b><br>How far this model+strategy combination beats that model\'s own overall average.<br><br>Positive means the strategy genuinely suits that brain, rather than the model just being good at everything.',
  counted:'<b>Counted sessions</b><br>Only sessions long enough for a full outcome horizon can move these rankings. Short runs are still saved and viewable — they just do not get a vote.',
  started:'<b>Starting capital</b><br>Every agent starts on the same amount, so returns compare cleanly. Previously this was randomised, which quietly barred low-capital agents from expensive tokens.',
  moneyleft:'<b>Money left</b><br>Cash plus the current market value of everything the agent is holding. Fall below 2% of the starting capital and the agent is eliminated.',
  mix:'<b>Decision mix</b><br>The proportion of this agent\'s calls that were buys, sells and holds. A bar that is almost all green means an agent that bought and never took profit.',
  tokenpnl:'<b>Realised P&L</b><br>Money actually locked in on round-trips that closed on this token, priced FIFO. Open positions are not counted — this is settled money only.',
  calls:'<b>Calls</b><br>How many scored decisions involved this token.',
  market:'<b>Session move</b><br>Each token shaded against its own price when the session opened. Shading depth scales to how much this session moved, so the strip reads the same on a quiet day or a wild one.',
  career:'<b>Career balance</b><br>A notional $100,000 compounded through every counted session this model or strategy has played.<br><br>Each session still trades from equal capital, so returns stay comparable — the career line is those returns multiplied together. Nobody ever gets more buying power than anyone else.',
  brain:'<b>Which brain answered</b><br>If a cloud model does not reply in time the rule brain covers that round so the session keeps moving. Those calls are recorded separately and are <i>not</i> counted toward that model hit rate.',
  race:'<b>The race</b><br>Each line is one agent\'s total worth over the session. Faded lines are agents that were eliminated.',
  grads:'<b>Raydium Migrations</b><br>How many of this agent\'s picks successfully migrated to Raydium during the session. Graduation multiplies their score on the board.'
};
(function(){
  const tip=document.createElement('div'); tip.className='tip'; document.body.appendChild(tip);
  const place=e=>{ const r=tip.getBoundingClientRect(); let x=e.clientX+14, y=e.clientY+16;
    if(x+r.width>innerWidth-8) x=Math.max(8,e.clientX-r.width-14);
    if(y+r.height>innerHeight-8) y=Math.max(8,e.clientY-r.height-14);
    tip.style.left=x+'px'; tip.style.top=y+'px'; };
  document.addEventListener('mouseover',e=>{ const t=e.target.closest&&e.target.closest('[data-tip]'); if(!t)return;
    tip.innerHTML=TIPS[t.dataset.tip]||t.dataset.tip; tip.style.display='block'; place(e); });
  document.addEventListener('mousemove',e=>{ if(tip.style.display==='block') place(e); });
  document.addEventListener('mouseout',e=>{ if(e.target.closest&&e.target.closest('[data-tip]')) tip.style.display='none'; });
  document.addEventListener('scroll',()=>{ tip.style.display='none'; },true);
  window.addEventListener('blur',()=>{ tip.style.display='none'; });
  document.addEventListener('mouseleave',()=>{ tip.style.display='none'; });
})();

// ---------- one stable colour per model ----------
const MPAL=['#3b6fd4','#e2762c','#12a594','#b45cd6','#d9a300','#d84a63','#5a7d2a','#7a6ff0','#0f7fa8','#a6572b'];
const MCOL={};
// hashed, so a model keeps the same colour everywhere and across reloads
function modelColor(m){ if(!m) return '#8b9199'; if(MCOL[m]) return MCOL[m];
  let h=0; for(let i=0;i<m.length;i++) h=(h*31+m.charCodeAt(i))>>>0;
  return MCOL[m]=MPAL[h%MPAL.length]; }
const short=m=>String(m||'').replace(/:cloud$/,'').replace(/-cloud$/,'');

// Plotted against TICK, never against array position. When each series was
// drawn by index, a series missing one point had every later point shifted left
// by one round, so two agents' "final" dots were being compared at different
// moments — which is how the chart and the standing table ended up publicly
// disagreeing about who was ahead.
let _lastSeries = [];
let _raceRo = new ResizeObserver(() => {
  if (_lastSeries && _lastSeries.length) raceChart(_lastSeries);
});
_raceRo.observe(document.getElementById('racechart'));

function raceChart(series){
  _lastSeries = series;
  const el = $('#racechart');
  let W=el.clientWidth||620, H=el.clientHeight||385;
  const L=48,R=62,T=12,B=22;
  // Normalize series to percentage return relative to starting capital
  const normSeries = series.map(s => {
    const base = s.start > 0 ? s.start : (s.pts[0] ? s.pts[0].v : 1);
    return {
      id: s.id,
      name: s.name,
      start: s.start,
      pts: s.pts.map(p => ({
        t: p.t,
        v: ((p.v - base) / base) * 100
      }))
    };
  });

  let mn=Infinity,mx=-Infinity,t0=Infinity,t1=-Infinity;
  normSeries.forEach(s=>s.pts.forEach(p=>{if(p.v<mn)mn=p.v;if(p.v>mx)mx=p.v;if(p.t<t0)t0=p.t;if(p.t>t1)t1=p.t}));
  if(!isFinite(mn)){$('#racechart').innerHTML='<div class="empty">no equity yet</div>';return}
  if(mn===mx){mn*=.98;mx*=1.02} if(t1===t0)t1=t0+1;
  const pad = Math.max(1.0, (mx - mn) * 0.05);
  mn -= pad; mx += pad;

  const x=t=>L+((t-t0)/(t1-t0))*(W-L-R),y=v=>T+(1-(v-mn)/(mx-mn))*(H-T-B);
  let g='';for(let k=0;k<=4;k++){const v=mn+(mx-mn)*k/4,yy=y(v);g+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="${cssv('--grid')}" stroke-dasharray="4 4" opacity="0.7"/><text x="${L-6}" y="${yy+3}" text-anchor="end" fill="${cssv('--muted')}" font-size="10" font-weight="500">${v>=0?'+':''}${v.toFixed(1)}%</text>`}
  
  const isOut=s=>{const last=s.pts[s.pts.length-1].v; return last<=-98};
  normSeries.forEach(s=>{const col=acolor(s.id),pts=s.pts.map(p=>`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');g+=`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="${isOut(s)?.25:1}"/>`});
  
  const ends=normSeries.map(s=>({s,p:s.pts[s.pts.length-1]})).sort((a,b)=>b.p.v-a.p.v);
  let prev=-1e9; ends.forEach(e=>{ let yy=clamp(y(e.p.v),T+5,H-B); if(yy-prev<12) yy=prev+12; prev=yy; e.lab=yy; });
  ends.forEach((e,i)=>{const col=acolor(e.s.id);g+=`<circle cx="${x(e.p.t)}" cy="${clamp(y(e.p.v),T+4,H-B)}" r="${i===0?4.5:3.5}" fill="${col}" opacity="${isOut(e.s)?.25:1}"/><text x="${W-R+7}" y="${e.lab+3}" fill="${i===0?cssv('--ink'):cssv('--ink2')}" font-size="${i===0?11:10}" font-weight="${i===0?'600':'400'}">${(e.s.name.split(' ')[1]||e.s.name)}</text>`});
  $('#racechart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">${g}</svg>`;
}

let _bt=null, _btTime=0;
async function bhTokens(mints=[]){ if(!mints.length)return {}; if(_bt && (Date.now()-_btTime<3000)) return _bt; try{ const r=await fetch('https://api.dexscreener.com/latest/dex/tokens/'+mints.join(',')); const j=await r.json(); const m={}; for(const p of (j.pairs||[])){ const a=String(p.baseToken.address||'').toLowerCase(); if(!a)continue; m[a]={price:p.priceUsd?parseFloat(p.priceUsd):null, addr:a}; } _bt=m; _btTime=Date.now(); return m; }catch(e){ return _bt||{}; } }

async function loadList(){
  S.list = await qTry('sessions?select=id,name,status,started_at,stopped_at,memecoins,tokens&order=started_at.desc&limit=1',
                      'sessions?select=id,name,status,started_at,stopped_at,memecoins&order=started_at.desc&limit=1') || [];
}

async function render(){
  try{
    if(!S.list.length) await loadList();
    const sess=S.list[0];
    if(!sess){ $('#statustxt').textContent='no sessions yet'; $('#pill').classList.remove('live');
      $('#racechart').innerHTML='<div class="hero">No session running right now. The most recent completed session appears here — <b>agents, models, and the survival race.</b></div>';
      ['tape','heat','gModels','gAgents','gTokens'].forEach(i=>{const e=$('#'+i);if(e)e.innerHTML=''});
      $('#lbbody').innerHTML='<tr><td class="empty" colspan="5">no session yet</td></tr>';
      pulseState('idle · no sessions yet', false);
      clearTimeout(S.timer); S.timer=setTimeout(()=>{S.list=[];render()},8000); return; }

    // status alone is not enough: if the runner is killed before it can mark the
    // session stopped, the row stays "running" forever and the site claims to be
    // live over a dead session. Trust the data, not the flag.
    S.pendingLive = sess.status==='running';
    if(S.lastSess!==sess.id){
      if(S.lastSess) pulse(`new session detected — ${sess.name||sess.id.slice(0,8)}`,'g');
      else pulse(`watching ${sess.name||'session'} · ${S.pendingLive?'running':'stopped'}`,'g');
      S.lastSess=sess.id; S.lastTick=0; S.lastDecs=0; S.px={};
    }
    const id=sess.id;

    const decs=await q(`decisions?session_id=eq.${id}&select=tick,ts,agent_id,agent_name,model,start_cash,action,sym,qty,price,comment,equity&order=tick.desc&limit=300`);
    const lastTs=decs.reduce((mx,d)=>{const t=d.ts?Date.parse(d.ts):0;return t>mx?t:mx},0);
    const quietFor=lastTs?Math.round((Date.now()-lastTs)/1000):null;
    const stale=S.pendingLive && quietFor!=null && quietFor>90;
    const live=S.pendingLive && !stale;
    if(stale && !S.saidStale){ pulse(`no new decisions for ${Math.round(quietFor/60)} min — treating this session as finished`,'w'); S.saidStale=true; }
    if(!stale) S.saidStale=false;
    $('#pill').classList.toggle('live',live);
    $('#statustxt').textContent=(live?'live · ':stale?'ended · ':'stopped · ')+(sess.name||'session');
    $('#curh3').innerHTML=(live?'Current session':'Latest session')+' — the race<span class="scope one">this session</span>';
    $('#standingtitle').innerHTML=(live?'Standing right now':'Final standing')+'<span class="scope one">this session</span>';
    $('#racesub').textContent=(live?'live equity ':'equity ')+'of every agent, tick by tick · each agent runs one model';
    pulseState(live?'live · processing':stale?'session ended':'idle · waiting for a session', live);
    const maxTick=decs.length?Math.max(...decs.map(d=>+d.tick||0)):0;
    if(maxTick>S.lastTick){
      const fresh=decs.filter(d=>+d.tick>S.lastTick);
      const acts=fresh.filter(d=>d.action!=='HOLD');
      pulse(`round ${maxTick} · ${fresh.length} decisions in · ${acts.length} trade${acts.length===1?'':'s'}`, acts.length?'g':'d');
      for(const d of acts.slice(0,3)) pulse(`   ${d.agent_name} ${d.action} ${d.qty>=1?Math.round(d.qty):d.qty} ${d.sym} — ${d.comment||''} [${short(d.model||'')}]`, d.action==='BUY'?'g':'w');
      S.lastTick=maxTick; S.quiet=0;
    } else if(live){
      S.quiet=(S.quiet||0)+1;
      if(S.quiet%8===0) pulse(`still watching · last activity ${quietFor}s ago`,'d');
    }
    // ---- ONE source of truth for "how much money does each agent have" ----
    // This used to be read from the last decision row per agent while the chart
    // below read equity_points, so the two panels were sampling different
    // instants and publicly disagreed about who was first. Now the chart data
    // is fetched first and the standing is derived from the same array.
    // Order of preference: the runner's own final report > the equity curve >
    // the last decision. Never two of them at once.
    const eq=await q(`equity_points?session_id=eq.${id}&select=agent_id,tick,value&order=tick.desc&limit=8000`);
    const byA={}; for(const e of eq){ const a=(byA[e.agent_id]=byA[e.agent_id]||[]); a.push({t:+e.tick,v:+e.value}); }
    for(const k in byA) byA[k].sort((a,b)=>a.t-b.t);
    const fin=await qTry(`agent_reports?session_id=eq.${id}&select=agent_id,agent_name,model,start_cash,end_value,ret,hit_rate`,`agent_reports?session_id=eq.${id}&select=agent_id`);
    const hitBy={},finBy={}; for(const r of (fin||[])){ hitBy[r.agent_id]=r.hit_rate; finBy[r.agent_id]=r; }
    // every agent that has appeared at all this session, so a busted agent that
    // stopped writing decisions cannot silently drop out of the table while its
    // line stays on the chart
    const seen={}; for(const d of decs) if(!seen[d.agent_id]) seen[d.agent_id]=d;
    for(const k in byA) if(!seen[k]) seen[k]={agent_id:k,agent_name:aname(k),model:'',start_cash:null,equity:null};
    const reps=Object.values(seen).map(d=>{
      const f=finBy[d.agent_id], curve=byA[d.agent_id];
      const start=+((f&&f.start_cash)||d.start_cash)||null;
      const end = f&&f.end_value!=null ? +f.end_value
                : curve&&curve.length ? curve[curve.length-1].v
                : (d.equity!=null?+d.equity:null);
      return {agent_id:d.agent_id, agent_name:(f&&f.agent_name)||d.agent_name||aname(d.agent_id),
              model:(f&&f.model)||d.model, start_cash:start, end_value:end,
              // a missing start_cash used to coerce to 1 and print +2,499,900%
              ret: (start>0&&end!=null) ? (f&&f.ret!=null?+f.ret:(end/start-1)*100) : null};
    }).filter(r=>r.end_value!=null);

    // ---- market strip ----
    const toks=(Array.isArray(sess.tokens)&&sess.tokens.length)?sess.tokens:(sess.memecoins||[]).map(s=>({sym:s}));
    const mints=toks.map(t=>t.addr).filter(Boolean);
    const bt=await bhTokens(mints); 
    const lastPx={}; for(const d of decs){ if(d.sym&&!lastPx[d.sym])lastPx[d.sym]=+d.price; }
    const firstPx={}; for(let i=decs.length-1; i>=0; i--){ const d=decs[i]; if(d.sym&&!firstPx[d.sym])firstPx[d.sym]=+d.price; }
    
    const tiles=toks.map(t=>{ const info=bt[String(t.addr||'').toLowerCase()]||{};
      const q=!!t.quarantined;
      const px=(info.price!=null?info.price:(t.last||lastPx[t.sym]||info.price))||0;
      const open=(+t.open)||(firstPx[t.sym]||t.seed||px)||null;
      return {sym:t.sym,live:px,chg:q?null:((open>0&&px>0)?((px/open-1)*100):null),addr:t.addr||info.addr,fresh:!!t.fresh,isMigrated:!!t.isMigrated,tier:t.tier||'growth',q};
    }).sort((a,b)=>(a.q-b.q)||((b.chg==null?-1e9:b.chg)-(a.chg==null?-1e9:a.chg)));
    const mags=tiles.filter(t=>t.chg!=null).map(t=>Math.abs(t.chg)).sort((a,b)=>a-b);
    const ref=Math.max(0.4,(mags[Math.floor(mags.length*.8)]||1));
    $('#heat').innerHTML=tiles.map(t=>{
      const url=t.addr?('https://pump.fun/coin/'+t.addr):('https://pump.fun/board?q='+encodeURIComponent(t.sym));
      const pxt=t.live?(t.live>=1?'$'+t.live.toFixed(2):'$'+(+t.live).toPrecision(3)):'on chain';
      let st='';
      if(t.chg!=null){ const k=Math.sqrt(Math.min(1,Math.abs(t.chg)/ref)),a=(.05+k*.27).toFixed(3),rgb=t.chg>=0?'0,168,31':'224,54,44';
        st=`background:rgba(${rgb},${a});border-color:rgba(${rgb},${(.18+k*.5).toFixed(2)});`; }
      const chgTxt=t.q?'<span class="dim" data-tip="This token\'s price could not be trusted this session, so it was delisted mid-run: trading frozen, any position held at what the agent paid, and every decision on it excluded from scoring.">held</span>':(t.chg==null?'—':pct(t.chg));
      return `<a class="htile${t.q?' hqt':''}" style="${st}" href="${url}" target="_blank" rel="noopener"><div class="hs">${t.sym}${t.isMigrated?'<span class="fresh" style="color:var(--brand)" data-tip="Raydium Graduate">🎓</span>':''}${t.fresh?'<span class="fresh" data-tip="Fresh Listing">✦</span>':''}${t.q?'<span class="fresh" style="color:var(--muted)">⚑</span>':''}</div><div class="hp tnum">${pxt}</div><div class="hc tnum ${t.q?'':t.chg==null?'':t.chg>=0?'up':'down'}">${chgTxt}</div></a>`;
    }).join('')||'<div class="empty">—</div>';
    
    const nUp=tiles.filter(t=>t.chg>0).length,nDn=tiles.filter(t=>t.chg<0).length,
          nFlat=tiles.filter(t=>t.chg===0).length,nQ=tiles.filter(t=>t.q).length,
          nNo=tiles.length-nUp-nDn-nFlat-nQ;
    $('#marketsub').innerHTML=`${tiles.length} tokens · <span class="up">${nUp} up</span> · <span class="down">${nDn} down</span> · ${nFlat} unchanged`
      +(nNo?` · ${nNo} not priced yet`:'')+(nQ?` · <span title="delisted mid-session">${nQ} held</span>`:'')
      +' · measured from session open';

    // ---- standing under the chart ----
    const isOut=r=>r.start_cash>0 && r.end_value < r.start_cash*.02;
    const rr=[...reps].sort((a,b)=>(isOut(a)-isOut(b))||(b.ret-a.ret)||String(a.agent_id).localeCompare(String(b.agent_id)));
    const decided=!live&&!stale, canCrown=decided&&sess.counted!==false;
    
    // Tag rule: strictly only index 0 (first place) gets "Win" or "Leading"; all subsequent places get empty tag
    $('#lbbody').innerHTML=rr.map((r,i)=>{const out=isOut(r),first=i===0&&!out,h=hitBy[r.agent_id];
      const tag=!first?'':canCrown?'<span class="tagw win">Win</span>':(live?'<span class="tagw win">Leading</span>':'');
      return`<tr class="${out?'dead':''}" style="border-bottom:0"><td class="rank tnum">${i+1}</td><td><span class="adot" style="background:${acolor(r.agent_id)}"></span><span class="aname">${r.agent_name}</span><span class="mdot hint" data-tip="${r.model||'?'}" style="background:${modelColor(r.model)};margin-left:6px;width:7px;height:7px;border-radius:1px;"></span>${tag}${out?'<span class="tagw out" style="margin-left:6px">Out</span>':''}</td><td class="r tnum">${money2(r.end_value)}</td><td class="r tnum ${r.ret==null?'':r.ret>=0?'up':'down'}">${r.ret==null?'<span class="dim">—</span>':pct(r.ret)}</td><td class="r tnum" style="color:var(--ink2)">${h==null?'<span class="dim">—</span>':(+h).toFixed(0)+'%'}</td></tr>`}).join('')
      ||'<tr><td class="empty" colspan="5">results appear when the session has data</td></tr>';

    // Small inline model legend in middle panel (Standing card)
    const activeModels = new Set(reps.map(r=>r.model).filter(Boolean));
    const legItems = Array.from(activeModels).map(m=>`<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:1.5px;background:${modelColor(m)}"></span>${short(m)}</span>`).join('');
    const mLegEl = $('#mLegendInline');
    if(mLegEl) mLegEl.innerHTML = legItems ? `<span style="color:var(--muted);margin-right:2px">Models:</span> ${legItems}` : '';

    // Update Top Highlights Bar
    const setHL = (id, html) => { const e = $('#'+id); if(e) e.innerHTML = html; };
    if(rr.length && rr[0]){
      const l = rr[0];
      setHL('hlLeader', `<span class="aname" style="color:var(--brand);font-weight:600">${l.agent_name}</span> <span class="${l.ret>=0?'up':'down'}">(${pct(l.ret)})</span>`);
    }

    // ---- race: the SAME byA the standing was built from, keyed by tick ----
    const startBy={}; for(const r of reps) startBy[r.agent_id]=r.start_cash;
    const series=Object.keys(byA).map(k=>({id:k,name:aname(k),pts:byA[k],start:startBy[k]}));
    if(series.length)raceChart(series); else $('#racechart').innerHTML='<div class="empty">equity curve appears as the session runs</div>';

    // ---- tape ----
    const setS=(id,v)=>{const e=$('#'+id); if(e)e.textContent=v;};
    setS('stLive', tiles.filter(t=>!t.q&&t.chg!=null).length||'—');
    setS('stDecisions', (S.totalScored!=null?S.totalScored:decs.length).toLocaleString());
    $('#tapesub').textContent=`${Math.min(decs.length,60)} most recent decisions · newest first`;
    $('#tape').innerHTML=decs.slice(0,60).map(d=>`<div class="trow" style="font-size:11px;padding:4px 0;margin-right:8px;border-bottom:1px solid rgba(255,255,255,0.03)"><span class="adot" data-tip="${adesc(d.agent_id).replace(/"/g,'&quot;')}" style="background:${acolor(d.agent_id)};margin-right:2px"></span><span class="act ${(d.action||'').toLowerCase()}" style="font-weight:600">${d.action}</span>${d.sym?`<span class="sym" style="font-weight:500;margin-left:3px">${d.sym}</span>`:''}<span class="dim" style="margin-left:auto;font-size:10px;white-space:nowrap;opacity:0.8">${short(d.model||'')}</span></div>`).join('')||'<div class="empty">decisions appear as the session runs</div>';

    loadGlobals();
    clearTimeout(S.timer);
    S.timer=setTimeout(()=>{S.list=[];render()}, live?2500:8000);
  }catch(e){
    // never swallow silently — a caught render error looked identical to being
    // offline, twice tonight. Costs nothing in production, saves an hour later.
    console.error('[trenchbench] render failed:', e);
    $('#statustxt').textContent='offline';
    pulseState('reconnecting', false);
    if(!render._warned){ pulse('lost the database — retrying','w'); render._warned=true; }
    clearTimeout(S.timer); S.timer=setTimeout(()=>{S.list=[];render()},6000);
  }
}

// ---------- all-time boards ----------
// The benchmark card: three views over the SAME counted sessions.
//   Models — a model averaged over every persona it has played
//   Agents — a persona averaged over every model that has played it
//   Pairs  — the interaction: how much better this pairing is than that model
//            manages on average, i.e. does this brain suit this strategy
// the runner's round threshold. Kept in one place so the page cannot state a
// rule the runner is not applying — it said 10 while the runner used 30, and
// then labelled every 10-29 round session as "excluded for an untrustworthy price".
const MIN_ROUNDS=30;
const B={view:'models',models:[],agents:[],pairs:[],baselines:[],note:''};
document.querySelectorAll('#btabs .seg').forEach(b=>b.onclick=()=>{
  B.view=b.dataset.b; document.querySelectorAll('#btabs .seg').forEach(x=>x.classList.toggle('active',x===b)); paintBench();
});
function paintBench(){
  const H=B.view==='pairs'?['#','Model × agent','Runs','Avg P&L','Pairing']:['#','Model','Runs','Career','Avg P&L','Hit','Grads'];
  $('#bhead').innerHTML='<tr>'+H.map((h,i)=>`<th class="${i===0?'rank':''}${i>1?' r':''}">${h}</th>`).join('')+'</tr>';
  const rows=B[B.view]||[];
  if(!rows.length){ $('#gModels').innerHTML=`<tr><td class="empty" colspan="${H.length}">no counted sessions yet</td></tr>`; $('#benchnote').innerHTML=B.note; return; }
  $('#gModels').innerHTML=rows.slice(0,8).map((r,i)=>{
    const p=`<td class="r tnum ${r.ret>=0?'up':'down'}">${pct(r.ret)}</td>`;
    if(B.view==='pairs') return `<tr><td class="rank tnum">${i+1}</td><td><span class="adot" style="background:${acolor(r.agent_id)}"></span><span class="aname hint" data-tip="${adesc(r.agent_id).replace(/"/g,'&quot;')}">${r.short}</span><div class="dim" style="font-size:10px">${r.m}</div></td><td class="r tnum dim">${r.n}</td>${p}<td class="r"><span class="eff ${r.eff>=0?'pos':'neg'}">${r.eff>=0?'+':''}${r.eff.toFixed(1)}</span></td></tr>`;
    return `<tr${r.n<2?' style="opacity:.72"':''}><td class="rank tnum">${i+1}</td><td><span class="mdot" style="background:${modelColor(r.m)}"></span><span class="aname">${short(r.m)}</span><div class="dim" style="font-size:10px;margin-left:14px">${r.mods||0} strateg${r.mods===1?'y':'ies'} played${r.n<2?' · <b>n=1, not a result</b>':''}</div></td><td class="r tnum dim">${r.n}</td><td class="r tnum ${r.career>=1e5?'up':'down'}" style="font-weight:600">${money(r.career)}</td>${p}<td class="r tnum" style="color:var(--ink2)">${r.hit==null?'<span class="dim">—</span>':r.hit.toFixed(0)+'%'}</td><td class="r tnum" style="color:var(--ink2)">🚀${r.raydium||0}</td></tr>`;
  }).join('')
  // the reference lines, always last, always visually separate
  + ((B.view==='models'&&B.baselines.length) ? B.baselines.map(r=>
      `<tr class="blrow"><td class="rank tnum dim">·</td><td><span class="aname">${r.m.replace('baseline:','')}</span><span class="bltag" data-tip="A mechanical agent that calls no model. It trades the same menu with the same capital. Every model number should be read against these.">baseline</span><div class="dim" style="font-size:10px">${r.m==='baseline:dice'?'picks at random':r.m==='baseline:vault'?'never trades':'equal weight, then holds'}</div></td><td class="r tnum dim">${r.n}</td><td class="r tnum dim">${money(r.career)}</td><td class="r tnum ${r.ret>=0?'up':'down'}">${pct(r.ret)}</td><td class="r tnum" style="color:var(--ink2)">${r.hit==null?'<span class="dim">—</span>':r.hit.toFixed(0)+'%'}</td><td class="r tnum dim">—</td></tr>`
    ).join('') : '');
  $('#benchnote').innerHTML=B.note+(B.view==='pairs'
    ? ' <br><b>Pairing</b> = how far this combination beats that model\'s own average. Positive means the strategy suits the brain.'
    : ' <br><b>Agents</b> = how many different strategies this model has played. The pairing rotates each session, so this climbs toward 8.'+(B.baselines.length?' <br><b>Baselines</b> call no model at all — they trade the same menu with the same capital. A model that cannot beat <i>picks at random</i> has not demonstrated anything.':''));
}

async function loadGlobals(){
  try{
    // only sessions long enough to be evidence are allowed to rank anything
    // Both queries MUST be ordered. Unordered, PostgREST returns an unspecified
    // 500 rows, so the two windows covered different sets of sessions and the
    // boards ranked on their arbitrary intersection while the note confidently
    // stated an exact session count.
    const srows=await qTry('sessions?select=id,counted,rounds,status,started_at&order=started_at.desc&limit=500','sessions?select=id,started_at&order=started_at.desc&limit=500')||[];
    const countedIds=new Set(srows.filter(s=>s.counted).map(s=>s.id));
    const preMigration=!srows.some(s=>'counted' in s);
    const validSessIds=new Set(srows.filter(s=>s.counted!==false||s.status==='running'||(s.rounds!=null&&s.rounds<MIN_ROUNDS)).map(s=>s.id));
    // A running session is not "too short to count" — it is unfinished. And a
    // session can be excluded for an untrustworthy price rather than for being
    // short, which the note used to report as the same thing.
    const done=srows.filter(s=>s.status!=='running');
    const nShort=done.filter(s=>s.counted===false&&(s.rounds!=null&&s.rounds<MIN_ROUNDS)).length;
    const nBad  =done.filter(s=>s.counted===false&&!(s.rounds!=null&&s.rounds<MIN_ROUNDS)).length;

    const reps0=await qTry('agent_reports?select=agent_id,agent_name,model,ret,hit_rate,session_id,raydium_hits&order=created_at.desc&limit=4000',
                           'agent_reports?select=agent_id,agent_name,model,ret,session_id,raydium_hits&order=created_at.desc&limit=4000') || [];
    const all0=preMigration?reps0:reps0.filter(r=>countedIds.has(r.session_id));
    // A BASELINE IS NOT A MODEL. The three mechanical agents (random pick,
    // never trade, equal-weight-and-hold) ride along in every session on the
    // same capital and the same menu, calling no model. They are what every
    // model number has to be read against — 9% hit rate versus WHAT — so they
    // are shown, but never ranked among the LLMs.
    const isBl=r=>String(r.model||'').startsWith('baseline:');
    const reps=all0.filter(r=>!isBl(r));
    const blReps=all0.filter(isBl);
    // the note must describe the sessions actually USED, not the ones fetched
    const usedIds=new Set(reps.map(r=>r.session_id));

    B.note=preMigration
      ? 'ranking <b>every</b> session, counted or not — <span style="color:var(--brand2)">run supabase/SETUP_FROM_SCRATCH.sql so short runs stop counting</span>'
      : `built from ${usedIds.size} counted session${usedIds.size===1?'':'s'}${nShort?` · ${nShort} too short to count`:''}${nBad?` · ${nBad} excluded for an untrustworthy price`:''}`;
    // if the counted filter isn't actually being applied, no element on the page
    // may claim it is
    if(preMigration) document.querySelectorAll('.scope.all').forEach(e=>e.textContent='all sessions');
    $('#benchsub').innerHTML='each model averaged over every strategy it has played · <span class="hint" data-tip="career">career</span> = $100k compounded';

    // career = a notional $100k compounded through the counted sessions, in order
    const ord={}; srows.filter(x=>x.counted!==false).sort((a,b)=>new Date(a.started_at||0)-new Date(b.started_at||0)).forEach((x,i)=>ord[x.id]=i);
    const CAREER0=100000;
    // ONE gain factor per session. When there are fewer models than personas a
    // model drives two or three agents in the same session and used to be
    // compounded once per agent — so "Runs 1" sat next to a career of $172,800
    // that no single session could have produced. Average within the session
    // first, then compound across sessions.
    const career=rows=>{
      const bySess={}; for(const r of rows){ if(r.ret==null)continue; (bySess[r.session_id]=bySess[r.session_id]||[]).push(+r.ret); }
      return Object.entries(bySess)
        .sort((a,b)=>(ord[a[0]]??0)-(ord[b[0]]??0))
        .reduce((bal,[,rs])=>bal*Math.max(.01,1+avg(rs)/100),CAREER0);   // a -100% run must not pin the ledger at $0 forever
    };
    const grp=(rows,keyf)=>{const o={};for(const r of rows)(o[keyf(r)]=o[keyf(r)]||[]).push(r);return o};
    // ret averaged over rows that HAVE a ret — a null return is missing data,
    // not a flat session, and counting it as 0% quietly drags every average
    const mk=(o,label,extra)=>Object.entries(o).map(([k,a])=>Object.assign({
      m:label(k,a), n:new Set(a.map(x=>x.session_id)).size,
      ret:avg(a.filter(x=>x.ret!=null).map(x=>+x.ret)), hit:avg(a.filter(x=>x.hit_rate!=null).map(x=>+x.hit_rate)), career:career(a),
      raydium:a.reduce((sum,x)=>sum+(parseInt(x.raydium_hits)||0),0)
    },extra?extra(k,a):{})).sort((p,z)=>z.career-p.career);

    // models: how many distinct PERSONAS each has played (rotation coverage)
    B.models=mk(grp(reps,r=>r.model),k=>k,(k,a)=>({mods:new Set(a.map(x=>x.agent_id)).size}));
    B.baselines=mk(grp(blReps,r=>r.model),k=>k,(k,a)=>({mods:new Set(a.map(x=>x.agent_id)).size}));
    // agents: how many distinct MODELS have run each persona
    B.agents=mk(grp(reps,r=>r.agent_id),(k,a)=>a[0].agent_name||k,(k,a)=>({agent_id:k,
      mods:new Set(a.map(x=>x.model)).size,
      byModel:a.reduce((o,x)=>{ o[x.model]=(o[x.model]||0)+1; return o; },{})}));
    $('#gAgents').innerHTML=B.agents.slice(0,8).map((r,i)=>{
      const ent=Object.entries(r.byModel).sort((a,b)=>b[1]-a[1]), tot=ent.reduce((s,[,c])=>s+c,0)||1;
      const bar=ent.map(([m,c])=>`<i style="width:${(c/tot*100).toFixed(1)}%;background:${modelColor(m)}" data-tip="<b>${m}</b><br>ran this strategy ${c} of ${tot} time${tot===1?'':'s'}"></i>`).join('');
      return `<tr style="border-bottom:0"><td class="rank tnum">${i+1}</td><td><span class="adot" style="background:${acolor(r.agent_id)}"></span><span class="aname">${r.m}</span></td><td class="r tnum dim">${r.n}</td><td class="r tnum ${r.career>=1e5?'up':'down'}" style="font-weight:600">${money(r.career)}</td><td class="r tnum ${r.ret>=0?'up':'down'}">${pct(r.ret)}</td><td class="r tnum" style="color:var(--ink2)">${r.hit==null?'<span class="dim">—</span>':r.hit.toFixed(0)+'%'}</td><td class="r tnum" style="color:var(--ink2)">🚀${r.raydium||0}</td></tr>
              <tr><td></td><td colspan="6" style="padding-top:0"><div class="dim" style="font-size:10.5px;padding-bottom:6px">${adesc(r.agent_id)}</div><div class="mixbar" data-tip="modelsplayed">${bar}</div></td></tr>`;
    }).join('')||'<tr><td class="empty" colspan="7">no counted sessions yet</td></tr>';

    const modelAvg={}; for(const r of B.models) modelAvg[r.m]=r.ret;
    B.pairs=Object.entries(grp(reps,r=>r.model+'|'+r.agent_id)).map(([k,a])=>{
      const [m,aid]=k.split('|'), ret=avg(a.filter(x=>x.ret!=null).map(x=>+x.ret));
      return {m,agent_id:aid,short:a[0].agent_name||aid,n:new Set(a.map(x=>x.session_id)).size,ret,hit:avg(a.filter(x=>x.hit_rate!=null).map(x=>+x.hit_rate)),eff:ret-(modelAvg[m]||0)};
    }).sort((p,z)=>z.ret-p.ret);

    if(B.models.length&&B.models.every(r=>r.n<2)) B.note+=' · one run each so far — too little to call this a ranking';
    // the lede stats. Sample size is the argument, so it gets the big type.
    const setStat=(id,v)=>{const e=$('#'+id); if(e)e.textContent=v;};
    setStat('stSessions', usedIds.size||'0');
    setStat('stModels', B.models.length||'0');
    const enough=B.models.length&&B.models.some(r=>r.n>=3);
    const h=$('#honest');
    if(h) h.textContent = !B.models.length
      ? 'No counted sessions yet. Nothing here is a ranking until there are.'
      : enough ? 'Sample size is the whole argument. Read every model against the baselines below — a model that cannot beat a random pick has not shown anything.'
      : `Only ${usedIds.size} counted session${usedIds.size===1?'':'s'} so far. These are not yet rankings, and this page will keep saying so until they are.`;
    
    // Update Highlights Bar metrics from all-time stats
    const setHL = (id, html) => { const e = $('#'+id); if(e) e.innerHTML = html; };
    if(B.models.length && B.models[0]){
      const bm = B.models[0];
      setHL('hlBestModel', `<span class="aname" style="color:var(--ink);font-weight:600"><span style="color:${modelColor(bm.m)}">■</span> ${short(bm.m)}</span> <span class="${(bm.ret||0)>=0?'up':'down'}">(${pct(bm.ret||0)})</span>`);
    }
    if(B.agents.length && B.agents[0]){
      const ba = B.agents[0];
      setHL('hlBestAgent', `<span class="aname" style="color:var(--ink);font-weight:600">${ba.m}</span> <span class="${(ba.ret||0)>=0?'up':'down'}">(${pct(ba.ret||0)})</span>`);
    }
    paintBench();

    // Top tokens used to rank over EVERY session, including the ones the
    // benchmark threw out — so the session that minted $109m out of a bad price
    // was excluded from every other board and still set the token leader.
    const outs=await qTry('decision_outcomes?select=sym,realized_pnl,outcome,session_id&order=session_id.desc&limit=20000');
    if(outs&&outs.length){
      const c={}; for(const o of outs){
        if(!o.sym) continue;
        if(o.outcome==='void') continue;                                   // token was delisted; unscoreable
        if(!preMigration && o.session_id && !validSessIds.has(o.session_id)) continue;  // uncounted session
        const b=c[o.sym]=c[o.sym]||{n:0,pnl:0}; b.n++; b.pnl+=(+o.realized_pnl||0); }
      S.totalScored=Object.values(c).reduce((n,v)=>n+v.n,0);
      const t=Object.entries(c).sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,8);
      const mx=Math.max(1,...t.map(([,v])=>Math.abs(v.pnl)));
      if(t.length && t[0]){
        const [topSym, topVal] = t[0];
        setHL('hlTopToken', `<span class="aname" style="color:${topVal.pnl>=0?'var(--good)':'var(--bad)'};font-weight:600">$${topSym}</span> <span class="${topVal.pnl>=0?'up':'down'}">(${(topVal.pnl>=0?'+':'-')+money(Math.abs(topVal.pnl))})</span>`);
      }
      $('#gtoksub').textContent='which tokens the agents actually made money on';
      $('#gtokcolh').textContent='Realised P&L';
      $('#gTokens').innerHTML=t.map(([s,v],i)=>`<tr><td class="rank tnum">${i+1}</td><td><span class="aname">${s}</span><div class="bar"><i style="width:${(Math.abs(v.pnl)/mx*100).toFixed(0)}%;background:${v.pnl>=0?cssv('--good'):cssv('--bad')}"></i></div></td><td class="r tnum dim">${v.n}</td><td class="r tnum ${v.pnl>=0?'up':'down'}">${(v.pnl>=0?'+':'-')+money(Math.abs(v.pnl))}</td></tr>`).join('')||'<tr><td class="empty" colspan="4">—</td></tr>';
    }else{
      const dd=await q('decisions?select=sym&executed=is.true&sym=not.eq.&order=ts.desc&limit=5000');
      const c={}; for(const x of dd)c[x.sym]=(c[x.sym]||0)+1;
      const t=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,8);
      $('#gtoksub').innerHTML='ranked by how often they were traded — profit ranking appears once outcomes are scored';
      $('#gtokcolh').textContent='Trades';
      $('#gTokens').innerHTML=t.map(([s,n],i)=>`<tr><td class="rank tnum">${i+1}</td><td><span class="aname">${s}</span></td><td class="r tnum dim">—</td><td class="r tnum">${n}</td></tr>`).join('')||'<tr><td class="empty" colspan="4">—</td></tr>';
    }
  }catch(e){
    console.error('[trenchbench] all-time boards failed:', e);
    B.note='could not refresh the all-time boards: ' + e.message;
    $('#gtoksub').textContent='CRASH: ' + e.message + ' ' + (e.stack || '').slice(0, 100);
    paintBench();
  }
}

const mm=$('#methodmodal');
const openM=()=>mm.classList.add('open'), closeM=()=>mm.classList.remove('open');
$('#methodbtn').onclick=openM; $('#methodclose').onclick=closeM;
mm.onclick=e=>{ if(e.target===mm) closeM(); };

const rm=$('#roadmapmodal');
const openRM=()=>rm.classList.add('open'), closeRM=()=>rm.classList.remove('open');
$('#roadmapbtn').onclick=openRM; $('#roadmapclose').onclick=closeRM;
rm.onclick=e=>{ if(e.target===rm) closeRM(); };

document.addEventListener('keydown',e=>{ if(e.key==='Escape') { closeM(); closeRM(); } });
$('#maxbtn').onclick=function(){if(document.fullscreenElement)document.exitFullscreen&&document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen().catch(()=>{});document.body.classList.toggle('maxed');this.textContent=document.body.classList.contains('maxed')?'⤢ Restore':'⛶ Maximize'};
render();
