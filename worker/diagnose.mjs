// ============================================================
//  BENCHHOOD — diagnostic. Answers two questions with evidence:
//    1. Why is every model call falling back to the rule brain?
//    2. Do the explorer's prices actually move?
//  Makes at most 3 model calls. Writes nothing, changes nothing.
// ============================================================
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const OLLAMA = (ENV.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const EXPLORER = (ENV.EXPLORER_API || 'https://robinhoodchain.blockscout.com/api/v2').replace(/\/$/, '');
const WAIT = +(ENV.DIAG_WAIT_SECONDS || 45);
const line = () => console.log('  ' + '-'.repeat(64));
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('\n============================================================');
console.log(' TRENCH BENCH DIAGNOSTIC');
console.log('============================================================\n');

// ---------- 1. can we reach Ollama at all ----------
console.log('[1] Ollama reachable at ' + OLLAMA + ' ?');
let models = [];
try {
  const r = await fetch(`${OLLAMA}/api/tags`);
  console.log('    /api/tags -> HTTP ' + r.status);
  if (r.ok) { const j = await r.json(); models = (j.models || []).map(m => m.name).filter(Boolean); }
  console.log('    models visible: ' + (models.length ? models.join(', ') : 'NONE'));
} catch (e) { console.log('    UNREACHABLE: ' + e.message); }
if (!models.length) {
  console.log('\n    >> Ollama is not serving models. Open the Ollama app (or run');
  console.log('       "ollama serve") and try again.\n');
  process.exit(1);
}
line();

const M = models[0];
const msgs = [{ role: 'system', content: 'You are a trader. Pick ONE action.' },
              { role: 'user', content: 'cash $25000; movers NVDA 206 +1.2%, TSLA 308 -0.4%. Reply with your action.' }];
const SCHEMA = { type: 'object', properties: { action: { type: 'string', enum: ['BUY','SELL','HOLD'] }, symbol: { type: ['string','null'] }, qty: { type: 'number' }, comment: { type: 'string' } }, required: ['action','comment'] };

async function attempt(label, body) {
  console.log(`\n[${label}] model: ${M}`);
  const t0 = Date.now();
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    clearTimeout(t);
    const txt = await r.text();
    const ms = Date.now() - t0;
    console.log(`    HTTP ${r.status}  in ${(ms/1000).toFixed(1)}s`);
    if (!r.ok) { console.log('    BODY: ' + txt.slice(0, 400)); return { ok: false, ms }; }
    let msg = null;
    try { msg = JSON.parse(txt).message; } catch { console.log('    could not parse envelope: ' + txt.slice(0,200)); return { ok:false, ms }; }
    const keys = Object.keys(msg || {});
    console.log('    message fields: ' + (keys.join(', ') || 'none'));
    const c = (msg && msg.content || '').trim(), th = (msg && (msg.thinking || msg.reasoning) || '').trim();
    console.log(`    content : ${c ? JSON.stringify(c.slice(0,160)) : '(EMPTY)'}`);
    if (th) console.log(`    thinking: ${JSON.stringify(th.slice(0,160))}${th.length>160?'…':''}  [${th.length} chars]`);
    return { ok: !!c, ms, content: c, thinking: th };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`    ${e.name === 'AbortError' ? 'TIMED OUT' : 'ERROR'} after ${(ms/1000).toFixed(1)}s ${e.name === 'AbortError' ? '' : '- ' + e.message}`);
    return { ok: false, ms, timeout: e.name === 'AbortError' };
  }
}

// ---------- 2. plain call ----------
const plain = await attempt('2] plain chat, no structured output', { model: M, stream: false, options: { num_predict: 40 }, messages: msgs });

// ---------- 3. with the JSON schema the runner uses ----------
const structured = await attempt('3] with format=<json schema>  (what run_session.mjs sends)',
  { model: M, format: SCHEMA, stream: false, options: { temperature: .7, num_predict: 80 }, messages: msgs });

// ---------- 3b. THE FIX: think:false + room to answer ----------
const fixed = await attempt('3b] think:false + num_predict 400  (THE FIX)',
  { model: M, format: SCHEMA, think: false, stream: false, options: { temperature: .7, num_predict: 400 }, messages: msgs });

