'use strict';

// Keeps the data in a real file on disk, so it survives the browser clearing its storage.
// You pick a folder once. Every change is then written to <folder>/budget-data.json, and one
// copy per day goes to <folder>/backups/. On startup the file is read back, so the file
// (not the browser) is the real copy. Uses the File System Access API (Chrome / Edge).
const FileStore = {
  FILE: 'budget-data.json',
  KEEP_DAILY: 60,

  dir: null,          // FileSystemDirectoryHandle of the data folder
  perm: 'none',       // 'none' (no folder) | 'prompt' (needs a click to allow) | 'granted'
  dirty: false,       // changes not yet written to the file
  syncedAt: null,     // savedAt of the file version this browser last matched
  lastDaily: null,    // date of the last copy in backups/
  saving: false,
  error: '',
  _timer: null,
  _again: false,

  get supported() { return 'showDirectoryPicker' in window && DB.mode === 'IndexedDB'; },
  get ok() { return this.perm === 'granted' && !this.error; },

  async init() {
    if (!this.supported) return;
    this.dir = (await DB.kvGet('dataDir')) || null;
    this.dirty = !!(await DB.kvGet('dirty'));
    this.syncedAt = (await DB.kvGet('syncedAt')) || null;
    this.lastDaily = (await DB.kvGet('lastDaily')) || null;
    // Write pending changes before the window is hidden or closed.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this._timer) { clearTimeout(this._timer); this._timer = null; this.write(); }
    });
    if (!this.dir) return;
    this.perm = (await this.dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
    if (this.perm === 'granted') await this.sync();
  },

  // ---------- user actions ----------
  async connect() {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'budget-data', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e.name !== 'AbortError') U.toast('Could not open that folder: ' + e.message);
      return;
    }
    this.dir = dir;
    this.perm = 'granted';
    this.error = '';
    this.syncedAt = null; // new folder: compare from scratch
    await DB.kvSet('dataDir', dir);
    await DB.kvSet('syncedAt', null);
    await this.sync();
    U.toast('Data folder connected: ' + dir.name);
    App.render();
  },

  async reconnect() {
    if (!this.dir) return this.connect();
    const p = await this.dir.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') { U.toast('Permission not given — data is not being saved to the file'); return; }
    this.perm = 'granted';
    this.error = '';
    await this.sync();
    App.render();
  },

  // ---------- change tracking ----------
  changed() {
    if (!this.supported || Store.seeding) return;
    if (!this.dirty) { this.dirty = true; DB.kvSet('dirty', true); }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.write(); }, 400);
  },

  // Bring browser and file in line after connecting/reconnecting.
  async sync() {
    let file = null;
    try {
      file = await this.readFile();
    } catch (e) {
      this.error = e.message;
      return;
    }
    if (!file) { await this.write(); return; } // empty folder: save what we have

    if (!this.dirty) {
      if (file.savedAt !== this.syncedAt) await this.load(file);
      return;
    }
    if (file.savedAt === this.syncedAt) { await this.write(); return; } // only the browser changed

    // Both changed since they last matched — ask which one to keep.
    const fileN = (file.data.entries || []).filter(e => !e.deleted).length;
    const appN = Store.entries().length;
    const useFile = confirm(
      `Your data file and this app both have changes.\n\n` +
      `Data file: ${fileN} entries, saved ${new Date(file.savedAt).toLocaleString()}\n` +
      `This app: ${appN} entries\n\n` +
      `OK = use the data file\nCancel = keep this app's data (the file's version is kept as a backup copy)`);
    if (useFile) {
      await this.load(file);
    } else {
      await this.writeCopy(`budget-conflict-${file.savedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(file, null, 1));
      await this.write();
    }
  },

  // ---------- file I/O ----------
  async readFile() {
    let fh;
    try { fh = await this.dir.getFileHandle(this.FILE); } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
    const text = await (await fh.getFile()).text();
    if (!text.trim()) return null;
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'my-budget' || !obj.data || !Array.isArray(obj.data.entries)) {
      throw new Error(`${this.FILE} in that folder is not a My Budget data file`);
    }
    return obj;
  },

  async load(file) {
    await DB.replaceAll(file.data);
    for (const s of DB.STORES) Store.S[s] = await DB.getAll(s);
    if (typeof Form !== 'undefined' && Form.editingId) Form.cancelEdit();
    await this.markSynced(file.savedAt);
    if (Store.S.heads.length) await Lock.migrate();
  },

  async write() {
    if (!this.dir || this.perm !== 'granted') { this.renderStatus(); return; }
    if (this.saving) { this._again = true; return; }
    this.saving = true;
    this.renderStatus();
    try {
      if ((await this.dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        this.perm = 'prompt';
        App.renderBanner();
        return;
      }
      const savedAt = U.now();
      const data = {};
      DB.STORES.forEach(s => { data[s] = Store.S[s]; });
      const text = JSON.stringify({ app: 'my-budget', version: 1, savedAt, exportedAt: savedAt, data }, null, 1);
      await this.writeText(this.dir, this.FILE, text);
      await this.markSynced(savedAt);
      this.error = '';
      if (this.lastDaily !== U.today()) await this.writeDaily(text);
    } catch (e) {
      console.error(e);
      if (!this.error) U.toast('Could not save to the data file: ' + e.message);
      this.error = e.message;
    } finally {
      this.saving = false;
      this.renderStatus();
      if (this._again) { this._again = false; this.write(); }
    }
  },

  async writeDaily(text) {
    const today = U.today();
    const bdir = await this.dir.getDirectoryHandle('backups', { create: true });
    await this.writeText(bdir, `budget-${today}.json`, text);
    this.lastDaily = today;
    await DB.kvSet('lastDaily', today);

    // Keep only the newest KEEP_DAILY daily copies.
    const names = [];
    for await (const [name] of bdir.entries()) if (/^budget-\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
    names.sort().slice(0, -this.KEEP_DAILY).forEach(n => bdir.removeEntry(n).catch(() => {}));
  },

  async writeCopy(name, text) {
    const bdir = await this.dir.getDirectoryHandle('backups', { create: true });
    await this.writeText(bdir, name, text);
  },

  // createWritable writes to a temp file and swaps it in on close, so a crash never leaves a half-written file.
  async writeText(dir, name, text) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  },

  async markSynced(savedAt) {
    this.syncedAt = savedAt;
    this.dirty = false;
    await DB.kvSet('syncedAt', savedAt);
    await DB.kvSet('dirty', false);
  },

  // ---------- UI ----------
  renderStatus() {
    const el = document.getElementById('fileStatus');
    if (!el) return;
    if (!this.supported) { el.hidden = true; return; }
    el.hidden = false;
    let cls = 'warn', text = 'Not saved to file', title = 'Choose a folder to save your data in';
    if (this.dir && this.perm === 'prompt') { text = 'Reconnect file'; title = 'Click to allow saving to ' + this.dir.name; }
    else if (this.dir && this.error) { text = 'Save failed'; title = this.error; }
    else if (this.dir) {
      cls = 'ok';
      text = this.saving || this.dirty ? 'Saving…' : 'Saved';
      title = `Saved to folder "${this.dir.name}" / ${this.FILE}`;
    }
    el.className = 'file-status ' + cls;
    el.textContent = text;
    el.title = title;
  },

  // Banner shown when data is not reaching the file. Returns '' when all is well.
  bannerHtml() {
    if (!this.supported) return '';
    if (!this.dir) {
      return `<div class="banner"><span><b>Keep your data safe:</b> choose a folder on your computer (e.g. D:\\Budget Data). Every change will be saved there as a file.</span>
        <button class="btn small primary" data-action="connectFolder">Choose folder</button></div>`;
    }
    if (this.perm === 'prompt') {
      return `<div class="banner"><span>Allow the app to keep saving to your data folder <b>${U.esc(this.dir.name)}</b>.</span>
        <button class="btn small primary" data-action="reconnectFolder">Allow</button></div>`;
    }
    return '';
  },
};
