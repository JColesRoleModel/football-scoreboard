// AP Poll tracker: one week's Top 25 with movement, plus a season-long rank chart.

import { getRankingHistory } from '../api.js';
import { esc, logo, teamHref, skeletonTable, emptyState, fmtDate } from '../ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const keyOf = (p) => `${p.seasonType}-${p.week}`;
const shortLabel = (p) => (p.seasonType === 3 ? 'Final' : p.week === 1 ? 'Pre' : `W${p.week}`);

function movement(r, prevPoll) {
  let prev = r.prev;
  if (prev == null && prevPoll) prev = prevPoll.ranks.find((x) => x.team.id === r.team.id)?.rank ?? 0;
  if (prev == null) return '<span class="move same">–</span>';
  if (!prev || prev > 25) return '<span class="move new">NEW</span>';
  const d = prev - r.rank;
  if (d > 0) return `<span class="move up" aria-label="up ${d}">▲ ${d}</span>`;
  if (d < 0) return `<span class="move down" aria-label="down ${-d}">▼ ${-d}</span>`;
  return '<span class="move same" aria-label="no change">–</span>';
}

function listHTML(poll, prevPoll) {
  const rows = poll.ranks.map((r) => `
    <a class="poll-row" href="${teamHref('cfb', r.team.id)}">
      <span class="num">${r.rank}</span>
      ${logo(r.team.logo, r.team.abbr)}
      <span style="min-width:0">
        <div class="nm">${esc(r.team.name)}${r.fpv ? ` <span class="sub">(${r.fpv})</span>` : ''}</div>
        <div class="sub">${esc(r.record)}${r.points ? ` · ${r.points} pts` : ''}</div>
      </span>
      ${movement(r, prevPoll)}
    </a>`).join('');
  const others = poll.others?.length
    ? `<div class="others"><b>Others receiving votes:</b> ${poll.others.map((o) => `<a href="${teamHref('cfb', o.team.id)}">${esc(o.team.name)} ${o.points ?? ''}</a>`).join(', ')}</div>` : '';
  const dropped = poll.droppedOut?.length
    ? `<div class="others"><b>Dropped out:</b> ${poll.droppedOut.map((o) => `${esc(o.team.name)}${o.prev ? ` (${o.prev})` : ''}`).join(', ')}</div>` : '';
  return `<div class="glass">${rows}</div>${others || dropped ? `<div class="glass" style="margin-top:10px">${others}${dropped}</div>` : ''}`;
}

// Bump chart: x = poll week, y = rank (1 at top). Lines break when a team is unranked.
function drawChart(host, polls, caption) {
  const width = Math.max(320, host.clientWidth || 340);
  const pad = { l: 26, r: 30, t: 14, b: 26 };
  const rowH = width < 500 ? 17 : 20;
  const height = pad.t + pad.b + rowH * 24;
  const n = polls.length;
  const x = (i) => pad.l + (n === 1 ? (width - pad.l - pad.r) / 2 : (i * (width - pad.l - pad.r)) / (n - 1));
  const y = (rank) => pad.t + (rank - 1) * rowH;

  const teams = new Map();
  polls.forEach((p, i) => {
    for (const r of p.ranks) {
      if (!teams.has(r.team.id)) teams.set(r.team.id, { team: r.team, pts: [] });
      teams.get(r.team.id).pts.push({ i, rank: r.rank });
    }
  });

  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="AP rank of every ranked team by week">`;
  for (const rank of [1, 5, 10, 15, 20, 25]) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y(rank)}" y2="${y(rank)}"/><text class="axis" x="${pad.l - 8}" y="${y(rank) + 3}" text-anchor="end">${rank}</text>`;
  }
  const step = Math.ceil(n / Math.floor((width - pad.l - pad.r) / 34));
  polls.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) svg += `<text class="axis" x="${x(i)}" y="${height - 8}" text-anchor="middle">${shortLabel(p)}</text>`;
  });

  for (const [id, t] of teams) {
    // Split into runs of consecutive weeks.
    const runs = [];
    for (const pt of t.pts) {
      const run = runs.at(-1);
      if (run && run.at(-1).i === pt.i - 1) run.push(pt); else runs.push([pt]);
    }
    let g = `<g class="team-g" data-id="${esc(id)}" tabindex="0" role="button" aria-label="${esc(t.team.name)}">`;
    for (const run of runs) {
      const d = run.map((pt, k) => `${k ? 'L' : 'M'}${x(pt.i).toFixed(1)} ${y(pt.rank).toFixed(1)}`).join(' ');
      if (run.length > 1) {
        g += `<path d="${d}" stroke="transparent" stroke-width="12" fill="none"/>`;
        g += `<path class="line" d="${d}" stroke="${run.at(-1).i === n - 1 ? 'var(--violet)' : 'var(--faint)'}"/>`;
      }
      for (const pt of run) g += `<circle class="dot" cx="${x(pt.i)}" cy="${y(pt.rank)}" r="2.6" fill="var(--text)" opacity=".7"/>`;
    }
    const end = t.pts.at(-1);
    const s = 18;
    g += `<image href="${esc(t.team.logo)}" data-abbr="${esc(t.team.abbr)}" x="${x(end.i) + 5}" y="${y(end.rank) - s / 2}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet"/>`;
    g += '</g>';
    svg += g;
  }
  svg += '</svg>';
  host.innerHTML = svg;

  const chart = host.querySelector('svg');
  // Swap logos that fail to load for the team abbreviation.
  for (const img of chart.querySelectorAll('image')) {
    img.addEventListener('error', () => {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', Number(img.getAttribute('x')) + 1);
      t.setAttribute('y', Number(img.getAttribute('y')) + 12);
      t.setAttribute('class', 'axis');
      t.style.fill = 'var(--text)';
      t.textContent = img.dataset.abbr;
      img.replaceWith(t);
    }, { once: true });
  }
  let pinned = null;
  const focus = (id) => {
    chart.classList.toggle('has-focus', !!id);
    for (const g of chart.querySelectorAll('.team-g')) {
      const on = g.dataset.id === id;
      g.classList.toggle('focus', on);
      if (on) g.parentNode.appendChild(g); // bring to front
      const line = g.querySelectorAll('.line');
      line.forEach((l) => l.setAttribute('stroke', on ? 'var(--aqua)' : l.dataset.stroke || l.getAttribute('stroke')));
    }
    if (!id) { caption.textContent = 'Tap or hover a line to follow a team.'; return; }
    const t = teams.get(id);
    const ranks = polls.map((p, i) => `${shortLabel(p)} ${t.pts.find((pt) => pt.i === i)?.rank ?? 'NR'}`);
    caption.textContent = `${t.team.name}: ${ranks.join(' · ')}`;
  };
  chart.querySelectorAll('.line').forEach((l) => (l.dataset.stroke = l.getAttribute('stroke')));
  chart.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || pinned) return;
    const g = e.target.closest('.team-g');
    if (g) focus(g.dataset.id);
  });
  chart.addEventListener('pointerleave', () => { if (!pinned) focus(null); });
  chart.addEventListener('click', (e) => {
    const g = e.target.closest('.team-g');
    pinned = g && pinned !== g.dataset.id ? g.dataset.id : null;
    focus(pinned);
  });
  chart.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest('.team-g');
    if (!g) return;
    e.preventDefault();
    pinned = pinned === g.dataset.id ? null : g.dataset.id;
    focus(pinned);
  });
  focus(null);
}

