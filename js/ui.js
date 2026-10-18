// Small DOM helpers shared by the views.

import { isCollapsed, setCollapsed } from './prefs.js';

export const $ = (sel, root = document) => root.querySelector(sel);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Team / conference logo with a styled abbreviation badge if the image fails.
export function logo(src, abbr, size = 28, cls = '') {
  const label = esc((abbr || '?').slice(0, 4));
  const style = `width:${size}px;height:${size}px`;
  if (!src) return `<span class="logo logo-badge ${cls}" style="${style}">${label}</span>`;
  return `<img class="logo ${cls}" src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-abbr="${label}" style="${style}">`;
}

// Image errors don't bubble, so catch them in the capture phase once for the whole page.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
  const badge = document.createElement('span');
  badge.className = `${img.className} logo-badge`;
  badge.style.cssText = img.style.cssText;
  badge.textContent = img.dataset.abbr || '?';
  img.replaceWith(badge);
}, true);

export function teamHref(league, id) {
  return id ? `#/team/${league}/${id}` : '#';
}

export function ago(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function sourceNote(res) {
  if (!res?.fallback) return '';
  return `<p class="notice warn" role="status">Live data unavailable, showing the saved snapshot (updated ${esc(ago(res.updated))}).</p>`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export const fmtKickoff = (iso) => timeFmt.format(new Date(iso));
export const fmtDate = (iso) => dateFmt.format(new Date(iso));

export function skeletonCards(n = 6) {
  const card = `<div class="glass skel-card">
    <div class="skel skel-line" style="width:40%"></div>
    <div class="skel-row"><div class="skel c"></div><div class="skel l"></div><div class="skel s"></div></div>
    <div class="skel-row"><div class="skel c"></div><div class="skel l" style="width:70%"></div><div class="skel s"></div></div>
  </div>`;
  return `<div class="section"><div class="skel skel-line" style="width:140px;height:22px;margin-bottom:12px"></div><div class="grid">${card.repeat(n)}</div></div>`;
}

export function skeletonTable(rows = 8) {
  const row = `<div class="skel-row"><div class="skel c" style="width:22px;height:22px"></div><div class="skel l"></div><div class="skel s" style="height:14px"></div></div>`;
  return `<div class="glass skel-card">${row.repeat(rows)}</div>`;
}

export function emptyState(title, body = '') {
  return `<div class="glass empty"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
}

export function setChips(items) {
  const el = document.getElementById('chips');
  if (!items?.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = items.map((c) => `<button type="button" class="chip" data-target="${esc(c.target)}">${c.logo !== undefined ? logo(c.logo, c.abbr, 16) : ''}${esc(c.label)}</button>`).join('');
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-target]');
  if (!chip) return;
  document.getElementById(chip.dataset.target)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

// ---- Collapsible sections ----
// A header button with a chevron on the right; open/closed state is remembered on this device.

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function collapsible({ key, id = '', head, body, cls = '', level = 'section' }) {
  const closed = isCollapsed(key);
  const bodyId = `body-${key.replace(/[^\w-]/g, '_')}`;
  return `<section class="${level === 'conf' ? 'conf-block' : 'section'} collapsible ${cls}${closed ? ' collapsed' : ''}"${id ? ` id="${esc(id)}"` : ''} data-key="${esc(key)}">
    <button type="button" class="${level === 'conf' ? 'conf-head' : 'section-head'} toggle" aria-expanded="${!closed}" aria-controls="${bodyId}">
      ${head}${CHEVRON}
    </button>
    <div class="collapse-body" id="${bodyId}"${closed ? ' hidden' : ''}>${body}</div>
  </section>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.collapsible > .toggle');
  if (!btn) return;
  const sec = btn.parentElement;
  const closed = !sec.classList.contains('collapsed');
  sec.classList.toggle('collapsed', closed);
  btn.setAttribute('aria-expanded', String(!closed));
  sec.querySelector(':scope > .collapse-body').hidden = closed;
  setCollapsed(sec.dataset.key, closed);
});

// ---- Toasts ----
export function toast(msg, ms = 4000) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast glass';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
