// ============================================================
//  trenchbench — session runner (runs on your PC)
//  • Real Pump.fun tokens + live prices (PumpPortal + Dexscreener),
//    refreshed during the session. Falls back to simulation only if
//    the feed is unreachable.
//  • Every agent thinks every round, in parallel, via your Ollama models
//    (local + Ollama Cloud) — each call printed so you SEE it, continuously.
//  • Survival game: bust to ~$0 = eliminated; last one holding money wins.
//  Saves locally AND pushes to Supabase. Zero npm installs (Node 21+).
// ============================================================
import fs from 'node:fs';
import crypto from 'node:crypto';
import { LiveFeed } from './feeds.mjs';

const ROOT = new URL('..', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const SUPA = ENV.SUPABASE_URL, ANON = ENV.SUPABASE_ANON_KEY;
// The site ships ANON in public JavaScript, so the database only accepts
// WRITES from the service key — which lives here, in git-ignored config.txt.
const WRITE_KEY = ENV.SUPABASE_SERVICE_KEY || ANON;
const SECONDS = +(ENV.SESSION_SECONDS || 3600);   // a SAFETY CAP, not the plan — Stop ends the session
const CMIN = +(ENV.CAPITAL_MIN || 500), CMAX = +(ENV.CAPITAL_MAX || 100000);
const CAP_MODE = (ENV.CAPITAL_MODE || 'equal').toLowerCase();     // equal | random
const START_CAP = +(ENV.START_CAPITAL || 25000);
const PAIRING = (ENV.PAIRING || 'rotate').toLowerCase();          // rotate | fixed | random
const MAX_JUMP = +(ENV.MAX_PRICE_JUMP || 5);        // a one-poll move bigger than this must be confirmed
const MAX_PLAUSIBLE_RET = +(ENV.MAX_PLAUSIBLE_RETURN || 5000); // % — above this a session is not evidence, it is a glitch
const MIN_ALT_CAP = +(ENV.MIN_PAIRED_CAP || 25000);   // below this a same-ticker contract is dust, not an instrument
// 30, not 10. The outcome horizon is clamped to min(HORIZON, rounds/3), so a
// 10-round session judges every decision over 3 rounds instead of 10 — a
// different measurement wearing the same name, and its edge numbers are not
// comparable with anything else. 30 rounds is the shortest run that gets the
// full horizon.
const MIN_BENCH_ROUNDS = +(ENV.MIN_BENCH_ROUNDS || 5);           // below this, a session does not count
// A token that has not traded in this long is not offered on the menu.
const MENU_ACTIVE_MS = +(ENV.MENU_ACTIVITY_MINUTES || 20) * 60000;
const MIN_MENU_POOL = +(ENV.MIN_MENU_POOL || 15);                  // never starve the menu
const CAREER_START = +(ENV.CAREER_START || 100000);               // the notional bankroll the career ledger compounds
const MAX_MODEL_CALLS = +(ENV.MAX_MODEL_CALLS || 1200);           // HARD ceiling on paid model calls per session
const RUNLOCK = new URL('worker/.running', ROOT);
const OLLAMA = (ENV.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const PINNED = (ENV.OLLAMA_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_MODELS = +(ENV.MAX_MODELS || 8);
// Not one provider — a pool. A keyed endpoint leads while it has quota, then
// the free public ones carry the session rather than ending it. Set RPC_URLS in
// config.txt (comma-separated) to add more.
const PRICE_MODE = (ENV.PRICE_MODE || 'real').toLowerCase();
const NUM_TOKENS = +(ENV.NUM_TOKENS || 40);
const CONTROL = (ENV.CONTROL_TOKENS || 'SOL,USDC,WIF,BONK').split(',').map(s => s.trim()).filter(Boolean);
const MODE = (process.argv[2] || ENV.ROSTER_MODE || 'mixed').toLowerCase();
const FRESH_MIN = +(ENV.FRESH_TOKENS || 6);
const REFRESH_MS = +(ENV.REFRESH_SECONDS || 10) * 1000;
const ROUND_MS = +(ENV.ROUND_MS || 700);
const HORIZON = +(ENV.OUTCOME_HORIZON || 10);   // rounds ahead a decision is judged over
const THINK_MS = +(ENV.THINK_TIMEOUT_MS || 12000); // a slow model must not gate the whole round
const NUM_PREDICT = +(ENV.OLLAMA_NUM_PREDICT || 400);  // reasoning models need room to reach the answer
const DEC_FORMAT = (ENV.DECISION_FORMAT || 'menu').toLowerCase(); // menu | schema | json | line
const MEMORY_ON = (ENV.MEMORY || 'on').toLowerCase() !== 'off';
const MEMORY_DEPTH = +(ENV.MEMORY_DEPTH || 3);   // how many past lessons an agent carries in
let ANALYST_KNOWLEDGE = '';
try { ANALYST_KNOWLEDGE = fs.readFileSync(new URL('logs/analyst_memory.txt', ROOT), 'utf8').trim(); } catch (e) {}
const SKIP_CHECK = (ENV.SKIP_SCHEMA_CHECK || '') === '1';
const STOPFLAG = new URL('worker/.stop', ROOT);

const rnd = (a, b) => a + Math.random() * (b - a);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
function selectRoster(priced, mode) {
  const bySym = {}; for (const t of priced) bySym[t.sym] = t;
  const control = CONTROL.map(x => bySym[x]).filter(Boolean);
  const controlSyms = new Set(control.map(t => t.sym));
  const rest = priced.filter(t => !controlSyms.has(t.sym));

  let ordered;
  if (mode === 'highcap') {
    // Highest market cap tokens first
    const highcapPool = rest.slice().sort((a, b) => b.cap - a.cap);
    ordered = shuffle(highcapPool.slice(0, Math.min(highcapPool.length, NUM_TOKENS * 2)));
  } else if (mode === 'lowcap') {
    // Lowest market cap tokens first
    const lowcapPool = rest.slice().sort((a, b) => a.cap - b.cap);
    ordered = shuffle(lowcapPool.slice(0, Math.min(lowcapPool.length, NUM_TOKENS * 2)));
  } else {
    // Mixed: Shuffle the entire set
    ordered = shuffle([...rest]);
  }

  const out = [], seen = new Set();
  for (const t of [...control, ...ordered]) { if (t && !seen.has(t.sym)) { seen.add(t.sym); out.push(t); } }
  return out.slice(0, NUM_TOKENS);
}
const r2 = x => Math.round(x * 100) / 100;
// Prices are NOT money and must not be rounded like it. Half this roster trades
// below a cent, and r2() stored every one of them as 0.00 — so the site read a
// price of zero for exactly the volatile tokens the benchmark is built around.
const px6 = x => { const v = +x; if (!isFinite(v) || v === 0) return 0; return Math.abs(v) >= 1 ? Math.round(v * 1e4) / 1e4 : +v.toPrecision(6); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

// ---------- Supabase REST (handles empty "return=minimal" success bodies) ----------
async function sb(pathq, method = 'GET', body, prefer) {
  if (!SUPA || !ANON) return null;
  try {
    const r = await fetch(`${SUPA}/rest/v1/${pathq}`, { method, headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (!r.ok) { console.log(`  [db] ${method} ${pathq.split('?')[0]} -> ${r.status} ${txt.slice(0, 160)}`); return null; }
    return txt ? JSON.parse(txt) : true;
  } catch (e) { console.log('  [db] error:', e.message); return null; }
}
async function sbInsertBatch(table, rows) { let ok = true; for (let i = 0; i < rows.length; i += 200) { const res = await sb(table, 'POST', rows.slice(i, i + 200), 'return=minimal'); if (res === null) ok = false; } return ok; }
// Insert rows; if the DB rejects them because a migration has not been run yet,
// retry once with the new columns stripped so a session is never lost.
async function sbInsertSafe(table, rows, optionalCols = []) {
  if (!SUPA || !ANON) return 'no database configured';
  if (!rows.length) return 'skip';
  if (await sbInsertBatch(table, rows)) return 'OK';
  if (!optionalCols.length) return 'FAILED';
  const lean = rows.map(r => { const c = { ...r }; for (const k of optionalCols) delete c[k]; return c; });
  return (await sbInsertBatch(table, lean)) ? 'OK (without new columns — run supabase/002_outcomes_and_tokens.sql)' : 'FAILED';
}

// ---------- preflight: is the database ready? ------------------------------
// Checked BEFORE a single model call, so a stale schema costs one second
// instead of a whole session that saves nothing.
async function preflight() {
  if (!SUPA || !ANON) { console.log('  [db] no Supabase configured — this session will save locally only.\n'); return true; }
  if (SKIP_CHECK) return true;
  const checks = [['decisions?select=token_class&limit=1', 'decisions.token_class'],
                  ['sessions?select=tokens&limit=1', 'sessions.tokens'],
                  ['agent_reports?select=avg_edge&limit=1', 'agent_reports.avg_edge'],
                  ['decision_outcomes?select=session_id&limit=1', 'decision_outcomes (table)'],
                  ['sessions?select=rounds,counted&limit=1', 'sessions.rounds / sessions.counted'],
                  ['decisions?select=brain&limit=1', 'decisions.brain'],
                  ['agent_reports?select=model_calls&limit=1', 'agent_reports.model_calls']];
  const missing = [];
  for (const [pathq, label] of checks) {
    try { const r = await fetch(`${SUPA}/rest/v1/${pathq}`, { headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}` } }); if (!r.ok) missing.push(label); }
    catch { console.log('  [db] could not reach Supabase — continuing, session saves locally.\n'); return true; }
  }
  if (!missing.length) {
    if (!ENV.SUPABASE_SERVICE_KEY) {
      console.log('\n  [db] NOTE: no SUPABASE_SERVICE_KEY in config.txt.');
      console.log('       After the from-scratch setup the database only accepts writes from');
      console.log('       the service key. Add it to config.txt or this session will not save.');
      console.log('       Supabase dashboard -> Project Settings -> API -> service_role key.\n');
    }
    console.log('  [db] schema OK — outcomes, token opens and reports will all save.');
    return true;
  }
  console.log('\n  ============================================================');
  console.log('   STOPPED BEFORE STARTING — the database is not ready yet.');
  console.log('  ============================================================');
  console.log('   Missing: ' + missing.join(', '));
  console.log('');
  console.log('   Fix it once, takes about 20 seconds:');
  console.log('     1. open  ' + SUPA.replace('https://', 'https://supabase.com/dashboard/project/').replace('.supabase.co', '/sql/new'));
  console.log('     2. open  supabase\\SETUP_FROM_SCRATCH.sql  in this folder');
  console.log('     3. copy all of it, paste it in, click RUN');
  console.log('');
  console.log('   Then start the session again. Nothing was lost — no models were');
  console.log('   called, so this cost you nothing but a few seconds.');
  console.log('  ============================================================\n');
  return false;
}

// ---------- Ollama (local + cloud, no downloads) ----------
async function listModels() {
  if (PINNED.length) return PINNED;
  try { const r = await fetch(`${OLLAMA}/api/tags`); if (!r.ok) return null; const j = await r.json(); return (j.models || []).map(m => m.name).filter(Boolean); } catch { return null; }
}
// Reasoning models are inconsistent about where the answer lands. Try the
// proper field, then the thinking trace, then any JSON object in the text.
const NOTHINK = new Set();
function pickAnswer(msg) {
  if (!msg) return null;
  const tryOne = t => {
    if (!t || typeof t !== 'string') return null;
    const s2 = t.trim(); if (!s2) return null;
    if (s2.startsWith('{')) return s2;
    const fence = s2.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence && fence[1].trim().startsWith('{')) return fence[1].trim();
    const brace = s2.match(/\{[\s\S]*\}/); return brace ? brace[0] : null;
  };
  return tryOne(msg.content) || tryOne(msg.thinking) || tryOne(msg.reasoning) || null;
}
// One decision, however the model chooses to phrase it. JSON is tried first;
// failing that, a single line like  BUY NVDA 12 | momentum building.
// The symbol is then matched against what the agent may actually trade, so a
// hallucinated ticker becomes a visible reject rather than a silent no-op.
function normSym(raw, allowed) {
  if (!raw) return null;
  let x = String(raw).trim().replace(/^\$/, '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!x) return null;
  if (allowed[x]) return x;
  const up = x.toUpperCase(); if (allowed[up]) return up;
  const hit = Object.keys(allowed).find(k => k.toUpperCase() === up);
  return hit || null;
}
// ============================================================
//  CONSTRAINED CHOICE
//  Instead of asking a model to compose an order — which makes it compete on
//  JSON compliance as much as on judgement — we hand it a numbered menu of
//  moves that are all legal right now and ask for one number. Position sizing
//  is done in code, identically for every model, so the benchmark measures the
//  decision and nothing else. It also makes a hallucinated ticker impossible.
// ============================================================
// One call to a model. Returns the text it produced, whichever field it used.
async function askOllama(model, sys, usr, { num_predict = 64, temperature = .7, stop, timeoutMs } = {}) {
  const ctl = new AbortController(); INFLIGHT.add(ctl);
  const t = setTimeout(() => ctl.abort(), timeoutMs || THINK_MS);
  try {
    const body = { model, stream: false, options: { temperature, num_predict, ...(stop ? { stop } : {}) },
                   messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] };
    if (!NOTHINK.has(model)) body.think = false;
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify(body) });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 200);
      if (!NOTHINK.has(model) && /think/i.test(txt)) NOTHINK.add(model);
      return { ok: false, why: 'HTTP ' + r.status, text: '' };
    }
    const j = await r.json(), msg = (j && j.message) || {};
    const text = String(msg.content || '').trim() || String(msg.thinking || '').trim() || String(msg.reasoning || '').trim();
    return { ok: !!text, why: text ? null : 'empty reply', text, fields: Object.keys(msg) };
  } catch (e) { return { ok: false, why: e.name === 'AbortError' ? 'timed out' : e.message, text: '' }; }
  finally { clearTimeout(t); INFLIGHT.delete(ctl); }
}
// A model that narrates instead of answering gets one blunt second chance.
// Cheap — it only fires on failure — and it rescues the chattier models.
const RETRY_SYS = 'Answer with a single digit. No words. No punctuation. Only the digit.';
async function askChoiceWithRetry(model, sys, usr, menu) {
  const a = await askOllama(model, sys, usr, { num_predict: 64, stop: ['\n\n'] });
  if (a.ok) { const p = parseChoice(a.text, menu); if (p != null) return { pick: p, text: a.text, retried: false }; }
  const b = await askOllama(model, RETRY_SYS,
    `${usr}\n\nAnswer with one digit only, 0 to ${menu.length - 1}.`,
    { num_predict: 8, temperature: 0 });
  if (b.ok) { const p = parseChoice(b.text, menu); if (p != null) return { pick: p, text: b.text, retried: true }; }
  return { pick: null, text: (b.text || a.text || ''), why: a.why || b.why || 'unreadable', retried: true };
}

function buildMenu(ag, obs) {
  const menu = [{ k: 'HOLD', sym: null, label: 'HOLD - do nothing this round' }];
  for (const p of [...obs.positions].sort((a, b) => b.pnl - a.pnl).slice(0, 4))
    menu.push({ k: 'SELL', sym: p.sym, label: `SELL ${p.sym} - you hold ${p.qty < 1 ? p.qty.toPrecision(3) : Math.round(p.qty)}, ${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(1)}% since you bought` });
  const held = new Set(obs.positions.map(p => p.sym));
  const afford = a => Math.floor((ag.risk * obs.cash) / (a.price * 1.001)) > 0;
  // SELECTION BIAS: offering only the biggest movers means every buy is into a
  // token that just spiked, and spikes mean-revert — so the choice set itself
  // was dragging hit rate far below chance. Mix in quieter names so the agent
  // is choosing from the market, not from a momentum screen.
  // Vary both the mix and the size. A menu that is always "4 movers + 3 others,
  // 8 rows long" is something an agent can pattern-match instead of read; and a
  // fixed slice of the roster means the same handful of tokens forever.
  const nMove = 3 + Math.floor(Math.random() * 3);          // 3-5 movers
  const nRand = 2 + Math.floor(Math.random() * 4);          // 2-5 drawn at random
  const cands = obs.top.filter(x => !held.has(x.sym) && afford(x)).slice(0, nMove);
  const rest = shuffle(obs.assets.filter(a => !held.has(a.sym) && afford(a) && !cands.includes(a))).slice(0, nRand);
  for (const a of [...cands, ...rest])
    menu.push({ k: 'BUY', sym: a.sym, label: `BUY ${a.sym} - ${fmt(a.price)}, ${a.mom >= 0 ? '+' : ''}${a.mom.toFixed(1)}% lately` });
  // Language models favour the first option they are shown. Leaving HOLD
  // permanently at 0 would quietly bias every agent toward doing nothing and
  // make "chose HOLD" indistinguishable from "chose the first thing".
  // Shuffling per round means position averages out across the session.
  return shuffle(menu);
}
function getPsychologicalRisk(ag, obs) {
  let r = ag.risk;
  const gain = obs.equity / ag.start_cash;
  
  if (ag.id === 'degen') {
    // Degens go harder — always. Double down on losses, size up on wins.
    r *= 1.4;
    if (gain < 0.85) r = Math.min(0.70, r * 1.8);  // revenge trading
    if (gain > 1.10) r = Math.min(0.70, r * 1.5);  // FOMO
  } else if (ag.id === 'mom' || ag.id === 'event') {
    // Momentum/Event traders size up when conviction is high
    if (gain > 1.05) r = Math.min(0.50, r * 1.4);
    if (gain < 0.90) r = r * 0.85;
  } else if (ag.id === 'contra' || ag.id === 'mrev') {
    // Mean-reverters and contrarians get bolder when things drop — that is their edge
    if (gain < 0.90) r = Math.min(0.45, r * 1.3);
  } else if (ag.id === 'val' || ag.id === 'index') {
    // Conservative investors cut risk sizes when losing (capital preservation)
    if (gain < 0.90) r = r * 0.7;
  } else {
    // Standard profiles
    if (gain > 1.10) r = Math.min(0.40, r * 1.2);
    if (gain < 0.90) r = r * 0.8;
  }
  return r;
}
// size is set by the persona's risk appetite, modified by dynamic psychology
function menuToOrder(opt, ag, obs) {
  if (!opt || opt.k === 'HOLD') return { action: 'HOLD', symbol: null, qty: 0 };
  if (opt.k === 'SELL') return { action: 'SELL', symbol: opt.sym, qty: obs.hold[opt.sym] || 0 };
  const px = obs.M[opt.sym] ? obs.M[opt.sym].price : 0;
  const dynRisk = getPsychologicalRisk(ag, obs);
  return { action: 'BUY', symbol: opt.sym, qty: px > 0 ? Math.floor((dynRisk * obs.cash) / (px * 1.001)) : 0 };
}
function parseChoice(text, menu) {
  if (!text) return null;
  const t = String(text).trim();
  const inRange = i => Number.isInteger(i) && i >= 0 && i < menu.length;

  // 1. the ideal case: the whole reply is the number
  if (/^\d{1,2}$/.test(t) && inRange(+t)) return +t;

  // 2. a line that is only a number (models love a preamble then the answer)
  for (const ln of t.split(/\r?\n/)) {
    const c = ln.trim().replace(/^[)\.\-\s]+|[)\.\-\s]+$/g, '');
    if (/^\d{1,2}$/.test(c) && inRange(+c)) return +c;
  }

  // 3. an explicit reference: "option 3", "choose 3", "answer: 3", "#3"
  const tagged = t.match(/(?:option|choice|choose|select|answer|number|pick)\s*[:#]?\s*(\d{1,2})/i);
  if (tagged && inRange(+tagged[1])) return +tagged[1];

  // 4. words. "no action" / "do nothing" is a HOLD even without the word HOLD.
  const w = t.toUpperCase();
  // Find the HOLD ROW, not index 0. The menu is shuffled, so index 0 is a BUY
  // most rounds — this line used to turn "do nothing" into a purchase. Measured
  // across the first four sessions: 66 of 73 replies containing a HOLD word
  // executed a trade the model had just declined to make.
  if (/\b(HOLD|NO ACTION|DO NOTHING|STAND PAT|STAY PUT|NOTHING THIS ROUND|WAIT)\b/.test(w)) {
    const h = menu.findIndex(o => o.k === 'HOLD');
    return h >= 0 ? h : null;
  }
  const act = (w.match(/\b(BUY|SELL)\b/) || [])[1];
  if (act) {
    const hit = menu.findIndex(o => o.k === act && o.sym && new RegExp(`\\b${o.sym.toUpperCase()}\\b`).test(w));
    if (hit >= 0) return hit;
  }

  // 5. last resort: the first integer anywhere that is actually a valid option.
  //    Deliberately last, so "$25,000" in a preamble cannot be mistaken for a pick.
  for (const m of t.matchAll(/\d{1,2}/g)) if (inRange(+m[0])) return +m[0];
  return null;
}

function parseDecision(text, allowed) {
  if (!text) return null;
  const t = String(text).trim();
  const jraw = t.startsWith('{') ? t : (t.match(/\{[\s\S]*?\}/) || [])[0];
  if (jraw) { try { const d = JSON.parse(jraw); if (d && d.action) return { action: String(d.action).toUpperCase(), symbolRaw: d.symbol, qty: +d.qty || 0, comment: String(d.comment || '').slice(0, 60) }; } catch {} }
  const m = t.match(/\b(BUY|SELL|HOLD)\b[ \t]*([A-Za-z0-9._$-]{1,12})?[ \t]*([0-9][0-9,._]*)?[ \t]*(?:[|\-\u2013\u2014:]+[ \t]*(.*))?/i);
  if (!m) return null;
  return { action: m[1].toUpperCase(), symbolRaw: m[2], qty: m[3] ? +String(m[3]).replace(/,/g, '') || 0 : 0, comment: (m[4] || '').trim().slice(0, 60) };
}
const DECISION_SCHEMA = { type: 'object', properties: { action: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] }, symbol: { type: ['string', 'null'] }, qty: { type: 'number' }, comment: { type: 'string' } }, required: ['action', 'comment'] };
// Every outstanding model request is tracked so a stop can cancel all of them
// immediately, rather than letting a round finish paying out after you quit.
const INFLIGHT = new Set();
let SHUTTING = false, CALLS = 0;
function abortAll(){ for (const c of INFLIGHT) { try { c.abort(); } catch {} } INFLIGHT.clear(); }
function cleanup(){ try { fs.rmSync(RUNLOCK); } catch {} try { if (typeof feed !== 'undefined' && feed && feed.close) feed.close(); } catch {} }
function panic(why){
  if (SHUTTING) return; SHUTTING = true;
  console.log(`\n  [stop] ${why} — cancelling ${INFLIGHT.size} in-flight model call(s) and shutting down.`);
  abortAll(); cleanup();
}
for (const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK']) {
  try { process.on(sig, () => { panic(`received ${sig}`); process.exit(130); }); } catch {}
}
process.on('exit', cleanup);
process.on('uncaughtException', e => { panic('crashed: ' + e.message); process.exit(1); });

const fmt = x => (+x >= 1 ? (+x).toFixed(2) : (+x).toPrecision(3));
const shortNum = v => {
  if (v == null || isNaN(v)) return '$0';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'k';
  return '$' + Math.round(v);
};
async function think(ag, obs) {
  const movers = obs.top.map(a => {
    const signals = [];
    signals.push(`$${fmt(a.price)}`);
    if (a.cap) signals.push(`Cap ${shortNum(a.cap)}`);
    if (a.liq) signals.push(`Liq ${shortNum(a.liq)}`);
    if (a.vol5m) signals.push(`Vol5m ${shortNum(a.vol5m)}`);
    signals.push(`5m ${a.mom >= 0 ? '+' : ''}${a.mom.toFixed(1)}%`);
    signals.push(`1h ${a.mom1h >= 0 ? '+' : ''}${a.mom1h.toFixed(1)}%`);
    if (a.isMigrated) signals.push('🎓 Raydium');
    return `${a.sym} (${signals.join(' | ')})`;
  }).join(', ');
  // --- STATE VECTOR COMPRESSION ---
  // 1. Compress menu items with dense telemetry
  for (const o of obs.menu) {
    if (o.k === 'HOLD') continue; // keep HOLD simple
    const inTop = o.sym ? obs.top.find(x => x.sym === o.sym) : null;
    const a = inTop || (o.sym ? obs.positions.find(x => x.sym === o.sym) : null);
    if (a) {
      const sigs = [];
      if (inTop) {
        if (inTop.liq) sigs.push(`LQ:${shortNum(inTop.liq)}`);
        if (inTop.vol5m) sigs.push(`V5:${shortNum(inTop.vol5m)}`);
        if (inTop.mc) sigs.push(`MC:${shortNum(inTop.mc)}`);
        if (inTop.mom != null) sigs.push(`M1:${inTop.mom >= 0 ? '+' : ''}${inTop.mom.toFixed(1)}%`);
        if (inTop.mom15m != null) sigs.push(`M15:${inTop.mom15m >= 0 ? '+' : ''}${inTop.mom15m.toFixed(1)}%`);
        if (inTop.mom1h != null) sigs.push(`M60:${inTop.mom1h >= 0 ? '+' : ''}${inTop.mom1h.toFixed(1)}%`);
      } else {
        sigs.push(`PNL:${a.pnl >= 0 ? '+' : ''}${a.pnl.toFixed(1)}%`);
      }
      o.label = `${o.k} ${o.sym} [${sigs.join('|')}]`;
    }
  }

  // 2. Compress positions
  const pos = obs.positions.length
    ? obs.positions.map(p => `${p.sym}[${p.qty < 1 ? p.qty.toPrecision(3) : Math.round(p.qty)}@${fmt(p.avg)}->${fmt(p.px)}|${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(1)}%]`).join(',')
    : 'NONE';

  // 3. Compress history
  const hist = (obs.log || []).slice(-3).map(h => {
    const now = obs.M[h.sym] ? obs.M[h.sym].price : h.px;
    const move = h.px > 0 ? (now / h.px - 1) * 100 : 0;
    const scored = h.action === 'BUY' ? move : -move;
    return `r${h.tick}:${h.action}_${h.sym}@${fmt(h.px)}[${scored >= 0 ? '+' : ''}${scored.toFixed(1)}%]`;
  }).join(',') || 'NONE';

  const idle = ag.holdStreak >= 3 ? `|IDLE:${ag.holdStreak}r` : '';
  let learned = (ag.memory && ag.memory.length) ? `|MEM:${ag.memory.map(m => m.replace(/ /g, '_')).join(';')}` : '';
  if (ag.id === 'analyst' && ANALYST_KNOWLEDGE) {
    learned += `\n[ARENA_KNOWLEDGE]:\n${ANALYST_KNOWLEDGE}`;
  }

  const used = obs.positions.length, room = (ag.maxPos ?? 5);
  const budget = `EQ:$${Math.round(obs.equity)}|CASH:$${obs.cash | 0}|PNL:${obs.equity >= ag.start_cash ? '+' : ''}${(((obs.equity / ag.start_cash) - 1) * 100).toFixed(1)}%|POS:${used}/${room}`;
  
  const menu = obs.menu;
  const sys = `You are ${ag.name}, a ${ag.role} trading Pump.fun memecoins on Solana.
${ag.desc || ''}
You are in a competitive benchmark against other AI traders. SITTING STILL LOSES.
You MUST actively trade to win. You will receive dense telemetry data.
Choose exactly ONE option from the menu. Reply with its integer number and NOTHING else.`;

  const usr = `[STATE]
${budget}
HOLDINGS:${pos}
RECENT:${hist}${idle}${learned}

[MENU]
${menu.map((o, i) => `${i}) ${o.label}`).join('\n')}

> REPLY_INTEGER_ONLY:`;
  // one slow cloud model must not hold up all eight agents — cut it off and
  // let the rule brain answer for that round instead.
  if (SHUTTING || CALLS >= MAX_MODEL_CALLS) return { ...ruleFallback(ag, obs), comment: 'call ceiling', brain: 'rules' };
  CALLS++;

  if (DEC_FORMAT === 'menu') {
    const res = await askChoiceWithRetry(ag.model, sys, usr, menu);
    if (res.retried) CALLS++;
    if (res.pick == null) {
      if (!think._unparsed) { console.log(`\n  [ollama] ${ag.model} would not give a usable choice even on retry: ${JSON.stringify(String(res.text).slice(0, 100))}`); think._unparsed = true; }
      return { ...ruleFallback(ag, obs), comment: 'no choice given', brain: res.text ? 'unparsed' : 'empty' };
    }
    const opt = menu[res.pick];
    if (res.retried) ag.retries = (ag.retries || 0) + 1;
    return { ...menuToOrder(opt, ag, obs), comment: opt.label.split(' - ')[0].toLowerCase(), choice: res.pick, reply: String(res.text).slice(0, 200), brain: 'model' };
  }

  const ctl = new AbortController(); INFLIGHT.add(ctl);
  const timer = setTimeout(() => ctl.abort(), THINK_MS);
  try {
    const body = { model: ag.model, stream: false,
                   options: { temperature: .7, num_predict: NUM_PREDICT },
                   messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] };
    if (DEC_FORMAT === 'schema') body.format = DECISION_SCHEMA;
    else if (DEC_FORMAT === 'json') body.format = 'json';
    if (!NOTHINK.has(ag.model)) body.think = false;
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify(body) });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 200);
      if (!NOTHINK.has(ag.model) && /think/i.test(txt)) { NOTHINK.add(ag.model); console.log(`  [ollama] ${ag.model} does not accept think:false — retrying without it from now on.`); }
      else if (!think._warned) { console.log(`\n  [ollama] chat -> ${r.status} ${txt} (falling back to rule brains)`); think._warned = true; }
      return { ...ruleFallback(ag, obs), brain: 'error' };
    }
    const j = await r.json();
    const msg = (j && j.message) || {};
    const raw = pickAnswer(msg);
    if (!raw) {
      if (!think._empty) { console.log(`\n  [ollama] ${ag.model} returned an EMPTY answer (fields: ${Object.keys(msg).join(', ') || 'none'}).`); think._empty = true; }
      return { ...ruleFallback(ag, obs), comment: 'model said nothing', brain: 'empty' };
    }
    const d = parseDecision(raw, obs.M);
    if (!d) {
      if (!think._unparsed) { console.log(`\n  [ollama] could not read an action out of ${ag.model}: ${JSON.stringify(String(raw).slice(0, 120))}`); think._unparsed = true; }
      return { ...ruleFallback(ag, obs), comment: 'unreadable reply', brain: 'unparsed' };
    }
    const sym = normSym(d.symbolRaw, obs.M);
    if (d.action !== 'HOLD' && d.symbolRaw && !sym) { ag.badSym = (ag.badSym || 0) + 1; if (!think._badsym) { console.log(`  [ollama] ${ag.model} named a token that is not on the board: "${d.symbolRaw}" — treated as HOLD.`); think._badsym = true; } }
    return { action: d.action, symbol: sym, qty: Math.max(0, d.qty), comment: d.comment, reply: String(raw).slice(0, 200), brain: 'model' };
  } catch (e) {
    if (e.name === 'AbortError') { ag.timeouts = (ag.timeouts || 0) + 1; return { ...ruleFallback(ag, obs), comment: 'slow model, rule call', brain: 'timeout' }; }
    return { ...ruleFallback(ag, obs), brain: 'error' };
  } finally { clearTimeout(timer); INFLIGHT.delete(ctl); }
}

// ---------- REAL market: Pump.fun tokens + live prices (PumpPortal + Dexscreener) ----------
const STABLES = new Set(['USDC','USDT','USDE','DAI','USDe']);
const catOf = s => STABLES.has(s) ? 'stable' : 'memecoin';
function classify(sym, name){ if (STABLES.has(sym) || /USD/i.test(sym)) return 'stable'; return 'memecoin'; }
const classLabel = c => ({ memecoin:'memecoin', stable:'stable' }[c] || c);


function recompute(a) { a.chg = (a.price / a.seed - 1) * 100; const w = a.hist.slice(-12), wr = a.hist.slice(-24); a.mom = (a.price / w[0] - 1) * 100; a.dev = (a.price / (wr.reduce((s, x) => s + x, 0) / wr.length) - 1) * 100; }

// ---------- Simulated market (fallback) ----------
const MEMEPOOL = ['CHILLGUY','PENGU','FARTCOIN','GOAT','ZEREBRO','REAL','AIX','DEGN','GIGA','TENDIE','FOMO','WAGMI','DOGE','SHIB','FLOKI','BONK','POPCAT','BOME','MEW','PNUT','ACT','SLERF','MYRO','WIF','TRUMP','MELANIA','BODEN','MOTHER','DADDY','TREMP','MOODENG','BRETT'];
function buildSimAssets() {
  const memes = []; 
  const p = [...MEMEPOOL]; 
  while (memes.length < 25 && p.length) memes.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
  const A = [];
  for (const sym of memes) { 
    const price = +(rnd(0.0001, 0.05)).toFixed(6); 
    A.push({ sym, cat: 'memecoin', price, seed: price, vol: rnd(.045, .085), drift: rnd(-.001, .002), hist: [price], chg: 0, mom: 0, dev: 0 }); 
  }
  return A;
}
function tickSim(A) { for (const a of A) { if (a.cat === 'memecoin' && Math.random() < .05) a.price *= (1 + rnd(-.35, .45)); a.price = Math.max(a.seed * .02, a.price * (1 + (a.drift + a.vol * randn()))); a.hist.push(a.price); if (a.hist.length > 60) a.hist.shift(); recompute(a); } }

// (a synthetic "live" price walk used to live here — removed, see the poller)

// ---------- agents ----------
// tp / sl / maxPos give each persona its own exit discipline — the thing that
// turns paper gains into realised money.
const PERSONAS = [
  { id: 'val',   desc: 'You buy tokens that have DROPPED hard recently — they are cheap. You wait for recovery. You MUST have at least 2 positions open at all times. If you hold nothing, BUY the cheapest token on the board.',
                 name: 'Value Val',          role: 'value investor',     risk: .25, tp: 12, sl: -8,  maxPos: 5 },
  { id: 'mom',   desc: 'You buy whatever is PUMPING hardest right now. You ride momentum until it breaks. You trade EVERY round — either buying the biggest mover or selling a position that has stalled. Never sit idle.',
                 name: 'Momentum Mia',       role: 'trend chaser',       risk: .35, tp: 15, sl: -6,  maxPos: 4 },
  { id: 'degen', desc: 'You are a FULL DEGEN. You ape into EVERY pump, no hesitation. You MUST trade every single round — buy the spiciest token or sell for profit. Sitting in cash is losing. You would rather lose trading than win by doing nothing.',
                 name: 'Degen Dex',          role: 'meme degen',         risk: .50, tp: 30, sl: -20, maxPos: 5 },
  { id: 'contra',desc: 'You are a contrarian sniper. You buy the BIGGEST FALLER on the board — the redder the better. You bet on bounces. You MUST have 2-3 positions open. If nothing is red, sell your best winner to lock profits.',
                 name: 'Contrarian Cole',    role: 'buys the dip',       risk: .30, tp: 10, sl: -10, maxPos: 5 },
  { id: 'mrev',  desc: 'You fade extremes in BOTH directions. If something pumped too far, SELL or avoid it. If something dumped too far, BUY it. You always want to be positioned — 3+ slots filled.',
                 name: 'Mean-Reverter Mara', role: 'fades extremes',     risk: .28, tp: 8,  sl: -9,  maxPos: 5 },
  { id: 'index', desc: 'You spread across MANY tokens in small amounts. Buy a little of everything you do not already own. You should have 5-8 positions at all times. Diversification is your strategy — never concentrated.',
                 name: 'Index Ivy',          role: 'diversified',        risk: .15, tp: 8,  sl: -6,  maxPos: 8 },
  { id: 'event', desc: 'You are an event trader. You watch for ANY token that moved more than 3% in the last 5 minutes and JUMP on it immediately — buy the pump or buy the crash. When nothing is moving, sell your weakest position. You swing hard.',
                 name: 'Event Nia',          role: 'reacts to shocks',   risk: .35, tp: 18, sl: -12, maxPos: 4 },
  { id: 'analyst', desc: 'You are the Analyst. You adapt your strategy dynamically based on recent market reports.',
                 name: 'The Analyst',        role: 'dynamic meta-trader',risk: .30, tp: 15, sl: -10, maxPos: 5 },
];
// ============================================================
//  BASELINES — the null models. NO model is ever called for these.
//
//  Until this existed there was nothing on the board to compare against, so a
//  9% hit rate meant nothing: 9% versus what? "Random Randy" was described in
//  this file as "the control", but Randy is a language model *told* to be
//  random, with its own risk appetite and its own stop-loss exemption. That is
//  a treatment arm wearing a control's name.
//
//  These three are mechanical. They cost no tokens, they cannot time out, and
//  they are what every model number should be read against:
//     dice   — picks uniformly at random from the same menu  (chance line)
//     vault  — never trades                                  (do-nothing line)
//     basket — spreads evenly across the roster and holds     (buy-and-hold line)
// ============================================================
const BASELINES = [
  { id: 'bl_dice',   name: 'Baseline Dice',   role: 'uniform random pick', kind: 'dice',   risk: .15, tp: 99, sl: -99, maxPos: 8 },
  { id: 'bl_vault',  name: 'Baseline Vault',  role: 'never trades',        kind: 'vault',  risk: 0,   tp: 99, sl: -99, maxPos: 0 },
  { id: 'bl_basket', name: 'Baseline Basket', role: 'equal-weight, holds', kind: 'basket', risk: .10, tp: 99, sl: -99, maxPos: 12 },
];
const BASELINES_ON = String(ENV.BASELINES || 'on').toLowerCase() !== 'off';

// A baseline never sees a prompt and never calls a model.
function baselineChoice(ag, obs) {
  const menu = obs.menu || [];
  if (ag.kind === 'vault') return { action: 'HOLD', symbol: null, qty: 0, comment: 'never trades', brain: 'baseline', choice: null };
  if (ag.kind === 'dice') {
    const i = Math.floor(Math.random() * menu.length);
    return { ...menuToOrder(menu[i], ag, obs), comment: 'uniform random', brain: 'baseline', choice: i };
  }
  // basket: buy anything on the menu it does not already hold, smallest first,
  // then sit on it. Approximates equal-weight buy-and-hold of the live roster.
  const want = menu.filter(o => o.k === 'BUY' && !obs.hold[o.sym]);
  if (!want.length) return { action: 'HOLD', symbol: null, qty: 0, comment: 'fully allocated', brain: 'baseline', choice: null };
  const pick = want[0];
  return { ...menuToOrder(pick, ag, obs), comment: 'equal weight', brain: 'baseline', choice: menu.indexOf(pick) };
}
// Mark to market — except for a quarantined token, which is marked to COST.
// If a token's price turns out to have been wrong, the agent that happened to
// be holding it did not earn the correction and did not lose it either. Its
// money comes back at what it paid. Anything else lets a data bug decide the
// leaderboard, which is what put gemma4 on $430m.
const equityOf = (ag, M) => {
  let e = ag.cash;
  for (const s in ag.hold) {
    const a = M[s];
    if (!a) continue;
    if (a.quarantined) { e += costBasisOf(ag, s); continue; }
    e += ag.hold[s] * a.price;
  }
  return e;
};
const costBasisOf = (ag, sym) => (ag.lots[sym] || []).reduce((s, l) => s + l.qty * l.px, 0);
function ruleFallback(ag, obs) {
  const A = obs.assets, held = Object.keys(obs.hold);
  // EXITS FIRST. Random Randy is exempt — he is the coin-flip control and must
  // stay dumb, otherwise there is nothing to measure the others against.
  const P = obs.positions || [];
  if (P.length && ag.id !== 'rand') {
    const win = P.filter(p => p.pnl >= (ag.tp ?? 10)).sort((a, b) => b.pnl - a.pnl)[0];
    if (win) return { action: 'SELL', symbol: win.sym, qty: win.qty, comment: `taking +${win.pnl.toFixed(0)}% ${win.sym}` };
    const lose = P.filter(p => p.pnl <= (ag.sl ?? -8)).sort((a, b) => a.pnl - b.pnl)[0];
    if (lose) return { action: 'SELL', symbol: lose.sym, qty: lose.qty, comment: `cutting ${lose.pnl.toFixed(0)}% ${lose.sym}` };
    if (P.length >= (ag.maxPos ?? 5)) { const worst = [...P].sort((a, b) => a.pnl - b.pnl)[0]; return { action: 'SELL', symbol: worst.sym, qty: worst.qty, comment: 'freeing up cash' }; }
  }
  const buy = (sym, c) => { const q = Math.floor((ag.risk * obs.cash) / obs.M[sym].price); return q > 0 ? { action: 'BUY', symbol: sym, qty: q, comment: c } : { action: 'HOLD', symbol: null, qty: 0, comment: 'no cash' }; };
  const sell = (sym, c) => { const q = obs.hold[sym] || 0; return q > 0 ? { action: 'SELL', symbol: sym, qty: q, comment: c } : { action: 'HOLD', symbol: null, qty: 0, comment: 'hold' }; };
  const by = (arr, f, d = 1) => [...arr].sort((a, b) => (f(b) - f(a)) * d);
  if (!A.length) return { action: 'HOLD', symbol: null, qty: 0, comment: 'no market' };
  // Degen ALWAYS trades — ape into the hottest meme, or pick random if nothing pumps
  if (ag.id === 'degen') { const m = by(A, a => a.mom)[0]; return m ? buy(m.sym, 'aping ' + m.sym) : buy(pick(A).sym, 'yolo'); }
  // Momentum chases hardest pumps — lower threshold so it actually fires
  if (ag.id === 'mom') { const t = by(A, a => a.mom)[0]; return t.mom > 0.5 ? buy(t.sym, 'riding ' + t.sym) : (held.length ? sell(pick(held), 'stalled') : buy(pick(A).sym, 'scanning')); }
  // Contrarian buys biggest dips — lower threshold
  if (ag.id === 'contra') { const l = by(A, a => a.mom, -1)[0]; return l.mom < -0.5 ? buy(l.sym, 'fading drop') : (held.length ? sell(pick(held), 'no dip') : buy(pick(A).sym, 'nibbling')); }
  // Value buys cheapest by deviation — any memecoin that dipped
  if (ag.id === 'val') { const c = by(A, a => a.dev, -1)[0]; return c && c.dev < -0.5 ? buy(c.sym, c.sym + ' cheap') : (held.length > 0 ? { action: 'HOLD', symbol: null, qty: 0, comment: 'patient' } : buy(pick(A).sym, 'opening position')); }
  // Mean-reverter fades extremes — lower threshold
  if (ag.id === 'mrev') { const lo = by(A, a => a.dev, -1)[0]; return lo && lo.dev < -1 ? buy(lo.sym, 'reverting') : (held.length ? sell(pick(held), 'trimming') : buy(pick(A).sym, 'starting')); }
  // Event reacts to ANY big move — much lower threshold
  if (ag.id === 'event') { const s = by(A, a => Math.abs(a.mom))[0]; return Math.abs(s.mom) > 1 ? buy(s.sym, 'shock ' + s.sym) : (held.length ? sell(pick(held), 'no shock') : { action: 'HOLD', symbol: null, qty: 0, comment: 'watching' }); }
  // Index buys everything it does not already hold
  if (ag.id === 'index') { const u = A.filter(a => !obs.hold[a.sym]); return u.length ? buy(pick(u).sym, 'basket') : { action: 'HOLD', symbol: null, qty: 0, comment: 'balanced' }; }
  const r = Math.random(); if (r < .4) return buy(pick(A).sym, 'coin flip'); if (r < .7 && held.length) return sell(pick(held), 'coin flip'); return { action: 'HOLD', symbol: null, qty: 0, comment: 'coin flip' };
}
// Executes the order AND prices the exit against FIFO lots, so every SELL
// carries the ground truth: did this round-trip actually make money?
function execute(ag, d, M, tick) {
  // A quarantined token has no trustworthy price, so it has no trustworthy
  // fill either. Trading is frozen in both directions; the position stays on
  // the books at cost until the session ends. This is the step that would have
  // stopped Degen selling 2.1bn CASHCAT into a $109m mark.
  if (d.symbol && M[d.symbol] && M[d.symbol].quarantined) return { executed: false, quarantined: true };
  if (d.action === 'BUY' && d.symbol && M[d.symbol]) {
    const px = M[d.symbol].price;
    if (!(px > 0) || !(d.qty > 0)) return { executed: false };
    // Models routinely ask for more than they can afford. Scaling the order
    // down to what the cash allows beats silently dropping it — a rejected
    // order used to look identical to a deliberate HOLD in the data.
    const afford = Math.floor((ag.cash * 0.98) / (px * 1.001));
    const qty = Math.min(d.qty, afford);
    if (qty > 0) {
      const cost = qty * px * 1.001;
      ag.cash -= cost;
      ag.hold[d.symbol] = (ag.hold[d.symbol] || 0) + qty;
      (ag.lots[d.symbol] = ag.lots[d.symbol] || []).push({ qty, px, tick });
      return { executed: true, qty, trimmed: qty < d.qty };
    }
    return { executed: false };
  } else if (d.action === 'SELL' && d.symbol && M[d.symbol]) {
    const h = ag.hold[d.symbol] || 0, q = Math.min(h, d.qty);
    if (q > 0) {
      const px = M[d.symbol].price, proceeds = q * px * .999;
      ag.cash += proceeds;
      ag.hold[d.symbol] = h - q;
      if (ag.hold[d.symbol] <= 1e-9) delete ag.hold[d.symbol];
      const lots = ag.lots[d.symbol] || [];
      let left = q, cost = 0, oldest = tick;
      while (left > 1e-12 && lots.length) {
        const l = lots[0], take = Math.min(l.qty, left);
        cost += take * l.px; oldest = Math.min(oldest, l.tick);
        l.qty -= take; left -= take;
        if (l.qty <= 1e-12) lots.shift();
      }
      const basis = cost > 0 ? cost : q * px;
      const pnl = proceeds - basis;
      return { executed: true, qty: q, realized_pnl: r2(pnl), realized_pct: r2((pnl / basis) * 100), hold_ticks: tick - oldest };
    }
  }
  return { executed: false };
}
function metrics(ag) { const h = ag.bars; if (h.length < 3) return { ret: (ag.lastEq / ag.start_cash - 1) * 100, skill: 0 }; const rr = []; for (let i = 1; i < h.length; i++) rr.push(h[i] / h[i - 1] - 1); const m = rr.reduce((s, x) => s + x, 0) / rr.length; const sd = Math.sqrt(rr.reduce((s, x) => s + (x - m) ** 2, 0) / rr.length) || 1e-9; return { ret: (ag.lastEq / ag.start_cash - 1) * 100, skill: (m / sd) * Math.sqrt(rr.length) }; }

// ============================================================
(async () => {
  // ---- one runner at a time ----
  // Two runners alive at once means double the paid model calls, invisibly.
  try {
    const raw = fs.readFileSync(RUNLOCK, 'utf8');
    const prev = JSON.parse(raw);
    const alive = (() => { try { process.kill(prev.pid, 0); return true; } catch { return false; } })();
    if (alive && prev.pid !== process.pid) {
      console.log('\n  ============================================================');
      console.log('  ALREADY RUNNING — another session is live.');
      console.log('  ============================================================');
      console.log(`   It started at ${prev.started} (process ${prev.pid}).`);
      console.log('   Two runners would double your model spend, so this one is');
      console.log('   stopping. Use stop_session.cmd, or emergency_stop.cmd to');
      console.log('   kill everything now.');
      console.log('  ============================================================\n');
      process.exitCode = 1; return;
    }
    fs.rmSync(RUNLOCK);
  } catch {}
  try { fs.writeFileSync(RUNLOCK, JSON.stringify({ pid: process.pid, started: nowISO() })); } catch {}

  try { fs.rmSync(STOPFLAG); } catch {}
  if (!await preflight()) { cleanup(); process.exitCode = 1; return; }
  const all = await listModels();
  const usingOllama = Array.isArray(all) && all.length > 0;
  const models = usingOllama ? all.slice(0, MAX_MODELS) : [];
  console.log(usingOllama ? `Ollama connected — benchmarking ${models.length} model(s): ${models.join(', ')}` : 'Ollama not detected → built-in fallback brains.');

  // build the market — REAL first, sim fallback
  let assets = null, REALMODE = false, feed = null;
  if (PRICE_MODE !== 'sim') {
    feed = new LiveFeed({ log: console.log });
    await feed.seed();
    
    const priced = Object.values(feed.tokens).map(t => ({
      sym: t.symbol, name: t.name, price: t.priceNative, cap: t.marketCap, mom: t.priceChange5m, mom1h: t.priceChange1h || 0, vol5m: t.volume5m || 0, liq: t.liquidityUsd || 0, tier: t.tier || 'growth', txns: t.txns5m, live: true, cat: 'memecoin', addr: t.mint, isMigrated: !!t.isMigrated
    })).filter(t => t.price > 0).sort((a, b) => b.cap - a.cap);

    if (priced.length >= 1) {
      assets = selectRoster(priced, MODE).map(t => ({ sym: t.sym, addr: t.addr, cat: t.cat, kind: t.kind || 'memecoin', baseSym: t.baseSym || null, src: t.src || 'explorer', live: !!t.live, name: t.name, fresh: !!t._fresh, price: t.price, seed: t.price, vol: (t.cat==='stable'?.0003:t.cat==='memecoin'?.05:.006), drift: 0, hist: [t.price], chg: 0, mom: t.mom, mom1h: t.mom1h || 0, vol5m: t.vol5m || 0, liq: t.liq || 0, cap: t.cap, tier: t.tier || 'growth', dev: 0, isMigrated: !!t.isMigrated }));
      REALMODE = true;
      console.log('  [pump] REAL DATA ON (Pump.fun). roster: ' + assets.map(a => `${a.sym}${a.fresh ? '*' : ''} $${(+a.price).toPrecision(4)}`).join(', '));
      const freshList = assets.filter(a => a.fresh).map(a => a.sym);
      if (freshList.length) console.log(`  [pump] fresh tokens injected this session (*): ${freshList.join(', ')}`);
    } else console.log('  [pump] too few priced tokens — using simulation instead.');
  }
  if (!REALMODE) { assets = buildSimAssets(); console.log('  [sim] simulated market — tokens: ' + assets.map(a => a.sym).join(', ')); }
  const M = Object.fromEntries(assets.map(a => [a.sym, a]));
  const roster = assets.map(a => a.sym);
  const tradableSyms = assets.filter(a => a.cat !== 'stable').map(a => a.sym);
  // `quarantined` has to travel to the site. Otherwise the runner correctly
  // excludes a token from scoring while the public market strip still shows it
  // as a +1,500,347% gainer — the numbers are right and the page lies anyway.
  const tokenRow = () => assets.map(a => ({ sym: a.sym, addr: a.addr || null, cat: classLabel(a.cat), kind: a.kind || null, paired_to: a.baseSym || null, fresh: !!a.fresh, isMigrated: !!a.isMigrated, tier: a.tier || 'growth', src: a.src || 'explorer', live: !!a.live, open: a.seed, last: a.quarantined ? a.seed : a.price, quarantined: !!a.quarantined }));
  // price snapshot per round — the spine of every outcome label
  const priceLog = [Object.fromEntries(assets.map(a => [a.sym, a.price]))];
  const fills = new Map(), menus = new Map();

  // live price refresh (real mode)
  // Prices come from the chain and ONLY from the chain. Previously a random
  // walk was layered on top in 'live' mode, so everything after the opening
  // snapshot was synthetic while the console claimed "REAL prices". Gone.
  let poller = null, refreshes = 0, priceMoves = 0, suspectPrices = 0;
  const quarantined = new Set();   // symbols delisted mid-session as untrustworthy
  if (feed) {
    poller = setInterval(async () => {
      try {
        await feed.updatePrices();
        refreshes++;
        let moved = 0;
        for (const a of assets) {
          if (a.quarantined) continue;
          if (feed.vet) feed.vet(a.sym);
          if (REALMODE && feed.tradable && !feed.tradable(a.sym)) {
            a.quarantined = true;
            quarantined.add(a.sym);
            console.log(`  [risk] ${a.sym} delisted mid-session. Trading frozen.`);
            continue;
          }
          const t = feed.tokens[a.addr];
          if (!t) continue;

          // Track Raydium Migration / Graduation
          if (t.isMigrated && !a.isMigrated) {
            a.isMigrated = true;
            console.log(`  [feed] 🎓 GRADUATION: ${a.sym} migrated to Raydium!`);
            // Reward agents holding this token at graduation
            if (typeof agents !== 'undefined') {
              for (const ag of agents) {
                if (ag.hold && ag.hold[a.sym] > 0) {
                  ag.raydiumHits = (ag.raydiumHits || 0) + 1;
                  console.log(`    🏆 Raydium Hit credited to ${ag.name}!`);
                }
              }
            }
          }

          if (!(t.priceNative > 0) || t.priceNative === a.price) continue;
          a.price = t.priceNative;
          a.mom = t.priceChange5m || 0;
          a.mom1h = t.priceChange1h || 0;
          a.vol5m = t.volume5m || 0;
          a.liq = t.liquidityUsd || 0;
          a.cap = t.marketCap || 0;
          a.tier = t.tier || 'growth';
          a.src = 'pool';
          a.hist.push(t.priceNative);
          if (a.hist.length > 60) a.hist.shift();
          recompute(a);
          moved++;
        }
        priceMoves += moved;
        if (moved) console.log(`  [pump] ${moved} price(s) moved`);
      } catch {}
    }, REFRESH_MS);
  }

  // ============================================================
  //  BENCHMARK FAIRNESS — two things that have to be true before
  //  "which model trades best" is a real question:
  //
  //  1. ROTATE the model↔persona pairing. With a fixed pairing, the model
  //     table and the persona table are the same ranking and you can never
  //     tell whether nemotron won or whether value investing won. Rotating by
  //     the number of sessions already run walks a Latin square: over N
  //     sessions every model plays every persona exactly once.
  //  2. EQUAL starting capital. Drawing $500 vs $90k is not just a handicap —
  //     at $500 an agent literally cannot buy a $1,400 token, so it is barred
  //     from part of the market. That is a confound, not a difficulty setting.
  // ============================================================
  let prior = 0;
  if (SUPA && ANON) { const c = await sb('sessions?select=id&counted=is.true'); if (Array.isArray(c)) prior = c.length; }
  const offset = models.length ? prior % models.length : 0;
  // 8 personas, 7 models: one model must drive two personas. With a plain
  // (i + offset) % len, persona 0 and persona 7 collapse onto the SAME model in
  // every session forever — so Value Val and Random Randy shared a brain every
  // single run, the "control" persona was permanently welded to one model, and
  // that model got two agent_reports rows per session. Give the overflow
  // personas an extra shift that moves with the rotation.
  const N = models.length;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  // With 8 personas and 7 models one pair must share a model every session.
  // Two things have to be true and the obvious formula gets neither:
  //   · the SHARING PAIR must change between sessions, or one persona is
  //     permanently welded to another (Value Val and Random Randy shared a
  //     brain in every run, so the control was confounded with one model);
  //   · each persona must still see every model once across N sessions, or
  //     the Latin square has holes.
  // Advancing the overflow personas at a different RATE than the main block
  // gives both: rate (wrap+1) is coprime to N, so it is a bijection over the
  // rotation, and its collision partner walks forward one persona per session.
  const rate = w => (gcd(w + 1, N) === 1 ? w + 1 : 1);
  const modelFor = i => {
    if (!usingOllama) return 'rules';
    if (PAIRING === 'fixed') return models[i % N];
    if (PAIRING === 'random') return models[Math.floor(Math.random() * N)];
    const wrap = Math.floor(i / N);
    return models[(i + (wrap ? rate(wrap) * offset + wrap : offset)) % N];
  };

  const session_cash = CAP_MODE === 'equal' ? START_CAP : Math.round(rnd(CMIN, CMAX));
  const mkAgent = (p, model) => { const cash = session_cash; return { ...p, model, cash, start_cash: cash, hold: {}, lots: {}, bars: [], lastEq: cash, thinks: 0, trades: 0, bust: false, note: 'starting out', notesHist: [], recent: [], log: [], raydiumHits: 0 }; };
  const agents = PERSONAS.map((p, i) => mkAgent(p, modelFor(i)));
  // The null models ride along in every session, on the same capital, the same
  // menu and the same prices. Their model name is 'baseline:<kind>' so they can
  // never be mistaken for an LLM in any ranking.
  if (BASELINES_ON) for (const b of BASELINES) agents.push(mkAgent({ ...b, desc: '' }, 'baseline:' + b.kind));
  if (usingOllama) console.log(`  [pairing] ${PAIRING}${PAIRING === 'rotate' ? ` · rotation ${offset + 1}/${models.length} (${prior} counted session${prior === 1 ? '' : 's'} so far)` : ''} — each model plays a different persona than last run.`);
  console.log(`  [capital] ${CAP_MODE === 'equal' ? `every agent starts on $${START_CAP.toLocaleString('en-US')} — returns are directly comparable` : `randomised $${session_cash.toLocaleString('en-US')} for every agent`}`);

  // ---- live check: make EVERY model answer a real menu before we begin ----
  // One call each. This is the difference between believing the models are
  // answering and knowing it — a whole session used to run on fallbacks
  // without a single line of output saying so.
  if (usingOllama) {
    console.log('\n  checking every model can actually answer...');
    // HOLD is NOT at index 0 here, deliberately. With HOLD first, a model that
    // simply always answers "0" passes the health check looking co-operative,
    // and then spends the whole session answering 0 to a shuffled menu.
    const probe = [{ k: 'BUY', sym: 'NVDA', label: 'BUY NVDA - 206.80, +1.2% lately' },
                   { k: 'HOLD', sym: null, label: 'HOLD - do nothing this round' },
                   { k: 'BUY', sym: 'TSLA', label: 'BUY TSLA - 312.90, -0.4% lately' }];
    const results = await Promise.all(models.map(async m => {
      const res = await askChoiceWithRetry(m, 'Choose exactly ONE option. Reply with its number and NOTHING else.',
        `your options this round:\n${probe.map((o, i) => `${i}) ${o.label}`).join('\n')}\n\nReply with one number, 0 to 2.`, probe);
      return res.pick == null
        ? { m, ok: false, why: (res.why || 'unreadable') + (res.text ? ': ' + JSON.stringify(res.text.slice(0, 60)) : '') }
        : { m, ok: true, pick: res.pick, txt: res.text.slice(0, 40), retried: res.retried };
    }));
    for (const r of results) console.log(`    ${r.ok ? 'OK ' : 'XX '} ${r.m.padEnd(26)} ${r.ok ? `chose ${r.pick}${r.retried ? ' (on retry)' : '        '}  ${JSON.stringify(r.txt)}` : r.why}`);
    const good = results.filter(r => r.ok).length;
    if (!good) {
      console.log('\n  ============================================================');
      console.log('   STOPPING — not one model could answer.');
      console.log('   Every decision would come from the rule brain, which would');
      console.log('   look like a benchmark and measure nothing. Run diagnose.cmd.');
      console.log('  ============================================================\n');
      cleanup(); process.exitCode = 1; return;
    }
    if (good < results.length) console.log(`  [warn] ${results.length - good} model(s) cannot answer — their agents will run on rule brains and be excluded from hit rate.`);
    else console.log(`  all ${good} models answered correctly.`);
  }

  if (MEMORY_ON && SUPA && ANON) {
    const rows = await sb(`agent_memory?select=agent_id,model,lesson,created_at&order=created_at.desc&limit=400`)
             || await sb(`agent_memory?select=agent_id,lesson,created_at&order=created_at.desc&limit=200`);
    if (Array.isArray(rows)) {
      // Keyed on (persona, MODEL). Retrieving by persona alone fed each model
      // the lessons written by whichever DIFFERENT models had played that
      // persona in earlier sessions — so under rotation every model's prompt
      // was seeded with another model's self-narration, and no two sessions
      // were independent. Falls back to persona-only if the column is absent.
      const hasModel = rows.some(r => 'model' in r);
      for (const ag of agents) ag.memory = rows
        .filter(r => r.agent_id === ag.id && (!hasModel || !r.model || r.model === ag.model))
        .slice(0, MEMORY_DEPTH).map(r => r.lesson).filter(Boolean);
      const carried = agents.reduce((n, a) => n + (a.memory ? a.memory.length : 0), 0);
      console.log(`  [memory] carried ${carried} lesson(s) in from earlier sessions.`);
    }
  }

  const sessRow = { name: `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, provider: usingOllama ? 'ollama' : 'rules', status: 'running', memecoins: roster,
    capital_min: CAP_MODE === 'equal' ? START_CAP : CMIN, capital_max: CAP_MODE === 'equal' ? START_CAP : CMAX,
    pairing: PAIRING, capital_mode: CAP_MODE, counted: false, tokens: tokenRow() };
  let sess = await sb('sessions', 'POST', sessRow, 'return=representation');
  if (!sess) { const { tokens, ...basic } = sessRow; sess = await sb('sessions', 'POST', basic, 'return=representation'); if (sess) console.log('  [db] saved without token opens — run supabase/002_outcomes_and_tokens.sql to turn on live token colours.'); }
  const session_id = (sess && sess[0] && sess[0].id) || crypto.randomUUID();
  console.log(`\nSession ${session_id}\ncapital ${CAP_MODE === 'equal' ? `$${START_CAP.toLocaleString('en-US')} each (equal)` : `$${CMIN}-$${CMAX} per agent (random)`} · ${REALMODE ? 'REAL Pump.fun memecoin prices' : 'simulated prices'} · roster ${MODE} · runs until you press Stop (safety cap ${SECONDS >= 60 ? Math.round(SECONDS / 60) + ' min' : SECONDS + ' s'})\n`);

  const decisions = [], equity = [], roundMs = []; let round = 0, flushedD = 0, flushedE = 0; const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < SECONDS && !fs.existsSync(STOPFLAG) && !SHUTTING && CALLS < MAX_MODEL_CALLS) {
    round++; const rt0 = Date.now();
    if (!REALMODE) tickSim(assets);
    priceLog[round] = Object.fromEntries(assets.map(a => [a.sym, a.price]));
    // ONE price per round, frozen at the open. Fills, marks and outcome labels
    // all read this, so the price a trade filled at is exactly the price it is
    // scored against — and the async price poller cannot move the goalposts
    // between the first agent's answer and the last one's.
    const OPEN = Object.fromEntries(assets.map(a => [a.sym, { price: a.price, quarantined: !!a.quarantined, cat: a.cat }]));
    const alive = agents.filter(a => !a.bust);
    if (!alive.length) { console.log('  all agents eliminated.'); break; }
    // THE MENU ONLY OFFERS WHAT IS ACTUALLY TRADING.
    //
    // Across four sessions, 90.2% of scored decisions came back "flat" — 1,785
    // of 1,978 — because only 11-15 of 30 roster tokens ever repriced. Half the
    // menu was tokens nobody was trading, so most decisions had no measurable
    // consequence and the benchmark could not tell any model from any other.
    //
    // This filter is deliberately EX-ANTE: "has traded in the last N minutes",
    // known at menu-build time. The benchmark's market baseline still uses
    // "tokens that moved", which is decided afterwards — that look-ahead is the
    // next thing to fix, and this is the mechanism that will replace it.
    const liveEnough = assets.filter(a => a.cat !== 'stable' && !a.quarantined && a.lastSwapAt && (Date.now() - a.lastSwapAt) < MENU_ACTIVE_MS);
    const allTradable = assets.filter(a => a.cat !== 'stable' && !a.quarantined);
    // early rounds have no activity history yet, and a starved menu is worse
    // than a stale one — fall back rather than offer an agent three choices
    const nonStable = liveEnough.length >= MIN_MENU_POOL ? liveEnough : allTradable;
    if (round % 25 === 0 && feed) console.log(`  [menu] ${liveEnough.length}/${allTradable.length} token(s) traded in the last ${MENU_ACTIVE_MS / 60000} min${liveEnough.length < MIN_MENU_POOL ? ' — too few, offering the full roster' : ''}`);
    // draw the movers from a wider band than the top 8, so a token does not have
    // to be the single biggest mover to ever appear
    const ranked = [...nonStable].sort((a, b) => Math.abs(b.mom) - Math.abs(a.mom));
    const top = shuffle(ranked.slice(0, 14)).slice(0, 8);
    await Promise.all(alive.map(async ag => {
      // what the agent is holding right now, with entry price and unrealised P&L
      const positions = Object.keys(ag.hold).map(s => {
        const lots = ag.lots[s] || [], px = OPEN[s] ? OPEN[s].price : 0;
        const c = lots.reduce((x, l) => x + l.qty * l.px, 0), qq = lots.reduce((x, l) => x + l.qty, 0);
        const avg = qq > 0 ? c / qq : px;
        return { sym: s, qty: ag.hold[s], avg, px, pnl: avg > 0 ? (px / avg - 1) * 100 : 0 };
      }).sort((a, b) => b.pnl - a.pnl);
      const obs = { cash: ag.cash, equity: ag.lastEq || ag.cash, hold: { ...ag.hold }, positions, log: ag.log, assets: nonStable, M, top, note: ag.note };
      obs.menu = buildMenu(ag, obs);
      menus.set(`${round}|${ag.id}`, obs.menu);
      let d;
      try {
        d = ag.kind ? baselineChoice(ag, obs)                       // null model, no prompt, no tokens
          : usingOllama ? await think(ag, obs)
          : { ...ruleFallback(ag, obs), brain: 'rules' };
      } catch (e) { console.error('\\n\\n  [FATAL] THINK ERROR:', e); d = { action: 'HOLD', symbol: null, qty: 0, comment: 'error', brain: 'error' }; }
      const sym = d.symbol && OPEN[d.symbol] ? d.symbol : null; d.symbol = sym;
      // Fill at the price snapshotted when the ROUND opened, not at live M.
      // The poller mutates M while eight agents are still awaiting their models,
      // so a slow model used to fill at a later price than a fast one — a
      // model-correlated execution edge that has nothing to do with judgement.
      // It also means the price a trade filled at is the price it is scored at.
      const fill = execute(ag, d, OPEN, round); const executed = fill.executed;
      if (fill.qty != null) d.qty = fill.qty;   // log what actually filled, not what was asked for
      fills.set(`${round}|${ag.id}`, fill);
      if (executed) ag.trades++; ag.thinks++;
      if (d.brain === 'model') ag.modelCalls = (ag.modelCalls || 0) + 1; else ag.fallbackCalls = (ag.fallbackCalls || 0) + 1;
      ag.holdStreak = executed ? 0 : (ag.holdStreak || 0) + 1;
      if (executed && sym) { ag.log.push({ tick: round, action: d.action, sym, px: OPEN[sym].price, comment: d.comment }); if (ag.log.length > 6) ag.log.shift(); }
      ag.lastEq = equityOf(ag, OPEN);
      if (!ag.bust && ag.lastEq < ag.start_cash * 0.02) { ag.bust = true; ag.cash = Math.max(0, ag.lastEq); ag.hold = {}; ag.note = 'busted - eliminated'; }
      decisions.push({ session_id, tick: round, ts: nowISO(), agent_id: ag.id, agent_name: ag.name, role: ag.role, model: ag.model, start_cash: ag.start_cash, action: d.action, sym: sym || '', qty: r2(d.qty), price: sym ? px6(OPEN[sym].price) : 0, executed, comment: d.comment, brain: d.brain || 'rules', choice: d.choice == null ? null : d.choice, reply: d.reply || null, menu_size: (menus.get(`${round}|${ag.id}`) || []).length, token_class: (sym && OPEN[sym]) ? classLabel(OPEN[sym].cat) : null, equity: r2(ag.lastEq) });
      ag.recent.push(ag.lastEq); if (ag.recent.length > 6) ag.recent.shift();
      // RISK IS FROZEN. This used to multiply ag.risk by 1.1 or 0.9 on a
      // hot-hand rule, so an agent that got lucky early traded bigger later —
      // the harness sizing positions on past performance, which is precisely
      // the artefact Alpha Arena was criticised for. The note is still tracked
      // for the prompt, but it no longer moves money.
      if (ag.thinks % 5 === 0) { const up = ag.recent.filter((v, i) => i && v > ag.recent[i - 1]).length; ag.note = up >= 3 ? 'recent rounds have gone your way' : 'recent rounds have gone against you'; ag.notesHist.push({ tick: round, note: ag.note }); }
      console.log(`  r${round} ${ag.name.padEnd(18)} ${String(ag.model).padEnd(22)} ${d.action.padEnd(4)} ${(sym || '').padEnd(7)} ${d.comment ? '- ' + d.comment : ''}${ag.bust ? '   [ELIMINATED]' : ''}`);
    }));
    // An equity point EVERY round, not every other one. The site's standing
    // table and its equity chart both read this, and when the chart only had
    // even rounds the two panels were reading the clock at different moments
    // and disagreeing in public about who was winning.
    for (const ag of agents) { ag.lastEq = equityOf(ag, OPEN); if (round % 2 === 0) { ag.bars.push(ag.lastEq); if (ag.bars.length > 120) ag.bars.shift(); } equity.push({ session_id, agent_id: ag.id, tick: round, ts: nowISO(), value: r2(ag.lastEq) }); }
    // Advance the cursor ONLY on a successful write. It used to move first, so
    // one 503 mid-session permanently dropped those rounds — the final flush
    // only sends what is past the cursor, and the summary still printed OK.
    if (round % 2 === 0) {
      const nd = decisions.slice(flushedD), ne = equity.slice(flushedE);
      if (!nd.length || await sbInsertBatch('decisions', nd)) flushedD = decisions.length;
      if (!ne.length || await sbInsertBatch('equity_points', ne)) flushedE = equity.length;
    }
    roundMs.push(Date.now() - rt0);
    if (usingOllama && CALLS >= MAX_MODEL_CALLS) console.log(`\n  [budget] hit the ${MAX_MODEL_CALLS}-call ceiling — finishing the session now. Raise MAX_MODEL_CALLS in config.txt if you want longer runs.`);
    if (round % 10 === 0 && usingOllama) console.log(`  [budget] ${CALLS}/${MAX_MODEL_CALLS} model calls used`);
    if (round === MIN_BENCH_ROUNDS && SUPA && ANON) {
      sb(`sessions?id=eq.${session_id}`, 'PATCH', { counted: true });
    }
    if (round === 3) {
      const per = roundMs.reduce((a, b) => a + b, 0) / roundMs.length + ROUND_MS;
      const proj = Math.max(1, Math.floor(SECONDS * 1000 / per));
      const projCalls = proj * agents.length;
      const capReached = projCalls > MAX_MODEL_CALLS;
      console.log(`\n  [pace] ~${(per / 1000).toFixed(1)}s per round → roughly ${proj} rounds this session.`);
      console.log(`  [spend] that is about ${projCalls} model calls. Ceiling is ${MAX_MODEL_CALLS}${capReached ? ` — the ceiling will stop it first, at around round ${Math.floor(MAX_MODEL_CALLS / agents.length)} (~${Math.round(MAX_MODEL_CALLS / agents.length * per / 60000)} min).` : `, so the clock or your Stop will end it first.`}`);
      if (proj < HORIZON * 3) console.log(`  [pace] OUTCOME_HORIZON is ${HORIZON} rounds, which is long for that. It will be clamped so the labels still mean something — raise SESSION_SECONDS in config.txt for fuller data.`);
      console.log('');
    }
    await sleep(ROUND_MS);
  }
  if (poller) clearInterval(poller);

  // ============================================================
  //  OUTCOME LABELS — did each decision actually work?
  //  Every decision gets scored three ways:
  //    fwd_ret   the token's move over the next HORIZON rounds, signed by
  //              direction (a SELL before a drop scores positive)
  //    mkt_ret   what the equal-weight roster did over the same window
  //    edge      fwd_ret minus the market = the alpha of the call itself
  //  SELLs additionally carry FIFO realised P&L — the hard ground truth.
  //  HOLDs (and orders that could not fill) are judged on whether the
  //  agent's own equity beat the market over that window.
  // ============================================================
  const lastRound = priceLog.length - 1;
  // If the session was short, a 10-round horizon would silently collapse into
  // "return to session end". Clamp it so the label keeps its meaning, and
  // record the horizon actually used on every row.
  const H = Math.max(1, Math.min(HORIZON, Math.floor(lastRound / 3)));
  if (H !== HORIZON) console.log(`  [labels] only ${lastRound} rounds ran — judging decisions over ${H} round(s) instead of ${HORIZON}.`);
  const snapAt = t => priceLog[Math.max(0, Math.min(t, lastRound))] || {};
  // The benchmark may only contain tokens that ACTUALLY HAVE A LIVE PRICE.
  // Only ~20 of the roster get priced from swap logs; the rest sit frozen at
  // their opening price for the whole session. Including those put the median
  // token's return at exactly 0%, so every real token that dipped scored as
  // "worse than the market" and hit rate collapsed to single digits. The
  // agents were being measured against something that cannot move.
  // Quarantined tokens are not part of "the market" either. A token that got
  // delisted for an untrustworthy price must not set the bar the agents are
  // measured against.
  const scorable = tradableSyms.filter(s => !quarantined.has(s));
  const movedSyms = scorable.filter(sym => {
    const a = priceLog[0] || {}, b = priceLog[lastRound] || {};
    return a[sym] > 0 && b[sym] > 0 && a[sym] !== b[sym];
  });
  const benchSyms = movedSyms.length >= 3 ? movedSyms : scorable;
  if (movedSyms.length) console.log(`  [bench] measuring against the ${benchSyms.length} token(s) that actually moved${benchSyms.length < tradableSyms.length ? ` (of ${tradableSyms.length} on the roster — the rest never repriced)` : ''}`);

  // MEDIAN, not mean. On a roster of memecoins a single token that triples
  // drags the average return far above anything a trader could realistically
  // have captured, and then every agent that did not happen to own it scores
  // as "worse than the market". The median is what a typical token did.
  const mktRet = (ta, tb) => {
    const a = snapAt(ta), b = snapAt(tb), rs = [];
    for (const s of benchSyms) { const p0 = a[s], p1 = b[s]; if (p0 > 0 && p1 > 0) rs.push(p1 / p0 - 1); }
    if (!rs.length) return 0;
    rs.sort((x, y) => x - y);
    const m = rs.length >> 1;
    return rs.length % 2 ? rs[m] : (rs[m - 1] + rs[m]) / 2;
  };
  const eqAt = {};
  for (const d of decisions) (eqAt[d.agent_id] = eqAt[d.agent_id] || {})[d.tick] = +d.equity;
  const eqLookup = (id, t) => { const m = eqAt[id] || {}; for (let k = t; k >= 0; k--) if (m[k] != null) return m[k]; return null; };
  const LBL = v => v > 0.25 ? 'good' : v < -0.25 ? 'bad' : 'flat';

  const outcomes = decisions.map(d => {
    const th = Math.min(d.tick + H, lastRound);
    const mh = mktRet(d.tick, th) * 100;
    const eq0 = +d.equity, eq1 = eqLookup(d.agent_id, th);
    const agent_edge = (eq0 > 0 && eq1 != null) ? r2(((eq1 / eq0 - 1) * 100) - mh) : null;
    const fill = fills.get(`${d.tick}|${d.agent_id}`) || {};
    const sign = d.action === 'BUY' ? 1 : d.action === 'SELL' ? -1 : 0;
    let fwd_ret = null, fwd_ret_end = null, edge = null, outcome = 'na';
    // A call on a token that was later delisted is unscoreable, not right and
    // not wrong. Leaving it in produced edges of +48,515 and an "average
    // regret" of 18,369pp — numbers that quietly rewrite every model average.
    if (d.sym && quarantined.has(d.sym)) outcome = 'void';
    else if (d.sym && sign !== 0 && d.executed) {
      const p0 = snapAt(d.tick)[d.sym], ph = snapAt(th)[d.sym], pe = snapAt(lastRound)[d.sym];
      if (p0 > 0 && ph > 0) { fwd_ret = r2(sign * (ph / p0 - 1) * 100); edge = r2(fwd_ret - sign * mh); outcome = LBL(edge); }
      if (p0 > 0 && pe > 0) fwd_ret_end = r2(sign * (pe / p0 - 1) * 100);
    } else if (agent_edge != null) outcome = LBL(agent_edge);
    // Because the choice set was closed, we can score every move that WAS
    // available and ask how the taken one compared. Regret is the gap to the
    // best option that existed at that moment — a much sharper measure of
    // judgement than "did this go up", because it controls for the market.
    let regret = null, was_best = null;
    const mn = menus.get(`${d.tick}|${d.agent_id}`);
    if (mn && mn.length > 1) {
      const p0s = snapAt(d.tick), phs = snapAt(th);
      // HOLD scores -mh, not 0. Sitting in cash earns 0%, so relative to the
      // market it earns MINUS the market's move. Scoring it as 0 encoded
      // "cash earns the market return", which put a bias of exactly +mkt_ret on
      // every non-token action — a bias whose SIGN flips with the market, so
      // the ranking between models shifted with whether the session happened to
      // be up or down. Models differ in how often they hold, so this was not
      // noise, it was a market-direction-dependent thumb on the scale.
      const optEdge = o => {
        if (o.k === 'HOLD') return -mh;
        const a0 = p0s[o.sym], a1 = phs[o.sym];
        if (!(a0 > 0 && a1 > 0)) return null;
        const move = (a1 / a0 - 1) * 100 - mh;
        return o.k === 'BUY' ? move : -move;
      };
      const scored = mn.map(optEdge);
      const usable = scored.filter(v => v != null);
      // If every option scored the same — which is what a frozen market does —
      // then "picked the best" is true by default and means nothing. Leave it
      // unscored rather than reporting a 100% best-pick rate that is an artefact.
      const spread = usable.length > 1 ? Math.max(...usable) - Math.min(...usable) : 0;
      if (usable.length > 1 && spread > 1e-9) {
        const best = Math.max(...usable);
        const takenIdx = d.choice == null ? mn.findIndex(o => (o.k === d.action) && (o.sym || null) === (d.sym || null)) : d.choice;
        const taken = takenIdx >= 0 ? scored[takenIdx] : null;
        if (taken != null) { regret = r2(Math.max(0, best - taken)); was_best = regret <= 0.0001; }
      }
    }
    return { session_id, tick: d.tick, agent_id: d.agent_id, model: d.model, brain: d.brain || 'rules', action: d.action, sym: d.sym || null,
      horizon: H, fwd_ret, fwd_ret_end, mkt_ret: r2(mh), edge, agent_edge, regret, was_best,
      realized_pnl: fill.realized_pnl == null ? null : fill.realized_pnl,
      realized_pct: fill.realized_pct == null ? null : fill.realized_pct,
      hold_ticks: fill.hold_ticks == null ? null : fill.hold_ticks, outcome };
  });

  // hit rate is scored on ACTUAL TRADES only. HOLDs still get a label in the
  // database, but they outnumber trades ~10:1 and would drown the signal.
  // Hit rate is scored on ACTUAL TRADES only — holds outnumber trades ~10:1 and
  // would drown the signal — and only on calls the MODEL actually made. A call
  // the rule brain covered for after a timeout is not evidence about the model.
  const agg = {};
  for (const o of outcomes) {
    const b = agg[o.agent_id] = agg[o.agent_id] || { scored: 0, good: 0, edges: [], pnl: 0, closed: 0 };
    if (o.edge != null && o.brain === 'model') { b.scored++; if (o.outcome === 'good') b.good++; b.edges.push(o.edge); }
    if (o.realized_pnl != null) { b.pnl += o.realized_pnl; b.closed++; }
  }
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

  const reports = agents.map(ag => {
    const m = metrics(ag), b = agg[ag.id] || { scored: 0, good: 0, edges: [], pnl: 0, closed: 0 };
    const ae = avg(b.edges);
    return { session_id, agent_id: ag.id, agent_name: ag.name, role: ag.role, model: ag.model, start_cash: ag.start_cash, end_value: r2(ag.lastEq), ret: r2(m.ret), skill: r2(m.skill), trades: ag.trades,
      hit_rate: b.scored ? r2((b.good / b.scored) * 100) : null,
      avg_edge: ae == null ? null : r2(ae),
      realized_pnl: r2(b.pnl), closed_trades: b.closed,
      model_calls: ag.modelCalls || 0, fallback_calls: ag.fallbackCalls || 0,
      // What share of this agent's decisions the MODEL actually made. `ret` was
      // being ranked on without this: rule-fallback runs take-profit and
      // stop-loss exits the models are never offered, so a model that timed out
      // a lot got a disciplined mechanical strategy credited to its name.
      model_share: r2(((ag.modelCalls || 0) / Math.max(1, (ag.modelCalls || 0) + (ag.fallbackCalls || 0))) * 100),
      is_baseline: !!ag.kind,
      raydium_hits: ag.raydiumHits || 0,
      summary: `${ag.name} (${ag.model}) $${ag.start_cash} -> $${Math.round(ag.lastEq)} (${m.ret >= 0 ? '+' : ''}${m.ret.toFixed(1)}%)${ag.bust ? ' [OUT]' : ''}`, notes_history: ag.notesHist };
  });
  const ranked = [...reports].sort((a, b) => b.ret - a.ret);

  // THE INPUTS, not just the results. edge / regret / was_best used to be
  // published with no record of the prices and menus they were computed from,
  // so nobody — including us — could recompute a single one of them. The
  // article says "you can regenerate my numbers"; this is what makes that true.
  const provenance = {
    generated_at: nowISO(),
    config: { horizon: H, horizon_requested: HORIZON, min_bench_rounds: MIN_BENCH_ROUNDS,
              start_capital: START_CAP, capital_mode: CAP_MODE, pairing: PAIRING,
              max_price_jump: MAX_JUMP, max_plausible_return: MAX_PLAUSIBLE_RET,
              menu_activity_minutes: MENU_ACTIVE_MS / 60000, min_menu_pool: MIN_MENU_POOL,
              think_timeout_ms: THINK_MS, decision_format: DEC_FORMAT, memory: MEMORY_ON,
              baselines: BASELINES_ON, round_ms: ROUND_MS, refresh_ms: REFRESH_MS },
    models: [...new Set(agents.map(a => a.model))],
    pairing_used: agents.map(a => ({ agent_id: a.id, model: a.model, baseline: !!a.kind })),
  };
  try {
    fs.mkdirSync(new URL('sessions', ROOT), { recursive: true });
    fs.writeFileSync(new URL(`sessions/${session_id}.json`, ROOT), JSON.stringify({
      session_id, real: REALMODE, roster, tokens: tokenRow(), horizon: H,
      provenance,
      // per-round price snapshot: the spine every outcome label is derived from
      price_log: priceLog,
      // the exact choice set each agent saw, so regret and was_best are checkable
      menus: [...menus.entries()].map(([k, v]) => { const [tick, agent_id] = k.split('|');
        return { tick: +tick, agent_id, options: v.map(o => ({ k: o.k, sym: o.sym || null })) }; }),
      decisions, equity, outcomes, reports }, null, 2));
  } catch (e) { console.log('local save failed:', e.message); }

  console.log('\nsaving session to Supabase...');
  const okD = await sbInsertBatch('decisions', decisions.slice(flushedD));
  const okE = await sbInsertBatch('equity_points', equity.slice(flushedE));
  const okR = await sbInsertSafe('agent_reports', reports, ['hit_rate', 'avg_edge', 'realized_pnl', 'closed_trades', 'model_share', 'is_baseline']);
  const okO = await sbInsertSafe('decision_outcomes', outcomes);
  // A session shorter than MIN_BENCH_ROUNDS is kept and viewable, but marked
  // counted=false so it can never move the all-time model rankings. Two rounds
  // of data is not evidence about a model.
  // Last line of defence. The three layers above should mean this never fires;
  // if it does, something new is wrong and the session must not be allowed to
  // vote on which model is best.
  const wildest = Math.max(...reports.map(r => Math.abs(+r.ret || 0)));
  const plausible = wildest <= MAX_PLAUSIBLE_RET;
  const counted = round >= MIN_BENCH_ROUNDS && plausible;
  if (!plausible) console.log(`\n  !! NOT COUNTED — an agent finished at ${wildest.toFixed(0)}%, past the ${MAX_PLAUSIBLE_RET}% plausibility limit.\n     A move that size is a data fault, not a trade. This session is saved and viewable but excluded from the career ledger.`);
  const stopPatch = { status: 'stopped', stopped_at: nowISO(), rounds: round, counted };
  // Marking the session stopped matters more than it looks: if this write is
  // missed the row stays "running" forever and the public site claims to be
  // live over a dead session. So: try with tokens, retry without, then verify
  // by reading the row back, and say plainly if it did not take.
  let closed = await sb(`sessions?id=eq.${session_id}`, 'PATCH', { ...stopPatch, tokens: tokenRow() });
  if (!closed) closed = await sb(`sessions?id=eq.${session_id}`, 'PATCH', stopPatch);
  const back = await sb(`sessions?id=eq.${session_id}&select=status,rounds,counted`);
  const reallyStopped = Array.isArray(back) && back[0] && back[0].status === 'stopped';
  if (!reallyStopped) {
    console.log('\n  [db] WARNING: could not mark this session as stopped.');
    console.log('       The site will show it as live until that is fixed. Most likely');
    console.log('       cause is a missing or wrong SUPABASE_SERVICE_KEY in config.txt —');
    console.log('       reads work with the public key, writes do not.\n');
  }
  const check = await sb(`decisions?session_id=eq.${session_id}&select=agent_id&limit=100000`);
  try { fs.rmSync(STOPFLAG); } catch {}

  const holds = decisions.filter(d => d.action === 'HOLD').length;
  const holdPct = decisions.length ? Math.round(holds / decisions.length * 100) : 0;
  const scored = outcomes.filter(o => o.edge != null), gGood = scored.filter(o => o.outcome === 'good').length;
  const reg = outcomes.filter(o => o.regret != null);
  const bestPicks = reg.filter(o => o.was_best).length;
  const pnlTot = outcomes.reduce((s, o) => s + (o.realized_pnl || 0), 0), closedTot = outcomes.filter(o => o.realized_pnl != null).length;
  // 0.1% each way. Over a few hundred round-trips that is most of the P&L, and
  // it is worth separating from anything the models did well or badly.
  const feeDrag = decisions.filter(d => d.executed && d.sym).reduce((s2, d) => s2 + (d.qty * d.price * 0.001), 0);

  console.log('\n================ SESSION COMPLETE ================');
  ranked.forEach((r, i) => console.log(`  ${i + 1}. ${r.agent_name.padEnd(20)} ${String(r.model).padEnd(24)} $${r.start_cash} -> $${Math.round(r.end_value)}  (${r.ret >= 0 ? '+' : ''}${r.ret}%)  hit ${r.hit_rate == null ? '  -' : String(r.hit_rate).padStart(5) + '%'}  edge ${r.avg_edge == null ? '  -' : (r.avg_edge >= 0 ? '+' : '') + r.avg_edge}${r.summary.includes('[OUT]') ? '  ELIMINATED' : ''}`));
  const fbTot = agents.reduce((s2, a) => s2 + (a.fallbackCalls || 0), 0);
  console.log(`\n  market: ${REALMODE ? `REAL Pump.fun memecoin prices · ${refreshes} refresh${refreshes === 1 ? '' : 'es'}, ${priceMoves} price move${priceMoves === 1 ? '' : 's'}` : 'simulated'} · ${decisions.length} decisions · ${round} rounds`);
  if (REALMODE && priceMoves === 0) console.log('  [warn] no price moved all session. If [pools] was active this means the roster tokens simply did not trade; otherwise the explorer cache was stale.');
  if (fbTot) {
    const why = {}; for (const d of decisions) if (d.brain !== 'model') why[d.brain] = (why[d.brain] || 0) + 1;
    console.log(`  brains: ${decisions.length - fbTot} calls answered by the models, ${fbTot} covered by rule fallback (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')}) — fallback calls are excluded from hit rate.`);
    // thresholds are against ALL decisions, not just the failures — 5 unreadable
    // replies out of 368 is a healthy session, not a broken one
    const share = k => (why[k] || 0) / Math.max(1, decisions.length);
    if (share('empty') > 0.15) console.log(`  [warn] ${Math.round(share('empty') * 100)}% of calls came back EMPTY. Run diagnose.cmd — the models are answering but producing no content.`);
    if (share('unparsed') > 0.15) console.log(`  [warn] ${Math.round(share('unparsed') * 100)}% of replies were unreadable. Try DECISION_FORMAT=line in config.txt.`);
    if (share('timeout') > 0.15) console.log(`  [warn] ${Math.round(share('timeout') * 100)}% of calls timed out. Raise THINK_TIMEOUT_MS in config.txt.`);
  }
  if (reg.length) console.log(`  choices: ${reg.length} of ${outcomes.length} scored against a menu that actually differed · best available picked ${Math.round(bestPicks / reg.length * 100)}% of the time · average regret ${(reg.reduce((a, o) => a + o.regret, 0) / reg.length).toFixed(2)}pp`);
  else console.log(`  choices: none scorable — every option on every menu had the same outcome, so there was no better or worse choice to make.`);
  if (feeDrag > 0) console.log(`  costs: $${Math.round(feeDrag)} paid in trading fees across ${decisions.filter(d => d.executed && d.sym).length} fills (0.1% each way) — subtract this before reading skill into the P&L`);
  console.log(`  activity: ${holdPct}% of decisions were HOLD${holdPct >= 80 ? (priceMoves === 0 ? ' — expected, no price moved all session so there was nothing to act on' : ' — high; check the movers actually had movement') : ''}`);
  console.log(`  labelled: every decision scored · ${scored.length} trades judged, ${scored.length ? Math.round((gGood / scored.length) * 100) : 0}% beat the median token over ${H} round${H === 1 ? '' : 's'} · ${closedTot} round-trips closed for ${pnlTot >= 0 ? '+' : '-'}$${Math.abs(Math.round(pnlTot))}`);
  console.log(`  Supabase writes: decisions ${okD ? 'OK' : 'FAILED'} · equity ${okE ? 'OK' : 'FAILED'} · reports ${okR} · outcomes ${okO} · session closed ${reallyStopped ? 'OK' : 'FAILED'}`);
  if (suspectPrices) console.log(`  prices: ${suspectPrices} implausible jump(s) were held back pending confirmation.`);
  if (quarantined.size) console.log(`  quarantined: ${[...quarantined].join(', ')} — delisted mid-session, held at cost, excluded from scoring and from the market benchmark.`);
  console.log(counted
    ? `  benchmark: COUNTED — ${round} rounds, this run moves the all-time model rankings.`
    : !plausible
      ? `  benchmark: NOT COUNTED — a return of ${wildest.toFixed(0)}% is not a trade, it is a bad price. This session is saved for inspection but excluded from the rankings.`
      : `  benchmark: NOT COUNTED — only ${round} round${round === 1 ? '' : 's'} (needs ${MIN_BENCH_ROUNDS}). Saved and viewable, but it will not move the all-time rankings.`);
  console.log(`  [db] verify: ${Array.isArray(check) ? check.length + ' decision rows are now in Supabase for this session.' : 'could not read back (check schema).'}`);
  // Close feed discovery immediately when trading loop completes so no websocket logs fire during reflection
  if (typeof feed !== 'undefined' && feed && feed.close) feed.close();

  // ---------- each agent writes itself one lesson ----------
  // Eight extra calls, once per session. This is the only thing that makes an
  // agent better in session 9 than it was in session 1.
  if (MEMORY_ON && usingOllama && !SHUTTING) {
    console.log('\n  asking each agent what it learned...');
    const lessons = await Promise.all(agents.map(async ag => {
      if (ag.kind) return null;                  // a baseline has nothing to reflect on
      const r = reports.find(x => x.agent_id === ag.id) || {};
      const sys2 = `You are ${ag.name}, a ${ag.role}. The session just ended. You extract generalized quantitative trading principles connecting price action, time, and math parameters to decision making.`;
      const usr2 = `You started with $${ag.start_cash} and finished with $${Math.round(ag.lastEq)} (${r.ret >= 0 ? '+' : ''}${r.ret}%).
You made ${ag.trades} trades. ${r.hit_rate != null ? `${r.hit_rate}% of your trades beat the market.` : ''}

IMPORTANT: DO NOT mention specific token names or ticker symbols. Tickers are transient noise.
Form a general principle connecting PRICE ACTION (5m momentum %, drawdowns), TIME (holding rounds), or RISK/CAPITAL parameters to better decision making.
Write ONE sentence, under 20 words, for your next session. No preamble, just the sentence.`;
      try {
        const ctl = new AbortController(); INFLIGHT.add(ctl);
        const t = setTimeout(() => ctl.abort(), THINK_MS * 2);
        const resp = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
          body: JSON.stringify({ model: ag.model, stream: false, think: false, options: { temperature: .6, num_predict: 400 }, messages: [{ role: 'system', content: sys2 }, { role: 'user', content: usr2 }] }) });
        clearTimeout(t); INFLIGHT.delete(ctl);
        if (!resp.ok) return null;
        const jj = await resp.json();
        const txt = String((jj.message && (jj.message.content || jj.message.thinking)) || '').trim().split('\n').filter(Boolean).pop();
        if (!txt) return null;
        return { session_id, agent_id: ag.id, agent_name: ag.name, model: ag.model, ret: r.ret, lesson: txt.replace(/^["'\s-]+|["'\s]+$/g, '').slice(0, 240) };
      } catch { return null; }
    }));
    const good = lessons.filter(Boolean);
    if (good.length) {
      const okM = await sbInsertSafe('agent_memory', good);
      console.log(`  lessons written: ${good.length}/${agents.length} · saved ${okM}`);
      for (const l of good) console.log(`    ${l.agent_name.padEnd(20)} "${l.lesson}"`);

      // Save local Evolution Tree JSON Log for research
      try {
        const evolutionLog = {
          session_id,
          created_at: new Date().toISOString(),
          lessons: good,
          agents: agents.filter(ag => !ag.kind).map(ag => ({
            id: ag.id,
            name: ag.name,
            model: ag.model,
            start_cash: ag.start_cash,
            final_equity: Math.round(ag.lastEq),
            trades_count: ag.trades,
            trades: ag.log.map(h => ({ action: h.action, sym: h.sym, px: h.px, tick: h.tick }))
          }))
        };
        fs.mkdirSync('worker/logs/evolution_tree', { recursive: true });
        fs.writeFileSync(`worker/logs/evolution_tree/session_${session_id}.json`, JSON.stringify(evolutionLog, null, 2));
        console.log(`  [research] evolution tree log saved: worker/logs/evolution_tree/session_${session_id}.json`);
      } catch (err) {
        console.error('  [research] error saving evolution tree log:', err.message);
      }
    } else console.log('  no lessons produced (models did not answer).');
  }

  // ---------- observer agent (market analyst) ----------
  // Runs once at the very end of the session to provide objective performance analysis
  // of the entire market and agent leaderboard. Useful for tracking system progress.
  if (usingOllama && models.length && !SHUTTING) {
    console.log('\n  running observer agent (performance analysis)...');
    const obsModel = models[0];
    const standings = ranked.map((r, i) => `${i + 1}. ${r.agent_name} (${r.model}) - Final Equity: $${Math.round(r.end_value)} (${r.ret >= 0 ? '+' : ''}${r.ret}%)`).join('\n');
    const winner = ranked[0];
    const topFact = `WINNING STRATEGY THIS SESSION: ${winner.agent_name} playing ${winner.model} (+${winner.ret}%).`;
    const sys3 = `You are a quantitative trading analyst observing a benchmark session. You provide realistic, objective observation and performance analysis. Keep it strictly to 2-3 paragraphs.`;
    const usr3 = `The trading session has ended after ${round} rounds.
Starting Capital: $${session_cash}
Market condition: ${priceMoves} price moves observed.

Final Standings:
${standings}

Write an objective performance analysis of the strategies used. Identify which strategy worked best under these market conditions and why the losers failed. Do not mention specific token names. Focus on the personas and risk management.`;

    try {
      const ctl = new AbortController(); INFLIGHT.add(ctl);
      const t = setTimeout(() => ctl.abort(), THINK_MS * 3);
      const resp = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model: obsModel, stream: false, think: false, options: { temperature: .7, num_predict: 800 }, messages: [{ role: 'system', content: sys3 }, { role: 'user', content: usr3 }] }) });
      clearTimeout(t); INFLIGHT.delete(ctl);
      if (resp.ok) {
        const jj = await resp.json();
        const commentary = String((jj.message && (jj.message.content || jj.message.thinking)) || '').trim();
        if (commentary) {
          console.log(`\n  [Observer Analyst - ${obsModel}]`);
          console.log(`  ${commentary.split('\n').join('\n  ')}\n`);
          const okObs = await sbInsertSafe('session_commentary', [{ session_id, model: obsModel, commentary }]);
          console.log(`  observer commentary saved: ${okObs}`);
          
          // Save the Dynamic Knowledge for 'The Analyst'
          const dynamicKnowledge = `${topFact}\n\nMARKET OBSERVATION:\n${commentary}`;
          fs.mkdirSync(new URL('logs', ROOT), { recursive: true });
          fs.writeFileSync(new URL('logs/analyst_memory.txt', ROOT), dynamicKnowledge, 'utf8');
          console.log(`  [research] dynamic knowledge updated for The Analyst.`);
        }
      } else {
        console.log('  observer agent failed to generate commentary (HTTP error).');
      }
    } catch (err) {
      console.log(`  observer agent failed: ${err.message}`);
    }
  }

  // ---------- career ledger ----------
  // Every session still trades from equal capital, so returns stay comparable.
  // The career balance is simply those returns compounded — the long arc,
  // without ever handing one agent more buying power than another.
  if (SUPA && ANON) {
    const rows = await sb('agent_reports?select=agent_id,agent_name,model,ret,session_id&order=created_at.asc&limit=8000');
    const cs = await sb('sessions?select=id&counted=is.true');
    if (Array.isArray(rows) && Array.isArray(cs)) {
      const ok = new Set(cs.map(x => x.id));
      const byA = {}, byM = {}, nameOf = {};
      for (const r of rows) {
        if (!ok.has(r.session_id)) continue;
        const g = 1 + (+r.ret || 0) / 100;
        nameOf[r.agent_id] = r.agent_name || r.agent_id;
        byA[r.agent_id] = (byA[r.agent_id] == null ? CAREER_START : byA[r.agent_id]) * g;
        if (r.model) byM[r.model] = (byM[r.model] == null ? CAREER_START : byM[r.model]) * g;
      }
      const money = v => '$' + Math.round(v).toLocaleString('en-US');
      const rank = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
      if (rank(byM).length) {
        console.log(`\n  ---- career ledger · ${money(CAREER_START)} compounded across every counted session ----`);
        console.log('   by model:');
        rank(byM).forEach(([m, v], i) => console.log(`    ${i + 1}. ${String(m).padEnd(26)} ${money(v).padStart(12)}  ${v >= CAREER_START ? '+' : ''}${(((v / CAREER_START) - 1) * 100).toFixed(1)}%`));
        console.log('   by agent:');
        rank(byA).forEach(([a, v], i) => console.log(`    ${i + 1}. ${(nameOf[a] || a).padEnd(26)} ${money(v).padStart(12)}  ${v >= CAREER_START ? '+' : ''}${(((v / CAREER_START) - 1) * 100).toFixed(1)}%`));
      }
    }
  }

  const retried = agents.reduce((n, a) => n + (a.retries || 0), 0);
  if (retried) console.log(`  ${retried} call(s) needed a blunt retry before the model gave a usable answer.`);
  const badSyms = agents.reduce((n, a) => n + (a.badSym || 0), 0);
  if (badSyms) console.log(`  ${badSyms} decision(s) named a token that was not on the board — counted as HOLD.`);
  if (usingOllama) console.log(`  spend: ${CALLS} model calls made this session (ceiling ${MAX_MODEL_CALLS}).`);
  cleanup();
  console.log(`\n  local copy: worker/sessions/${session_id}.json`);
  process.exit(0);
})();
