'use strict';

// Committees (BC / ROSCA). Installments are savings, not expenses.
// The payout coming back is your own savings returning, not income.
const Committees = {
  render(el) {
    const list = Store.live('committees').sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || a.name.localeCompare(b.name));
    const held = Store.committeeHeld();

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Committees</h2>
          <span>Total in committees: <b class="num">${U.money(held)}</b></span>
        </div>
        <p class="muted" style="margin-top:0">Installments count as <b>savings</b>, not expenses. When you get the payout, record it as
          <b>Received payout</b> — it's your own money coming back, so it isn't counted as income.</p>
        <div class="inline-form">
          <input id="cName" placeholder="Name, e.g. Office committee">
          <input id="cInst" inputmode="decimal" placeholder="Monthly installment">
          <input id="cCount" inputmode="numeric" placeholder="No. of months">
          <button class="btn primary" data-action="addCommittee">Add committee</button>
        </div>
      </div>
      ${list.length ? `<div class="cgrid" style="margin-top:16px">${list.map(c => this.card(c)).join('')}</div>`
        : '<div class="card"><div class="empty">No committees yet.</div></div>'}`;
  },

  card(c) {
    const s = Store.committeeStats(c.id);
    const totalValue = c.installment && c.months ? c.installment * c.months : 0;
    const pct = totalValue ? Math.min(100, Math.round(s.paid / totalValue * 100)) : 0;
    return `<div class="card">
      <div class="card-head" style="margin-bottom:4px">
        <h3>${U.esc(c.name)} ${c.closed ? '<span class="badge">Closed</span>' : ''}</h3>
        <span class="muted">${c.installment ? U.money(c.installment) + '/month' : ''}</span>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="kv"><span>Paid</span><span class="num">${U.money(s.paid)} <span class="muted">(${s.count}${c.months ? ' of ' + c.months : ''})</span></span></div>
      ${totalValue ? `<div class="kv"><span>Full payout</span><span class="num">${U.money(totalValue)}</span></div>` : ''}
      <div class="kv"><span>Received</span><span class="num">${s.received ? U.money(s.received) : 'Not yet'}</span></div>
      <div class="kv total"><span>${s.paid - s.received >= 0 ? 'Saved in it' : 'Still to pay'}</span><span class="num">${U.money(Math.abs(s.paid - s.received))}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${c.closed ? '' : `<button class="btn small primary" data-action="payCommittee" data-id="${c.id}">Pay installment</button>
        <button class="btn small" data-action="receiveCommittee" data-id="${c.id}">Received payout</button>`}
        <button class="link" data-action="editCommittee" data-id="${c.id}">Edit</button>
        <button class="link" data-action="closeCommittee" data-id="${c.id}">${c.closed ? 'Reopen' : 'Close'}</button>
        ${s.count || s.received ? '' : `<button class="link danger" data-action="deleteCommittee" data-id="${c.id}">Delete</button>`}
      </div>
    </div>`;
  },

  async addFromForm() {
    const name = document.getElementById('cName').value.trim();
    const inst = U.parseAmount(document.getElementById('cInst').value);
    const months = parseInt(document.getElementById('cCount').value, 10) || null;
    if (!name) { document.getElementById('cName').focus(); return; }
    await Store.add('committees', { name, installment: inst || 0, months, closed: false });
    U.toast('Committee added');
    App.render();
  },

  // Called from the quick-add form ("+ New committee…").
  async create() {
    const name = prompt('Committee name');
    if (!name || !name.trim()) return null;
    const inst = U.parseAmount(prompt('Monthly installment (optional)') || '');
    const months = parseInt(prompt('Number of months (optional)') || '', 10) || null;
    const c = await Store.add('committees', { name: name.trim(), installment: inst || 0, months, closed: false });
    App.render();
    return c;
  },

  async edit(id) {
    const c = Store.get('committees', id);
    const name = prompt('Committee name', c.name);
    if (name === null) return;
    const inst = prompt('Monthly installment', c.installment ? U.plain(c.installment) : '');
    if (inst === null) return;
    const months = prompt('Number of months', c.months || '');
    if (months === null) return;
    await Store.update('committees', id, {
      name: name.trim() || c.name,
      installment: U.parseAmount(inst) || 0,
      months: parseInt(months, 10) || null,
    });
    App.render();
  },

  async toggleClosed(id) {
    const c = Store.get('committees', id);
    await Store.update('committees', id, { closed: !c.closed });
    App.render();
  },

  async remove(id) {
    const c = Store.get('committees', id);
    if (!confirm(`Delete committee "${c.name}"?`)) return;
    await Store.remove('committees', id);
    App.render();
  },
};
