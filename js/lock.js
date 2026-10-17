'use strict';

// Optional PIN for the Report tab. The PIN is kept (hashed, never in plain text) in the
// data itself — meta 'reportPin' — so it is saved in the data file with everything else.
//   meta 'reportPin' : { salt, hash }  PIN is set
//                      null / missing  no PIN — the report is open and a reminder suggests setting one
// Note: this only hides the report from casual viewers; anyone with the data file can read the data.
const PIN_REMIND_DAYS = 7;

const Lock = {
  unlocked: false, // resets every time the app is opened

  get hasPin() { return !!Store.meta('reportPin'); },
  get isOpen() { return !this.hasPin || this.unlocked; },

  // One-time cleanup: an earlier version gave existing data the old fixed PIN 1437 automatically.
  async migrate() {
    if (Store.meta('pinCleanup1437')) return;
    if (await this.check('1437')) await Store.setMeta('reportPin', null);
    await Store.setMeta('pinCleanup1437', true);
  },

  async hash(pin, salt) {
    const text = salt + ':' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for pages without crypto.subtle (FNV-1a). Fine for a casual-viewer lock.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv-' + h.toString(16);
  },

  async check(pin) {
    const p = Store.meta('reportPin');
    return !!p && (await this.hash(pin, p.salt)) === p.hash;
  },

  async savePin(pin) {
    if (pin === null) return Store.setMeta('reportPin', null);
    const salt = U.uid();
    await Store.setMeta('reportPin', { salt, hash: await this.hash(pin, salt) });
  },

  // ---------- reminder ----------
  shouldRemind() {
    if (this.hasPin || !Store.entries().length) return false;
    const snoozed = Store.meta('pinReminderAt');
    return !snoozed || U.daysSince(snoozed) >= PIN_REMIND_DAYS;
  },
  async snooze() {
    await Store.setMeta('pinReminderAt', U.now());
    App.render();
  },
  bannerHtml() {
    return `<div class="banner"><span><b>Your report is not protected.</b> Set a 4-digit PIN so others can't see it.</span>
      <span style="display:flex;gap:8px"><button class="btn small primary" data-action="setPin">Set PIN</button>
      <button class="btn small ghost" data-action="snoozePin">Not now</button></span></div>`;
  },

  // ---------- settings card (shown in the Settings tab) ----------
  cardHtml() {
    return `<div class="card">
      <div class="card-head"><h2>Report PIN</h2></div>
      ${this.hasPin
        ? `<p class="muted" style="margin-top:0">The Report tab asks for your 4-digit PIN each time the app is opened.</p>
           <div style="display:flex;gap:8px;flex-wrap:wrap">
             <button class="btn" data-action="changePin">Change PIN</button>
             <button class="btn danger" data-action="removePin">Remove PIN</button>
           </div>`
        : `<p class="muted" style="margin-top:0">No PIN set — anyone using this computer can see the report.</p>
           <button class="btn primary" data-action="setPin">Set PIN</button>`}
    </div>`;
  },

  // ---------- flows ----------
  async unlock() {
    const ok = await this.ask({
      title: 'Enter PIN', text: 'The report is protected. Enter your 4-digit PIN.',
      validate: async pin => (await this.check(pin)) ? '' : 'Wrong PIN. Try again.',
    });
    if (ok === null) return;
    this.unlocked = true;
    App.render();
  },

  async setPin() {
    const pin = await this.askNew('Set PIN');
    if (pin === null) return;
    await this.savePin(pin);
    this.unlocked = true; // you just chose it, no need to type it again now
    U.toast('PIN set');
    App.render();
  },

  async changePin() {
    if (await this.askCurrent('Change PIN') === null) return;
    const pin = await this.askNew('Change PIN');
    if (pin === null) return;
    await this.savePin(pin);
    U.toast('PIN changed');
    App.render();
  },

  async removePin() {
    if (await this.askCurrent('Remove PIN') === null) return;
    await this.savePin(null);
    await Store.setMeta('pinReminderAt', U.now()); // they chose this; don't nag right away
    U.toast('PIN removed — the report is open');
    App.render();
  },

  askCurrent(title) {
    return this.ask({
      title, text: 'Enter your current PIN.',
      validate: async pin => (await this.check(pin)) ? '' : 'Wrong PIN. Try again.',
    });
  },

  async askNew(title) {
    const pin = await this.ask({ title, text: 'Choose a new 4-digit PIN.' });
    if (pin === null) return null;
    const again = await this.ask({
      title, text: 'Type the new PIN again to confirm.',
      validate: async p => p === pin ? '' : "PINs don't match. Try again.",
    });
    return again === null ? null : pin;
  },

  // Modal asking for 4 digits. Resolves with the PIN, or null if cancelled.
  // validate(pin) returns an error message to show (and keep asking), or '' to accept.
  ask({ title, text, validate = async () => '' }) {
    this.close();
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.id = 'pinModal';
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="pinTitle" autocomplete="off" novalidate>
        <h3 id="pinTitle">${U.esc(title)}</h3>
        <p class="muted">${U.esc(text)}</p>
        <input id="pinInput" class="pin-input" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" aria-label="PIN">
        <p class="form-error" id="pinError" role="alert"></p>
        <div class="form-actions">
          <button type="submit" class="btn primary">OK</button>
          <button type="button" class="btn" id="pinCancel">Cancel</button>
        </div>
      </form>`;
      document.body.appendChild(wrap);

      const input = wrap.querySelector('#pinInput');
      const error = wrap.querySelector('#pinError');
      const done = value => { this.close(); resolve(value); };
      const submit = async () => {
        if (!/^\d{4}$/.test(input.value)) { error.textContent = 'Enter 4 digits.'; input.focus(); return; }
        const msg = await validate(input.value);
        if (!msg) return done(input.value);
        error.textContent = msg;
        input.value = '';
        input.focus();
      };

      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '');
        error.textContent = '';
        if (input.value.length === 4) submit();
      });
      wrap.querySelector('form').onsubmit = e => { e.preventDefault(); submit(); };
      wrap.querySelector('#pinCancel').onclick = () => done(null);
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
      wrap.addEventListener('click', e => { if (e.target === wrap) done(null); });
      input.focus();
    });
  },

  // Shown in #view while the report is locked.
  renderLocked(el) {
    el.innerHTML = `<div class="card lock-card">
      <div class="lock-icon" aria-hidden="true">&#128274;</div>
      <h3>Report is locked</h3>
      <p class="muted">Enter your PIN to view the report.</p>
      <button class="btn primary" data-action="unlockReport">Enter PIN</button>
    </div>`;
  },

  close() {
    document.getElementById('pinModal')?.remove();
  },
};
