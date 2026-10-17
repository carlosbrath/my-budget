'use strict';

const App = {
  period: { mode: 'month', ym: U.thisMonth() },
  tab: U.lsGet('budget.tab', 'report'),
  views: {
    report: Reports, entries: Entries, check: Check, people: People,
    committees: Committees, heads: Heads, backup: Backup,
  },

  async init() {
    const theme = U.lsGet('budget.theme', null);
    if (theme) document.documentElement.dataset.theme = theme;

    try {
      await Store.load();
    } catch (e) {
      document.getElementById('view').innerHTML = `<div class="card"><b>Could not open storage.</b><p class="muted">${U.esc(e.message || e)}</p></div>`;
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    this.setupInstall();

    if (!this.views[this.tab]) this.tab = 'report';
    Form.init();
    this.bind();
    this.render();
    if (!document.getElementById('pinModal')) Form.focus();
  },

  bind() {
    const $ = id => document.getElementById(id);
    $('prevMonth').onclick = () => this.shiftMonth(-1);
    $('nextMonth').onclick = () => this.shiftMonth(1);
    $('thisMonthBtn').onclick = () => { this.period = { mode: 'month', ym: U.thisMonth() }; this.render(); };
    $('periodMode').onclick = e => {
      const b = e.target.closest('[data-mode]');
      if (b) { this.period.mode = b.dataset.mode; this.render(); }
    };
    $('tabs').onclick = e => {
      const b = e.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    };
    $('themeToggle').onclick = () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      const next = dark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      U.lsSet('budget.theme', next);
    };

    // One click handler for every [data-action] button in the views and banner.
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = this.actions[el.dataset.action];
      if (fn) { e.preventDefault(); fn(el); }
    });

    // Enter in small "add" inputs triggers their button.
    document.getElementById('view').addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      const btn = e.target.closest('.inline-form')?.querySelector('[data-action]');
      if (btn) { e.preventDefault(); btn.click(); }
    });

    // "/" jumps to the amount box.
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        Form.focus();
      }
    });

    window.addEventListener('unhandledrejection', e => {
      console.error(e.reason);
      U.toast('Something went wrong: ' + (e.reason && e.reason.message || e.reason));
    });
  },

  actions: {
    goTab: el => App.setTab(el.dataset.tab),
    unlockReport: () => Lock.unlock(),
    setPin: () => Lock.setPin(),
    changePin: () => Lock.changePin(),
    removePin: () => Lock.removePin(),
    snoozePin: () => Lock.snooze(),
    goMonth: el => { App.period = { mode: 'month', ym: el.dataset.ym }; App.render(); },
    filterHead: el => { Entries.filter = { q: '', type: '', headId: el.dataset.id }; App.setTab('entries'); },

    editEntry: el => Form.edit(el.dataset.id),
    deleteEntry: async el => {
      const e = Store.get('entries', el.dataset.id);
      await Store.remove('entries', e.id);
      if (Form.editingId === e.id) Form.cancelEdit();
      U.toast('Entry deleted', 'Undo', async () => { await Store.update('entries', e.id, { deleted: false }); App.render(); });
      App.render();
    },

    saveCheck: () => Check.save(),
    undoCheck: () => Check.undoLast(),
    copyLast: () => Check.copyLast(),
    addAccount: () => Check.addAccount(),
    renameAccount: el => Check.renameAccount(el.dataset.id),
    archiveAccount: el => Check.archiveAccount(el.dataset.id),

    addPerson: () => People.add(),
    renamePerson: el => People.rename(el.dataset.id),
    deletePerson: el => People.remove(el.dataset.id),
    togglePerson: el => {
      const id = el.dataset.id;
      if (People.open.has(id)) People.open.delete(id); else People.open.add(id);
      App.render();
    },
    quickPerson: el => Form.prefill(el.dataset.kind, el.dataset.type, {
      person: el.dataset.name, amount: el.dataset.amount ? Number(el.dataset.amount) : null,
    }),

    addCommittee: () => Committees.addFromForm(),
    editCommittee: el => Committees.edit(el.dataset.id),
    closeCommittee: el => Committees.toggleClosed(el.dataset.id),
    deleteCommittee: el => Committees.remove(el.dataset.id),
    payCommittee: el => Form.prefill('committee', 'committee_pay', { committeeId: el.dataset.id }),
    receiveCommittee: el => Form.prefill('committee', 'committee_receive', { committeeId: el.dataset.id }),

    addHead: el => Heads.add(el.dataset.type),
    addSubHead: el => Heads.addSub(el.dataset.id),
    renameHead: el => Heads.rename(el.dataset.id),
    moveHead: el => Heads.move(el.dataset.id),
    archiveHead: el => Heads.toggleArchive(el.dataset.id),
    deleteHead: el => Heads.remove(el.dataset.id),

    connectFolder: () => FileStore.connect(),
    reconnectFolder: () => FileStore.reconnect(),
    fileStatus: () => {
      if (!FileStore.dir) FileStore.connect();
      else if (FileStore.perm === 'prompt') FileStore.reconnect();
      else App.setTab('backup');
    },
    installApp: () => App.install(),

    exportJson: () => Backup.exportJson(),
    exportCsv: el => Backup.exportCsv(el.dataset.scope),
  },

  // Installable app: service worker (offline) + an "Install app" button when the browser offers it.
  installPrompt: null,
  setupInstall() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
    }
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.installPrompt = e;
      document.getElementById('installBtn').hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      document.getElementById('installBtn').hidden = true;
      U.toast(U.isMobile() ? 'App installed — open it from your home screen' : 'App installed — open it from the Start menu or desktop');
    });
    // Phones often never offer a one-tap install (iPhone never does), so the button is always
    // there on mobile and explains the steps instead.
    const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (U.isMobile() && !installed && location.protocol === 'https:') document.getElementById('installBtn').hidden = false;
  },

  install() {
    const p = this.installPrompt;
    if (p) {
      this.installPrompt = null;
      p.prompt();
      p.userChoice.then(c => { if (c.outcome === 'accepted') document.getElementById('installBtn').hidden = true; });
      return;
    }
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|; wv\)/i.test(ua);
    const steps = inApp
      ? `<p>This page is open inside another app (WhatsApp, Facebook, Instagram…), which can't install apps.</p>
         <ol><li>Tap the <b>⋮</b> or <b>…</b> menu.</li><li>Choose <b>Open in Chrome</b>${ios ? ' / <b>Open in Safari</b>' : ''}.</li><li>Tap <b>Install app</b> again there.</li></ol>`
      : ios
        ? `<ol><li>Tap the <b>Share</b> button <span aria-hidden="true">(square with an arrow ↑)</span>${/CriOS/.test(ua) ? ' in the address bar' : ' at the bottom of Safari'}.</li>
             <li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>`
        : `<ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu (top right).</li>
             <li>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</li></ol>`;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="installTitle">
      <h3 id="installTitle">Install My Budget</h3>
      <div class="install-steps">${steps}</div>
      <p class="muted">It then opens from your home screen like an app and works offline.</p>
      <div class="form-actions"><button type="button" class="btn primary">OK</button></div>
    </div>`;
    const close = () => wrap.remove();
    wrap.querySelector('button').onclick = close;
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
  },

  shiftMonth(n) {
    this.period = { mode: 'month', ym: U.addMonths(this.period.ym, n) };
    this.render();
  },

  setTab(tab) {
    this.tab = tab;
    U.lsSet('budget.tab', tab);
    this.render();
    window.scrollTo({ top: 0 });
  },

  periodEntries() {
    return this.period.mode === 'month' ? Store.inMonth(this.period.ym) : Store.entries();
  },

  render() {
    const P = this.period;
    const isMonth = P.mode === 'month';
    document.getElementById('periodLabel').textContent = isMonth ? U.monthLabel(P.ym) : 'All time';
    document.getElementById('prevMonth').disabled = !isMonth;
    document.getElementById('nextMonth').disabled = !isMonth;
    document.querySelectorAll('#periodMode [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === P.mode));
    document.getElementById('thisMonthBtn').classList.toggle('hidden', isMonth && P.ym === U.thisMonth());
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === this.tab));

    this.renderBanner();
    FileStore.renderStatus();
    const view = document.getElementById('view');
    if (this.tab === 'report' && !Lock.isOpen) {
      Lock.renderLocked(view);
      if (!document.getElementById('pinModal')) Lock.unlock();
    } else {
      this.views[this.tab].render(view);
    }
    Form.refresh();
  },

  renderBanner() {
    const el = document.getElementById('banner');
    const hasData = Store.entries().length > 0;
    const last = Store.meta('lastBackup');
    let html = FileStore.bannerHtml();
    if (html) {
      // data is not reaching the file — that matters most
    } else if (!Store.lastCheck() && this.tab !== 'check') {
      html = `<div class="banner"><span><b>Start here:</b> enter how much money is in each account right now.</span>
        <button class="btn small" data-action="goTab" data-tab="check">Enter balances</button></div>`;
    } else if (Lock.shouldRemind()) {
      html = Lock.bannerHtml();
    } else if (hasData && !(FileStore.dir && FileStore.ok) && (!last || U.daysSince(last) >= 7) && this.tab !== 'backup') {
      html = `<div class="banner"><span>${last ? `Last backup was ${U.daysSince(last)} days ago.` : 'You haven\'t made a backup yet.'} Your data lives only ${U.isMobile() ? 'on this phone' : 'in this browser'}.</span>
        <button class="btn small" data-action="exportJson">${Backup.canShare() ? 'Save backup' : 'Download backup'}</button></div>`;
    }
    el.innerHTML = html;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
