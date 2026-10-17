'use strict';

// Weekly / monthly balance check: type what each account really shows,
// compare with what the entries say it should be, and record the difference.
const Check = {
  render(el) {
    const last = Store.lastCheck();
    const accounts = Store.accountsActive();
    const first = !last;

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>${first ? 'Starting balances' : 'New balance check'}</h2>
          ${last ? `<span class="muted">Last check: ${U.shortDate(last.date)}</span>` : ''}
        </div>
        <p class="muted" style="margin-top:0">${first
          ? 'Type how much money is in each account right now. This is your starting point — later checks compare against it.'
          : 'Open each app / wallet and type the balance it shows. The difference from the expected total gets recorded so your sheet stays balanced.'}</p>

        <div class="inline-form" style="margin-bottom:12px">
          <label class="muted" for="cDate">Check date</label>
          <input type="date" id="cDate" value="${U.today()}" ${last ? `min="${last.date}"` : ''} style="max-width:180px;flex:none">
          ${last ? '<button class="btn small" data-action="copyLast" type="button">Copy last balances</button>' : ''}
        </div>

        ${accounts.length ? `
        <div class="table-wrap"><table class="table check-table">
          <thead><tr><th>Account</th>${last ? '<th class="r">Last check</th>' : ''}<th class="r">Balance now</th></tr></thead>
          <tbody>
            ${accounts.map(a => `<tr>
              <td>${U.esc(a.name)}</td>
              ${last ? `<td class="r num muted">${last.balances[a.id] != null ? U.money(last.balances[a.id]) : '–'}</td>` : ''}
              <td><input data-acc="${a.id}" inputmode="decimal" placeholder="0"></td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td>${last ? `<td class="r num muted">${U.money(last.actualTotal)}</td>` : ''}<td class="r num" id="cActual">Rs 0</td></tr></tfoot>
        </table></div>` : '<div class="empty">Add an account below first.</div>'}

        <div id="cSummary"></div>

        <div class="inline-form" style="margin-top:12px">
          <input id="cNote" placeholder="Note (optional)">
          <button class="btn primary" data-action="saveCheck" ${accounts.length ? '' : 'disabled'}>${first ? 'Save starting balances' : 'Save balance check'}</button>
        </div>
      </div>

      ${this.history()}
      ${this.accountsCard()}`;

    el.querySelectorAll('[data-acc]').forEach(i => i.addEventListener('input', () => this.update()));
    el.querySelector('#cDate').addEventListener('change', () => this.update());
    this.update();
  },

  readInputs() {
    const balances = {};
    let actual = 0, bad = false;
    document.querySelectorAll('#view [data-acc]').forEach(i => {
      const v = i.value.trim() === '' ? 0 : U.parseAmount(i.value);
      if (v === null) { bad = true; i.style.borderColor = 'var(--danger)'; return; }
      i.style.borderColor = '';
      balances[i.dataset.acc] = v;
      actual += v;
    });
    return { balances, actual, bad };
  },

  update() {
    const box = document.getElementById('cSummary');
    if (!box) return;
    const { actual } = this.readInputs();
    document.getElementById('cActual').textContent = U.money(actual);
    const last = Store.lastCheck();
    if (!last) { box.innerHTML = ''; return; }

    const date = document.getElementById('cDate').value || U.today();
    const since = Store.entriesSince(last, date);
    const expected = last.actualTotal + Store.flow(since);
    const diff = actual - expected;
    const rows = Object.keys(TYPES)
      .map(t => ({ t, amt: Store.sum(since, t) }))
      .filter(r => r.amt)
      .map(r => `<div class="kv"><span>${TYPES[r.t].label}</span><span class="num ${TYPES[r.t].flow > 0 ? 'in' : 'out'}">${U.money(TYPES[r.t].flow * r.amt, true)}</span></div>`)
      .join('');

    const headType = diff < 0 ? 'expense' : 'income';
    const def = diff < 0 ? UNTRACKED_EXPENSE : UNTRACKED_INCOME;
    const prevSel = document.getElementById('cHead');
    const prevVal = prevSel && prevSel.dataset.type === headType ? prevSel.value : def;
    const headOpts = Store.headTree(headType, false).map(({ head }) =>
      `<option value="${head.id}" ${head.id === prevVal ? 'selected' : ''}>${U.esc(Store.headPath(head.id))}</option>`).join('');

    box.innerHTML = `
      <div class="diff-box ${diff === 0 ? 'ok' : 'bad'}">
        <div class="kv"><span>Last check (${U.shortDate(last.date)})</span><span class="num">${U.money(last.actualTotal)}</span></div>
        ${rows || '<div class="kv muted"><span>No entries since last check</span><span></span></div>'}
        <div class="kv total"><span>Expected total</span><span class="num">${U.money(expected)}</span></div>
        <div class="kv"><span>Actual total</span><span class="num">${U.money(actual)}</span></div>
        <div class="kv total"><span>Difference</span><span class="num ${diff === 0 ? 'in' : 'out'}">${diff === 0 ? '✔ Balanced' : U.money(diff, true)}</span></div>
        ${diff !== 0 ? `
          <p style="margin:8px 0 6px">${diff < 0
            ? `${U.money(-diff)} went out that you didn't record. Save it as:`
            : `${U.money(diff)} more than expected (income you didn't record). Save it as:`}</p>
          <select id="cHead" data-type="${headType}">${headOpts}</select>` : ''}
      </div>`;
  },

  async save() {
    const { balances, actual, bad } = this.readInputs();
    if (bad) { U.toast('Fix the highlighted amounts first'); return; }
    const last = Store.lastCheck();
    const date = document.getElementById('cDate').value || U.today();
    if (last && date < last.date) { U.toast('Date must be on or after the last check'); return; }
    const note = document.getElementById('cNote').value.trim();

    let expected = null, diff = 0;
    if (last) {
      expected = last.actualTotal + Store.flow(Store.entriesSince(last, date));
      diff = actual - expected;
    }
    const check = await Store.add('checks', {
      date, balances, actualTotal: actual, expectedTotal: expected, difference: diff, note, adjustEntryId: null,
    });

    if (diff !== 0) {
      const sel = document.getElementById('cHead');
      const headId = sel ? sel.value : (diff < 0 ? UNTRACKED_EXPENSE : UNTRACKED_INCOME);
      const adj = await Store.add('entries', {
        type: diff < 0 ? 'expense' : 'income',
        amount: Math.abs(diff),
        date,
        headId, personId: null, committeeId: null,
        note: 'Difference found in balance check' + (note ? ' — ' + note : ''),
        checkId: check.id,
      });
      await Store.update('checks', check.id, { adjustEntryId: adj.id });
    }
    U.toast(last ? (diff === 0 ? 'Balanced! Check saved' : 'Check saved with difference ' + U.money(diff, true)) : 'Starting balances saved');
    App.render();
  },

  async undoLast() {
    const last = Store.lastCheck();
    if (!last) return;
    if (!confirm(`Undo the balance check of ${U.shortDate(last.date)}? Its difference entry will also be removed.`)) return;
    if (last.adjustEntryId) await Store.remove('entries', last.adjustEntryId);
    await Store.remove('checks', last.id);
    U.toast('Balance check removed');
    App.render();
  },

  copyLast() {
    const last = Store.lastCheck();
    if (!last) return;
    document.querySelectorAll('#view [data-acc]').forEach(i => {
      const v = last.balances[i.dataset.acc];
      if (v != null) i.value = U.plain(v);
    });
    this.update();
  },

  history() {
    const checks = Store.checks().reverse();
    if (!checks.length) return '';
    const latestId = checks[0].id;
    const accName = id => { const a = Store.get('accounts', id); return a ? a.name : '(removed)'; };
    return `<div class="card">
      <div class="card-head"><h2>Check history</h2></div>
      ${checks.map((c, i) => {
        const prev = checks[i + 1];
        const ids = Object.keys(c.balances);
        return `<details class="history-row">
          <summary>
            <span><b>${U.shortDate(c.date)}</b>${c.expectedTotal == null ? ' <span class="badge accent">Start</span>' : ''}</span>
            <span class="num">${U.money(c.actualTotal)}</span>
            <span class="num ${c.difference ? 'out' : 'in'}">${c.expectedTotal == null ? '' : c.difference ? U.money(c.difference, true) : '✔ Balanced'}</span>
            <span class="muted">▾</span>
          </summary>
          <div class="history-detail">
            <table class="table">
              <thead><tr><th>Account</th><th class="r">Balance</th><th class="r">Change</th></tr></thead>
              <tbody>${ids.map(id => {
                const ch = prev && prev.balances[id] != null ? c.balances[id] - prev.balances[id] : null;
                return `<tr><td>${U.esc(accName(id))}</td><td class="r num">${U.money(c.balances[id])}</td>
                  <td class="r num muted">${ch == null ? '–' : U.money(ch, true)}</td></tr>`;
              }).join('')}</tbody>
            </table>
            ${c.expectedTotal != null ? `<p class="muted" style="margin:8px 0 0">Expected ${U.money(c.expectedTotal)} · Actual ${U.money(c.actualTotal)}${
              c.adjustEntryId ? ' · Recorded as ' + U.esc(Store.describe(Store.get('entries', c.adjustEntryId) || {})) : ''}</p>` : ''}
            ${c.note ? `<p class="muted" style="margin:4px 0 0">Note: ${U.esc(c.note)}</p>` : ''}
            ${c.id === latestId ? '<p style="margin:8px 0 0"><button class="link danger" data-action="undoCheck">Undo this check</button></p>' : ''}
          </div>
        </details>`;
      }).join('')}
    </div>`;
  },

  accountsCard() {
    const all = Store.live('accounts').sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || (a.order || 0) - (b.order || 0));
    return `<div class="card">
      <div class="card-head"><h2>Accounts</h2></div>
      ${all.map(a => `<div class="tree-row ${a.archived ? 'archived' : ''}">
        <span class="tree-name">${U.esc(a.name)}</span>
        <span class="tree-actions">
          <button class="link" data-action="renameAccount" data-id="${a.id}">Rename</button>
          <button class="link" data-action="archiveAccount" data-id="${a.id}">${a.archived ? 'Restore' : 'Hide'}</button>
        </span>
      </div>`).join('')}
      <div class="inline-form" style="margin-top:10px">
        <input id="newAccount" placeholder="New account, e.g. JazzCash">
        <button class="btn" data-action="addAccount">Add account</button>
      </div>
    </div>`;
  },

  async addAccount() {
    const input = document.getElementById('newAccount');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const order = Store.live('accounts').reduce((m, a) => Math.max(m, a.order || 0), 0) + 1;
    await Store.add('accounts', { name, order, archived: false });
    App.render();
  },

  async renameAccount(id) {
    const a = Store.get('accounts', id);
    const name = prompt('Rename account', a.name);
    if (name && name.trim()) { await Store.update('accounts', id, { name: name.trim() }); App.render(); }
  },

  async archiveAccount(id) {
    const a = Store.get('accounts', id);
    await Store.update('accounts', id, { archived: !a.archived });
    App.render();
  },
};
