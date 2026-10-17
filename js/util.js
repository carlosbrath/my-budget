'use strict';

// Small helpers shared by every file.
const U = {
  uid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (e) { /* not available on some file:// pages */ }
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  },

  now() { return new Date().toISOString(); },

  ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  today() { return U.ymd(new Date()); },
  thisMonth() { return U.today().slice(0, 7); },

  addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  },

  monthLabel(ym, short) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  },

  dateLabel(ds, withYear) {
    const [y, m, d] = ds.split('-').map(Number);
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (withYear) opts.year = 'numeric';
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
  },

  shortDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  daysSince(iso) {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  },

  // Amounts are stored as whole paisa (integer) to avoid rounding errors.
  money(paisa, signed) {
    const v = (paisa || 0) / 100;
    const abs = Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2,
    });
    const sign = v < 0 ? '−' : (signed && v > 0 ? '+' : '');
    return sign + 'Rs ' + abs;
  },

  // Accepts "1,500", "500+250", "3*120" etc. Returns paisa or null.
  parseAmount(str) {
    const s = String(str || '').replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return null;
    if (!/^[0-9+\-*/().]+$/.test(s)) return null;
    try {
      const v = Function('"use strict";return (' + s + ')')();
      if (typeof v !== 'number' || !isFinite(v)) return null;
      return Math.round(v * 100);
    } catch (e) {
      return null;
    }
  },

  // Paisa -> plain number string for input boxes.
  plain(paisa) {
    const v = paisa / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  },

  isExpression(str) { return /[+\-*/]/.test(String(str).replace(/^-/, '')); },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // "▲ 12%" style change text. lowerIsBetter flips the colour.
  delta(cur, prev, lowerIsBetter) {
    if (!prev) return '';
    const diff = cur - prev;
    if (diff === 0) return '<span class="muted">same</span>';
    const pct = Math.round(Math.abs(diff) / prev * 100);
    const up = diff > 0;
    const good = lowerIsBetter ? !up : up;
    return `<span class="${good ? 'delta-good' : 'delta-bad'}">${up ? '▲' : '▼'} ${pct}%</span>`;
  },

  download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  // Phone or tablet (no folder saving there; backups go through the share sheet).
  isMobile() {
    return navigator.userAgentData ? navigator.userAgentData.mobile : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  },

  lsGet(key, def) {
    try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
  },
  lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  },

  _toastTimer: null,
  toast(msg, actionLabel, onAction) {
    const el = document.getElementById('toast');
    el.innerHTML = '<span>' + U.esc(msg) + '</span>' + (actionLabel ? '<button type="button">' + U.esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    if (actionLabel) {
      el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
    }
    clearTimeout(U._toastTimer);
    U._toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 6000 : 2500);
  },
};
