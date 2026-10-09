// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The static HTML report: one self-contained file rendered from a snapshot (no external script,
// style, font or image). Readable on a phone, light and dark. Every figure names its source and the
// time it was read. The page is a secondary artifact: the snapshot is the product.
import fs from 'node:fs';
import path from 'node:path';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  .replace(/[\u007f-￿]/g, (c) => `&#x${c.charCodeAt(0).toString(16)};`);
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');
const fmt = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const usd = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `$${fmt(n, Number(n) < 10 ? 4 : 2)}`);
const time = (iso) => (iso ? `${esc(iso.slice(0, 16).replace('T', ' '))} UTC` : '—');
const LABEL = { bstocks: 'bStocks', ondo: 'Ondo Stocks', xstocks: 'xStocks' };
const BSCSCAN = (a) => `https://bscscan.com/address/${a}`;
const addrCell = (a) => `<a class="mono" href="${esc(BSCSCAN(a))}" rel="noopener">${esc(a)}</a>`;

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#5f6368;--line:#e3e0d8;--card:#ffffff;--accent:#8a5a00;--ok:#1f7a3a;--bad:#b3261e;--warn:#8a5a00;--chip:#f1eee6;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121212;--fg:#ececec;--muted:#a3a3a3;--line:#2c2c2c;--card:#1b1b1b;--accent:#f0b429;--ok:#5fd38a;--bad:#ff8a80;--warn:#f0b429;--chip:#262626;color-scheme:dark}}
:root[data-theme=dark]{--bg:#121212;--fg:#ececec;--muted:#a3a3a3;--line:#2c2c2c;--card:#1b1b1b;--accent:#f0b429;--ok:#5fd38a;--bad:#ff8a80;--warn:#f0b429;--chip:#262626;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.55rem;line-height:1.25;margin:.2em 0 .3em}h2{font-size:1.2rem;margin:2em 0 .5em;padding-top:.5em;border-top:1px solid var(--line)}h3{font-size:1rem;margin:1.2em 0 .4em}
p{margin:.4em 0 .8em}.muted{color:var(--muted)}.small{font-size:.85rem}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;word-break:break-all}
a{color:var(--accent)}.notice{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px 14px;font-size:.9rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card h3{margin:0 0 4px}.big{font-size:2rem;font-weight:700;line-height:1.1}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:.9rem;margin-top:6px}.kv span:nth-child(odd){color:var(--muted)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.86rem}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--card);font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;white-space:nowrap}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:0 8px;font-size:.78rem;margin:1px 2px 1px 0;white-space:nowrap}
.src{font-size:.8rem;color:var(--muted);margin:.3em 0 1em}
details{margin:.6em 0}summary{cursor:pointer;font-weight:600}
input[type=search]{width:100%;max-width:520px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
.hidden{display:none}footer{margin-top:3em;font-size:.82rem;color:var(--muted)}
`;

const FILTER_JS = `
(function(){var q=document.getElementById('q');if(!q)return;q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();
document.querySelectorAll('tr[data-f]').forEach(function(r){r.classList.toggle('hidden',v.length>1&&r.getAttribute('data-f').indexOf(v)<0)});
if(v.length>1)document.querySelectorAll('details.filterable').forEach(function(d){d.open=true});});})();`;

const src = (snap, ids, at) => {
  const list = [ids].flat().filter(Boolean).map((id) => {
    const s = snap.sources.find((x) => x.id === id);
    return s ? `<span class="chip">${esc(id)}</span>` : `<span class="chip">${esc(id)}</span>`;
  }).join(' ');
  return `<p class="src">Source: ${list}${at ? ` · read ${time(at)}` : ''}</p>`;
};

function familyCards(snap) {
  return `<div class="cards">${Object.entries(snap.summary.families).map(([id, c]) => {
    const fam = snap.families[id];
    const lk = c.lookalikes;
    const roles = c.byRole ? `<div class="kv small"><span>tokens</span><span>${c.byRole.token.genuine} genuine of ${c.byRole.token.listed}</span><span>v2 wrappers</span><span>${c.byRole.wrapper.genuine} genuine of ${c.byRole.wrapper.listed}</span></div>` : '';
    return `<div class="card"><h3>${esc(fam.label)}</h3><div class="muted small">${esc(fam.wording)}</div>
<div class="big ok">${c.genuine}<span class="muted" style="font-size:1rem;font-weight:400"> genuine of ${c.listed} listed</span></div>
<div class="kv"><span>unknown</span><span class="${c.unknown ? 'warn' : ''}">${c.unknown}</span><span>no code on BSC</span><span>${c.noCode}</span><span>look-alikes found</span><span class="${lk ? 'bad' : ''}">${snap.lookalikes.status === 'skipped' ? 'not searched' : `${snap.summary.lookalikes.lowerBound ? '≥ ' : ''}${lk}`}</span><span>issuer list</span><span class="mono">${esc(fam.issuerList)}</span></div>${roles}</div>`;
  }).join('')}</div>`;
}

function rulesTable(snap) {
  const rows = [];
  for (const [id, fam] of Object.entries(snap.families)) {
    for (const [role, r] of Object.entries(fam.fingerprint.roles)) {
      const impls = (r.implementations || []).map((i) => `<span class="chip mono" title="${esc(i.address)}">${esc(short(i.address))} × ${i.count}</span>`).join(' ') || '—';
      rows.push(`<tr><td>${esc(fam.label)}</td><td>${esc(role)}</td><td class="mono" title="${esc(r.codeHash)}">${esc(short(r.codeHash))}</td><td class="num">${fmt(r.codeSize, 0)}</td><td>${esc(r.proxyKind ?? '—')}</td><td class="mono">${esc(r.slot ?? '')} ${esc(r.slotValue ?? '—')}</td><td class="num">${r.members}</td><td class="num ${r.outliers ? 'warn' : ''}">${r.outliers}</td><td>${impls}</td></tr>`);
    }
  }
  return `<div class="scroll"><table><thead><tr><th>Family</th><th>Role</th><th>Code hash</th><th class="num">Bytes</th><th>Proxy</th><th>Slot in the rule</th><th class="num">Fit</th><th class="num">Outliers</th><th>Implementations (reported, not required)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function lookalikesSection(snap) {
  const l = snap.lookalikes;
  if (l.status === 'skipped' || l.status === 'failed') return `<p class="muted">Not run (${esc(l.reason || l.error || l.status)}).</p>`;
  const counts = Object.entries(l.counts).filter(([k]) => k !== 'total').map(([k, n]) => `${esc(LABEL[k])}: ${n}`).join(' · ');
  const rows = l.items.map((it) => `<tr data-f="${esc([it.address, it.symbol, it.name, it.claims.genuineSymbol].join(' ').toLowerCase())}"><td>${esc(LABEL[it.claims.family])}</td><td>${esc(it.symbol ?? '—')}</td><td>${esc(it.name ?? '—')}</td><td>${addrCell(it.address)}</td><td>${it.claims.by.map((b) => `<span class="chip">${esc(b)}</span>`).join('')}</td><td>${it.claims.genuineAddress ? addrCell(it.claims.genuineAddress) : '—'}</td><td class="num">${usd(it.search.liquidityUsd)}</td><td class="num">${esc(it.search.holders ?? '—')}</td><td>${esc(it.search.launchPlatform ?? '—')}</td></tr>`).join('');
  const other = l.otherIssuerClaims.length ? `<details><summary>${l.otherIssuerClaims.length} contracts claim an issuer outside the three families (counted, not judged)</summary><div class="scroll"><table><thead><tr><th>Symbol</th><th>Name</th><th>Address</th><th>Query</th></tr></thead><tbody>${l.otherIssuerClaims.map((o) => `<tr><td>${esc(o.symbol ?? '—')}</td><td>${esc(o.name ?? '—')}</td><td>${addrCell(o.address)}</td><td>${esc(o.query)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  return `<p><strong>${l.counts.total}</strong> contracts on BNB Smart Chain copy the symbol or the name of a genuine contract (${counts}). ${esc(snap.notices.lookalikeCounts)}</p>
<p class="small muted">${esc(l.method)}. ${l.queries} searches, ${l.fullPages} came back full (${l.pageCap} rows).</p>
${src(snap, [l.source, 'bsc-rpc'], l.fetchedAt)}
<details class="filterable" open><summary>All ${l.items.length} look-alikes</summary><div class="scroll"><table><thead><tr><th>Copies</th><th>symbol()</th><th>name()</th><th>Address</th><th>Claim by</th><th>Genuine contract</th><th class="num">Liquidity*</th><th class="num">Holders*</th><th>Launched on*</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small muted">* as reported by the search at the time of the scan.</p></details>${other}`;
}

function marketSection(snap) {
  const m = snap.market;
  const sessions = m.sessions.map((s) => `<li>${esc(LABEL[s.family] ?? s.family)} market (${esc(s.source)}, ${time(s.fetchedAt)}): ${s.openState ? '<span class="ok">open</span>' : '<span class="warn">closed</span>'}${s.marketStatus ? ` — ${esc(s.marketStatus)}` : ''}${s.nextCloseAt ? `, next close ${time(s.nextCloseAt)}` : ''}${s.nextOpenAt ? `, next open ${time(s.nextOpenAt)}` : ''}${s.offhours ? `; off-hours session ${s.offhours.openState ? 'open' : 'closed'}, ${time(s.offhours.nextOpenAt)} → ${time(s.offhours.nextCloseAt)}` : ''}</li>`).join('');
  if (m.status === 'skipped' || m.status === 'failed') return `${sessions ? `<ul>${sessions}</ul>` : ''}<p class="muted">Pools and quotes were not sampled (${esc(m.reason || m.error || m.status)}). They need a Binance Web3 API key.</p>`;
  const q = (it, size) => {
    const x = it.quotes.find((y) => y.sizeUsd === size);
    if (!x) return '<td class="num">—</td>';
    if (x.status === 'error') return `<td class="num warn" title="${esc(x.message)}">${esc(x.code ?? 'error')}</td>`;
    const cost = x.vsTokenPricePct;
    const cls = cost === null || cost === undefined ? 'muted' : (Math.abs(cost) >= 1 ? 'bad' : 'ok');
    return `<td class="num" title="${esc(`${(x.dexes || []).join(', ')}; priceImpactPercent as returned: ${x.priceImpactPercent ?? '—'}; ${x.vendorName ?? ''} ${x.executionMode ?? ''}`)}">${usd(x.effectivePriceUsd)}<br><span class="small ${cls}">${cost === null || cost === undefined ? 'no token price' : `${cost >= 0 ? '+' : ''}${fmt(cost, cost >= 100 ? 0 : 2)}% vs token price`}</span></td>`;
  };
  const rows = m.items.map((it) => `<tr data-f="${esc([it.address, it.symbol, it.underlyingTicker].join(' ').toLowerCase())}"><td>${esc(it.underlyingTicker)}</td><td>${esc(LABEL[it.family])}${it.role === 'wrapper' ? ' <span class="chip">wrapper</span>' : ''}</td><td>${esc(it.symbol)}</td><td>${it.status ? `${esc(it.status.marketStatus ?? '')}${it.status.reasonCode ? ` <span class="chip">${esc(it.status.reasonCode)}</span>` : ''}` : '—'}</td><td class="num">${it.pools?.status === 'ok' ? `${it.pools.count} · ${usd(it.pools.liquidityUsdTotal)}` : esc(it.pools?.status ?? '—')}</td>${m.sizesUsd.map((s) => q(it, s)).join('')}</tr>`).join('');
  return `<ul>${sessions}</ul><p class="small muted">${esc(m.method)}. Each cell: USD paid per token received, and how far that is from the Binance token price of the same run (red from 1%). Quotes are ${esc(m.quoteToken.symbol)} → token; a refusal shows its code (hover for the message). The placeholder wallet sent as userWalletAddress: <span class="mono">${esc(m.walletPlaceholder)}</span>. Empty pools do not mean untradable: equity routes are quoted by RFQ.</p>
${src(snap, m.sources, m.fetchedAt)}
<div class="scroll"><table><thead><tr><th>Ticker</th><th>Family</th><th>Symbol</th><th>Session</th><th class="num">Pools · liquidity</th>${m.sizesUsd.map((s) => `<th class="num">$${s}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function pricesSection(snap) {
  const p = snap.prices;
  if (p.status === 'skipped' || p.status === 'failed') return `<p class="muted">Not run (${esc(p.reason || p.error || p.status)}).</p>`;
  const rows = p.items.map((it) => `<tr data-f="${esc([it.address, it.symbol].join(' ').toLowerCase())}"><td>${esc(LABEL[it.family])}</td><td>${esc(it.symbol)}</td><td class="num">${usd(it.tokenPrice)}</td><td class="num">${usd(it.referencePrice)}</td><td class="num">${fmt(it.tokenOverReference, 6)}</td><td class="num">${esc(it.tokenToShareRatio ?? it.multiplier ?? '—')}</td><td class="num">${it.tokenOverReferenceVsMultiplierPct === null ? '—' : `${fmt(it.tokenOverReferenceVsMultiplierPct, 4)}%`}</td><td class="small">${esc(it.label)}<br>${time(it.tokenPriceUpdatedAt || it.fetchedAt)}</td></tr>`).join('');
  return `<p>${esc(p.caveat)}</p>${src(snap, p.sources, p.fetchedAt)}
<details class="filterable"><summary>${p.items.length} prices</summary><div class="scroll"><table><thead><tr><th>Family</th><th>Symbol</th><th class="num">Token price</th><th class="num">Reference price</th><th class="num">Token ÷ reference</th><th class="num">Multiplier</th><th class="num">Ratio vs multiplier</th><th>What / when</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function unknownSection(snap) {
  const u = snap.tokens.filter((t) => t.verdict === 'unknown');
  if (!u.length) return '<p>None: every listed contract fits its family rule.</p>';
  const rows = u.map((t) => `<tr data-f="${esc([t.address, t.symbol, t.name].join(' ').toLowerCase())}"><td>${esc(LABEL[t.family])}</td><td>${esc(t.symbol ?? '—')}</td><td>${esc(t.name ?? '—')}</td><td>${addrCell(t.address)}</td><td>${esc(t.assetClass ?? '—')}</td><td class="small">${esc(t.explanation)}</td></tr>`).join('');
  return `<p>Listed contracts that do not fit the measured rule are reported, not forced to either side.</p><div class="scroll"><table><thead><tr><th>Family</th><th>symbol()</th><th>name()</th><th>Address</th><th>Class</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function genuineSection(snap) {
  return Object.entries(snap.families).map(([id, fam]) => {
    const g = snap.tokens.filter((t) => t.family === id && t.verdict === 'genuine');
    const rows = g.map((t) => `<tr data-f="${esc([t.address, t.symbol, t.name, t.underlyingTicker].join(' ').toLowerCase())}"><td>${esc(t.symbol ?? '—')}</td><td>${esc(t.underlyingTicker ?? '—')}</td><td>${esc(t.role)}</td><td>${addrCell(t.address)}</td><td class="small">${t.listedBy.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</td></tr>`).join('');
    return `<details class="filterable"><summary>${esc(fam.label)}: ${g.length} genuine contracts</summary><div class="scroll"><table><thead><tr><th>symbol()</th><th>Ticker</th><th>Role</th><th>Address</th><th>Listed by</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join('');
}

function sourcesTable(snap) {
  const rows = snap.sources.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.surface)}</td><td class="mono small">${esc(s.url)}</td><td>${esc(s.status)}</td><td class="num">${s.requests}</td><td>${time(s.fetchedAt)}</td><td class="small">${esc(s.note ?? '')}${s.error ? ` <span class="bad">${esc(s.error)}</span>` : ''}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>Id</th><th>Surface</th><th>Endpoint</th><th>Status</th><th class="num">Requests</th><th>Read</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The report as one HTML document. */
export function renderReport(snap) {
  const notes = Object.values(snap.families).flatMap((f) => f.notes.map((n) => `<li><strong>${esc(f.label)}:</strong> ${esc(n)}</li>`)).join('');
  const s = snap.summary;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock token check BSC</title>
<meta name="description" content="Which bStocks, Ondo Stocks and xStocks contracts on BNB Smart Chain are genuine, which are look-alikes — measured from chain state and the issuers' own lists.">
<style>${CSS}</style></head><body><main>
<p class="small muted">stock-token-verifier ${esc(snap.generator.version)}${snap.generator.gitCommit ? ` (${esc(snap.generator.gitCommit)})` : ''} · snapshot ${time(snap.generatedAt)} · BNB Smart Chain block ${esc(snap.chain.block ?? '—')}</p>
<h1>bStocks, Ondo Stocks and xStocks on BNB Smart Chain: which contracts are genuine</h1>
<p>A contract is <strong>genuine</strong> when its issuer's list has the address <em>and</em> its runtime code and proxy beacon/admin match the rule measured on every contract of that list. A <strong>look-alike</strong> copies the symbol or the name of a genuine contract without being on the list. Anything in between is <strong>unknown</strong>, with the reason.</p>
<div class="notice">${esc(snap.notices.affiliation)} ${esc(snap.notices.advice)}</div>
${familyCards(snap)}
${src(snap, ['bsc-rpc', 'xstocks-api', 'ondo-csv', snap.families.bstocks.issuerList], s.measuredAt)}
<p><input id="q" type="search" placeholder="Filter every table by address, symbol or name" aria-label="Filter by address, symbol or name"></p>
<h2>The rule each family was measured against</h2>
${rulesTable(snap)}
<p class="small muted">${esc(snap.families.xstocks.fingerprint.method)}.</p>
${src(snap, 'bsc-rpc', s.measuredAt)}
${notes ? `<h3>Found while measuring</h3><ul class="small">${notes}</ul>` : ''}
<h2>Look-alikes</h2>
${lookalikesSection(snap)}
<h2>Market reality (sample)</h2>
${marketSection(snap)}
<h2>On-chain price vs Binance reference price</h2>
${pricesSection(snap)}
<h2>Unknown: listed, but outside the rule</h2>
${unknownSection(snap)}
<h2>Genuine contracts</h2>
${genuineSection(snap)}
<h2>Sources</h2>
${sourcesTable(snap)}
<footer><p>${esc(snap.notices.affiliation)}</p><p>${esc(snap.notices.advice)}</p><p>Open source (Apache-2.0): stock-token-verifier by BonyNode. Data: public chain state of BNB Smart Chain and the public lists named above, read at the times shown. Schema ${esc(snap.schema)}.</p></footer>
</main><script>${FILTER_JS}</script></body></html>
`;
}

export function writeReport(file, snapshot) {
  const target = file instanceof URL ? file.pathname : file;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderReport(snapshot));
  return target;
}
