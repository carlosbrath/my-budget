'use strict';

const Backup = {
  render(el) {
    const last = Store.meta('lastBackup');
    const counts = DB.STORES.filter(s => s !== 'meta').map(s => `${s}: ${Store.live(s).length}`).join(' · ');
    const F = FileStore;
    const folderCard = !F.supported
      ? `<div class="card">
          <div class="card-head"><h2>Data folder</h2></div>
          <p class="muted" style="margin:0">${U.isMobile()
            ? 'On a phone your data is kept inside the app. Uninstalling the app or clearing its data deletes it, so save a backup every week (e.g. to Google Drive or WhatsApp).'
            : `Saving to a folder on your computer needs Chrome or Edge${DB.mode !== 'IndexedDB' ? ' (and browser storage turned on)' : ''}.
              In this browser your data lives only inside the browser, so download a backup every week.`}</p>
        </div>`
      : `<div class="card">
          <div class="card-head"><h2>Data folder</h2></div>
          ${F.dir ? `<p style="margin-top:0">Your data is saved as a file in the folder <b>${U.esc(F.dir.name)}</b>:</p>
            <ul class="muted">
              <li><b>${F.FILE}</b> — updated after every change</li>
              <li><b>backups/</b> — one copy per day, the last ${F.KEEP_DAILY} days are kept</li>
            </ul>
            <p class="muted">Status: <b>${F.perm === 'prompt' ? 'waiting for permission' : F.error ? 'save failed — ' + U.esc(F.error) : 'saved'}</b>.
              Even if the browser clears its data, choose this folder again and everything comes back.
              Put the folder inside Google Drive / OneDrive to also have it in the cloud.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${F.perm === 'prompt' ? '<button class="btn primary" data-action="reconnectFolder">Allow saving</button>' : ''}
              <button class="btn" data-action="connectFolder">Change folder</button>
            </div>`
          : `<p class="muted" style="margin-top:0">Right now your data is only inside the browser, which can clear it.
              Choose a folder (e.g. <b>D:\\Budget Data</b>) and every change is saved there as a file, with a daily backup copy.
              If the folder already has a data file, it is loaded.</p>
            <button class="btn primary" data-action="connectFolder">Choose folder</button>`}
        </div>`;

    el.innerHTML = Lock.cardHtml() + folderCard + `
      <div class="card">
        <div class="card-head"><h2>Backup</h2></div>
        <p class="muted" style="margin-top:0">${F.ok && F.dir
          ? 'Your data folder already keeps daily backups. You can also download a copy by hand.'
          : 'Download a backup every week and keep it somewhere safe (e.g. Google Drive).'}</p>
        <p>Last backup: <b>${last ? U.shortDate(last.slice(0, 10)) + ` (${U.daysSince(last)} days ago)` : 'never'}</b></p>
        <button class="btn primary" data-action="exportJson">${Backup.canShare() ? 'Save / share backup' : 'Download backup'}</button>
      </div>

      <div class="card">
        <div class="card-head"><h2>Restore</h2></div>
        <p class="muted" style="margin-top:0">Load a backup file. <b>This replaces everything</b> currently in the app.</p>
        <input type="file" id="importFile" accept=".json,application/json">
      </div>

      <div class="card">
        <div class="card-head"><h2>Export for Excel</h2></div>
        <p class="muted" style="margin-top:0">CSV file of entries, opens in Excel or Google Sheets.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-action="exportCsv" data-scope="period">${App.period.mode === 'month' ? U.monthLabel(App.period.ym) : 'All entries'}</button>
          ${App.period.mode === 'month' ? '<button class="btn" data-action="exportCsv" data-scope="all">All entries</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>About your data</h2></div>
        <p class="muted" style="margin:0">Working copy: ${DB.mode}${F.dir ? ' · File: ' + U.esc(F.dir.name) + '/' + F.FILE : ''} · ${counts}</p>
      </div>`;

    el.querySelector('#importFile').addEventListener('change', ev => this.importJson(ev.target.files[0]));
  },

  // On phones, hand the backup file to the share sheet (Google Drive, WhatsApp, Files…).
  canShare() {
    try {
      return U.isMobile() && !!navigator.canShare &&
        navigator.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] });
    } catch (e) { return false; }
  },

  async exportJson() {
    const data = {};
    DB.STORES.forEach(s => { data[s] = Store.S[s]; });
    const payload = { app: 'my-budget', version: 1, exportedAt: U.now(), data };
    const name = `budget-backup-${U.today()}.json`;
    const text = JSON.stringify(payload, null, 1);

    if (this.canShare()) {
      // Share first: it must run straight from the button tap.
      try {
        await navigator.share({ files: [new File([text], name, { type: 'application/json' })], title: 'My Budget backup' });
      } catch (e) {
        if (e.name === 'AbortError') return; // closed the share sheet: no backup made
        U.download(name, text, 'application/json');
      }
      U.toast('Backup saved');
    } else {
      U.download(name, text, 'application/json');
      U.toast('Backup downloaded');
    }
    await Store.setMeta('lastBackup', U.now());
    App.render();
  },

  async importJson(file) {
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { U.toast('That file is not a valid backup'); return; }
    if (!obj || obj.app !== 'my-budget' || !obj.data || !Array.isArray(obj.data.entries)) {
      U.toast('That file is not a My Budget backup');
      return;
    }
    const when = obj.exportedAt ? U.shortDate(obj.exportedAt.slice(0, 10)) : 'unknown date';
    if (!confirm(`Replace ALL current data with the backup from ${when} (${obj.data.entries.filter(e => !e.deleted).length} entries)?`)) return;
    await DB.replaceAll(obj.data);
    for (const s of DB.STORES) Store.S[s] = await DB.getAll(s);
    await Lock.migrate();
    FileStore.changed();
    if (Form.editingId) Form.cancelEdit();
    U.toast('Backup restored');
    App.render();
  },

  exportCsv(scope) {
    const list = (scope === 'all' ? Store.entries() : App.periodEntries())
      .slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Date', 'Type', 'Head / Description', 'Person', 'Committee', 'Amount', 'Money in/out', 'Note']];
    list.forEach(e => {
      const p = Store.get('people', e.personId);
      const c = Store.get('committees', e.committeeId);
      rows.push([
        e.date, TYPES[e.type].label,
        e.headId ? Store.headPath(e.headId, ' > ') : Store.describe(e),
        p ? p.name : '', c ? c.name : '',
        (e.amount / 100).toFixed(2), ((TYPES[e.type].flow * e.amount) / 100).toFixed(2),
        e.note || '',
      ]);
    });
    const name = scope === 'all' || App.period.mode === 'all' ? 'all' : App.period.ym;
    U.download(`budget-${name}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  },
};