export async function render(el, route, ctx) {
  el.innerHTML = `<div class="toolbar"><h1>AP Top 25</h1><div class="week-picker" id="wp"></div></div><div id="note"></div><div id="body">${skeletonTable(12)}</div>`;
  let polls = [];
  try { polls = await getRankingHistory(); } catch { /* handled below */ }
  if (!ctx.isCurrent()) return;
  if (!polls.length) {
    el.querySelector('#body').innerHTML = emptyState('The AP Poll is unavailable right now', 'No poll could be loaded from ESPN or the saved archive. The poll is released on Sundays during the season.');
    return;
  }

  const sel = polls.findIndex((p) => keyOf(p) === route.week);
  const idx = sel >= 0 ? sel : polls.length - 1;
  const poll = polls[idx];
  const prevPoll = idx > 0 ? polls[idx - 1] : null;

  el.querySelector('#wp').innerHTML = `
    <button class="icon-btn" id="prev" aria-label="Previous poll" ${idx <= 0 ? 'disabled' : ''}>‹</button>
    <label class="visually-hidden" for="wk">Poll week</label>
    <select id="wk">${polls.map((p, i) => `<option value="${keyOf(p)}" ${i === idx ? 'selected' : ''}>${esc(p.seasonType === 3 ? 'Final poll' : p.week === 1 ? 'Preseason' : p.label || `Week ${p.week}`)}</option>`).join('')}</select>
    <button class="icon-btn" id="next" aria-label="Next poll" ${idx >= polls.length - 1 ? 'disabled' : ''}>›</button>`;
  const go = (p) => { if (p) location.hash = `#/poll/${keyOf(p)}`; };
  el.querySelector('#wk').addEventListener('change', (e) => go(polls.find((p) => keyOf(p) === e.target.value)));
  el.querySelector('#prev').addEventListener('click', () => go(polls[idx - 1]));
  el.querySelector('#next').addEventListener('click', () => go(polls[idx + 1]));

  el.querySelector('#note').innerHTML = poll.date ? `<p class="notice">Released ${esc(fmtDate(poll.date))}</p>` : '';
  el.querySelector('#body').innerHTML = `
    ${listHTML(poll, prevPoll)}
    <section class="section" id="season-chart">
      <div class="section-head"><h2>Season at a glance</h2></div>
      <div class="glass chart-wrap"><div id="chart"></div><p class="chart-caption" id="cap" aria-live="polite"></p></div>
    </section>`;

  const host = el.querySelector('#chart');
  const cap = el.querySelector('#cap');
  if (polls.length < 2) {
    cap.textContent = 'The week-by-week chart fills in as more polls are released.';
  }
  drawChart(host, polls, cap);
  let rw = host.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - rw) > 20) { rw = host.clientWidth; drawChart(host, polls, cap); }
  });
  ro.observe(host);
  return () => ro.disconnect();
}
