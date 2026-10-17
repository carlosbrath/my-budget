'use strict';

// People I lend to / borrow from.
const People = {
  open: new Set(),

  render(el) {
    const t = Store.peopleTotals();
    const people = Store.live('people')
      .map(p => ({ p, bal: Store.personBalance(p.id) }))
      .sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal) || a.p.name.localeCompare(b.p.name));

    el.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="card stat"><div class="label">Others owe me</div><div class="value in">${U.money(t.owedToMe)}</div></div>
        <div class="card stat"><div class="label">I owe others</div><div class="value out">${U.money(t.iOwe)}</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>People</h2></div>
        ${people.length ? people.map(({ p, bal }) => this.row(p, bal)).join('')
          : '<div class="empty">No one yet. Use the <b>Lend</b> or <b>Borrow</b> tab on the left — new names are added automatically.</div>'}
        <div class="inline-form" style="margin-top:12px">
          <input id="newPerson" placeholder="Add a person">
          <button class="btn" data-action="addPerson">Add</button>
        </div>
      </div>`;
  },

  row(p, bal) {
    const status = bal > 0 ? `<span class="in num">owes you ${U.money(bal)}</span>`
      : bal < 0 ? `<span class="out num">you owe ${U.money(-bal)}</span>`
      : '<span class="muted">settled</span>';
    const entries = Store.entries().filter(e => e.personId === p.id);
    const isOpen = this.open.has(p.id);
    const name = U.esc(p.name);
    return `<div class="person-row">
      <div class="person-top">
        <span class="person-name">${name}</span>
        ${status}
        <span class="tree-actions" style="display:flex;gap:2px;flex-wrap:wrap">
          ${bal > 0 ? `<button class="btn small" data-action="quickPerson" data-kind="lend" data-type="lend_back" data-name="${name}" data-amount="${bal}">Got back</button>` : ''}
          ${bal < 0 ? `<button class="btn small" data-action="quickPerson" data-kind="borrow" data-type="borrow_repay" data-name="${name}" data-amount="${-bal}">Repay</button>` : ''}
          <button class="link" data-action="quickPerson" data-kind="lend" data-type="lend" data-name="${name}">Lend</button>
          <button class="link" data-action="quickPerson" data-kind="borrow" data-type="borrow" data-name="${name}">Borrow</button>
          <button class="link" data-action="togglePerson" data-id="${p.id}">${isOpen ? 'Hide' : 'History'} (${entries.length})</button>
          <button class="link" data-action="renamePerson" data-id="${p.id}">Rename</button>
          ${entries.length ? '' : `<button class="link danger" data-action="deletePerson" data-id="${p.id}">Delete</button>`}
        </span>
      </div>
      ${isOpen ? `<div class="person-history">${entries.length ? entries
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(e => `<div class="kv"><span>${U.shortDate(e.date)} · ${TYPES[e.type].label}${e.note ? ' <span class="muted">— ' + U.esc(e.note) + '</span>' : ''}</span>
          <span class="num ${TYPES[e.type].person > 0 ? 'in' : 'out'}">${U.money(e.amount)}</span></div>`).join('')
        : '<span class="muted">No entries.</span>'}</div>` : ''}
    </div>`;
  },

  async add() {
    const input = document.getElementById('newPerson');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (Store.personByName(name)) { U.toast(name + ' already exists'); return; }
    await Store.add('people', { name });
    App.render();
  },

  async rename(id) {
    const p = Store.get('people', id);
    const name = prompt('Rename person', p.name);
    if (!name || !name.trim()) return;
    const other = Store.personByName(name);
    if (other && other.id !== id) { U.toast('That name is already used'); return; }
    await Store.update('people', id, { name: name.trim() });
    App.render();
  },

  async remove(id) {
    const p = Store.get('people', id);
    if (!confirm(`Delete ${p.name}?`)) return;
    await Store.remove('people', id);
    App.render();
  },
};