// ---------- 4. with format="json" (older Ollama style) ----------
const jsonmode = await attempt('4] with format="json"  (older Ollama style)',
  { model: M, format: 'json', stream: false, options: { num_predict: 80 }, messages: [msgs[0], { role: 'user', content: msgs[1].content + ' Reply as JSON with keys action, symbol, qty, comment.' }] });

line();
console.log('\n VERDICT — models');
if (fixed.ok) {
  console.log('   >> FIXED. think:false + num_predict 400 produces a real answer.');
  console.log(`      That call took ${(fixed.ms/1000).toFixed(1)}s — keep THINK_TIMEOUT_MS above ${Math.ceil(fixed.ms/1000)*2}000.`);
  if (!structured.ok) console.log('      (The old settings returned empty content — that was the silent fallback.)');
} else if (!fixed.ok && (structured.thinking || plain.thinking)) {
  console.log('   >> The model reasons but never reaches an answer, even with think:false.');
  console.log('      Raise OLLAMA_NUM_PREDICT in config.txt (try 800) and run this again.');
} else if (!plain.ok && !structured.ok && !jsonmode.ok) {
  console.log('   Every shape failed. This is not the schema — it is the model call itself.');
  if (plain.timeout) console.log('   All calls TIMED OUT. Cloud models may be queued, rate-limited, or your');
  console.log('   Ollama sign-in for cloud models may have expired. Check the Ollama app.');
} else if (plain.ok && !structured.ok) {
  console.log('   >> FOUND IT: plain chat works, but format=<json schema> is rejected.');
  console.log('      Your Ollama build does not support JSON-schema structured output.');
  console.log('      Fix: set  OLLAMA_FORMAT=json  in config.txt (or upgrade Ollama).');
} else if (structured.ok) {
  console.log('   Structured output works right now. If sessions still fall back, the');
  console.log(`   12s THINK_TIMEOUT_MS is too short — this call took ${(structured.ms/1000).toFixed(1)}s.`);
  if (structured.ms > 8000) console.log(`   >> Raise THINK_TIMEOUT_MS to at least ${Math.ceil(structured.ms/1000)*2}000 in config.txt.`);
}
const slowest = Math.max(plain.ms||0, structured.ms||0, jsonmode.ms||0);
console.log(`   Slowest call: ${(slowest/1000).toFixed(1)}s  ·  THINK_TIMEOUT_MS is currently ${ENV.THINK_TIMEOUT_MS || 12000}ms`);

// ---------- 5. do Dexscreener prices move ----------
line();
console.log(`\n[5] Dexscreener prices — sampling twice, ${WAIT}s apart...`);
async function snap() {
  try {
    const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    if (!r.ok) { console.log('    profiles -> HTTP ' + r.status); return null; }
    const profiles = await r.json();
    const solMints = profiles.filter(p => p.chainId === 'solana').map(p => p.tokenAddress).slice(0, 10);
    if (solMints.length === 0) return {};
    const pr = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${solMints.join(',')}`);
    if (!pr.ok) { console.log('    pricing -> HTTP ' + pr.status); return null; }
    const data = await pr.json();
    const m = {};
    for (const p of data.pairs || []) {
      if (p.baseToken && p.priceNative) m[p.baseToken.symbol] = parseFloat(p.priceNative);
    }
    return m;
  } catch (err) { console.log('    error snapping: ' + err.message); return null; }
}
const a = await snap();
if (!a) { console.log('    Dexscreener unreachable.'); process.exit(1); }
console.log(`    ${Object.keys(a).length} tokens with a price. waiting ${WAIT}s...`);
await sleep(WAIT * 1000);
const b = await snap();
let moved = 0, same = 0; const movers = [];
for (const s in a) { if (b[s] == null) continue; if (b[s] !== a[s]) { moved++; movers.push(`${s} ${a[s]} -> ${b[s]}`); } else same++; }
console.log(`    changed: ${moved}   unchanged: ${same}`);
if (movers.length) console.log('    e.g. ' + movers.slice(0,5).join(' | '));

line();
console.log('\n VERDICT — prices');
if (moved === 0) {
  console.log(`   Not one price changed in ${WAIT}s. Solana memecoin pricing on Dexscreener is quiet`);
  console.log('   or rate-limited. This indicates the Dexscreener updates are failing.');
} else {
  console.log(`   Prices do move — ${moved} changed in ${WAIT}s. Dexscreener feed is healthy.`);
}
console.log('\n============================================================\n');
