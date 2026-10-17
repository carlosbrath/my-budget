'use strict';

// Quick-add / edit form on the left.
const Form = {
  kind: 'expense',
  sub: { committee: 'committee_pay', lend: 'lend', borrow: 'borrow' },
  editingId: null,
  el: {},

  init() {
    const ids = ['entryForm', 'formTitle', 'typeTabs', 'subToggle', 'fAmount', 'amountHint', 'headField', 'fHead',
      'headChips', 'personField', 'fPerson', 'peopleList', 'personHint', 'committeeField', 'fCommittee', 'fDate',
      'dateHint', 'fNote', 'formError', 'saveBtn', 'cancelEdit'];
    ids.forEach(id => { this.el[id] = document.getElementById(id); });
    const E = this.el;

    E.fDate.value = U.today();
    E.typeTabs.addEventListener('click', e => {
      const b = e.target.closest('[data-kind]');
      if (b && !b.disabled) this.setKind(b.dataset.kind);
    });
    E.subToggle.addEventListener('click', e => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      this.sub[this.kind] = b.dataset.type;
      this.setKind(this.kind);
    });
    E.headChips.addEventListener('click', e => {
      const b = e.target.closest('[data-head]');
      if (!b) return;
      E.fHead.value = b.dataset.head;
      this.renderChips();
      E.fAmount.focus();
    });
    E.fHead.addEventListener('change', () => this.renderChips());
    E.fAmount.addEventListener('input', () => this.updateHints());
    E.fPerson.addEventListener('input', () => this.updateHints());
    E.fDate.addEventListener('change', () => this.updateHints());
    E.fCommittee.addEventListener('change', () => this.onCommitteeChange());
    E.entryForm.addEventListener('submit', e => { e.preventDefault(); this.submit(); });
    E.cancelEdit.addEventListener('click', () => this.cancelEdit());

    this.setKind('expense');
  },

  type() {
    return (this.kind === 'expense' || this.kind === 'income') ? this.kind : this.sub[this.kind];
  },

  setKind(kind) {
    this.kind = kind;
    const E = this.el;
    E.typeTabs.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));

    const subs = KINDS[kind];
    E.subToggle.innerHTML = subs.length > 1
      ? subs.map(t => `<button type="button" data-type="${t}" class="${t === this.type() ? 'active' : ''}">${TYPES[t].sub}</button>`).join('')
      : '';

    const type = this.type();
    E.headField.classList.toggle('hidden', !(type === 'expense' || type === 'income'));
    E.personField.classList.toggle('hidden', !TYPES[type].person);
    E.committeeField.classList.toggle('hidden', kind !== 'committee');
    E.fNote.placeholder = { expense: 'e.g. Shell, full tank', income: 'e.g. October salary', committee: 'e.g. Month 3',
      lend: 'e.g. return by 15th', borrow: 'e.g. for bike repair' }[kind];
    this.refresh();
    this.onCommitteeChange(true);
  },

  // Rebuild dropdown options (called after any data change).
  refresh() {
    const E = this.el;
    const type = this.type();

    if (type === 'expense' || type === 'income') {
      const cur = E.fHead.value;
      const editing = this.editingId ? Store.get('entries', this.editingId) : null;
      const tree = Store.headTree(type, false);
      // Keep an archived head visible if the entry being edited uses it.
      if (editing && editing.headId && !tree.some(t => t.head.id === editing.headId)) {
        const h = Store.get('heads', editing.headId);
        if (h) tree.push({ head: h, depth: 0 });
      }
      E.fHead.innerHTML = tree.map(({ head }) =>
        `<option value="${head.id}">${U.esc(Store.headPath(head.id))}</option>`).join('');
      const ids = tree.map(t => t.head.id);
      if (ids.includes(cur)) E.fHead.value = cur;
      else {
        const top = Store.topHeads(type, 1)[0];
        if (top && ids.includes(top.id)) E.fHead.value = top.id;
      }
      this.renderChips();
    }

    E.peopleList.innerHTML = Store.live('people')
      .map(p => `<option value="${U.esc(p.name)}"></option>`).join('');

    const curC = E.fCommittee.value;
    const editing = this.editingId ? Store.get('entries', this.editingId) : null;
    const comms = Store.live('committees').filter(c => !c.closed || (editing && editing.committeeId === c.id) || c.id === curC);
    E.fCommittee.innerHTML = comms.map(c => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('')
      + '<option value="__new">+ New committee…</option>';
    if (comms.some(c => c.id === curC)) E.fCommittee.value = curC;
    else if (comms.length) E.fCommittee.value = comms[0].id;
    else E.fCommittee.value = '';

    this.updateHints();
  },

  renderChips() {
    const E = this.el;
    const type = this.type();
    const top = Store.topHeads(type, 6);
    E.headChips.innerHTML = top.map(h =>
      `<button type="button" class="chip ${h.id === E.fHead.value ? 'active' : ''}" data-head="${h.id}" title="${U.esc(Store.headPath(h.id))}">${U.esc(this.chipLabel(h))}</button>`).join('');
  },

  // "Bike › Petrol" — leaf plus its parent, enough to tell similar heads apart.
  chipLabel(h) {
    const p = h.parentId && Store.get('heads', h.parentId);
    return p ? p.name + ' › ' + h.name : h.name;
  },

  async onCommitteeChange(silent) {
    const E = this.el;
    if (this.kind !== 'committee') return;
    if (E.fCommittee.value === '__new') {
      if (silent) { E.fCommittee.value = ''; return; }
      const c = await Committees.create();
      this.refresh();
      if (c) E.fCommittee.value = c.id;
      else E.fCommittee.selectedIndex = 0;
    }
    // Prefill the installment amount when paying.
    const c = Store.get('committees', E.fCommittee.value);
    if (c && this.type() === 'committee_pay' && !E.fAmount.value && c.installment && !this.editingId) {
      E.fAmount.value = U.plain(c.installment);
    }
    this.updateHints();
  },

  updateHints() {
    const E = this.el;
    const raw = E.fAmount.value;
    const amt = U.parseAmount(raw);
    if (raw && amt === null) E.amountHint.textContent = 'Not a valid amount';
    else if (raw && U.isExpression(raw)) E.amountHint.textContent = '= ' + U.money(amt);
    else E.amountHint.textContent = this.editingId && Store.get('entries', this.editingId)?.checkId
      ? 'Amount is set by the balance check' : 'You can type sums like 500+250';

    E.personHint.textContent = '';
    const name = E.fPerson.value.trim();
    if (name && TYPES[this.type()].person) {
      const p = Store.personByName(name);
      if (!p) E.personHint.textContent = 'New person — will be added';
      else {
        const b = Store.personBalance(p.id);
        E.personHint.textContent = b > 0 ? `${p.name} owes you ${U.money(b)}`
          : b < 0 ? `You owe ${p.name} ${U.money(-b)}` : `${p.name} is settled`;
      }
    }

    const last = Store.lastCheck();
    const d = E.fDate.value;
    E.dateHint.textContent = (last && d && d < last.date && !this.editingId)
      ? `Before your last balance check (${U.shortDate(last.date)}) — it shows in reports but won't change balances.`
      : '';
  },

  error(msg) { this.el.formError.textContent = msg; },

  async submit() {
    const E = this.el;
    this.error('');
    const editing = this.editingId ? Store.get('entries', this.editingId) : null;

    // Balance-check adjustments: only head and note can change.
    if (editing && editing.checkId) {
      await Store.update('entries', editing.id, { headId: E.fHead.value, note: E.fNote.value.trim() });
      U.toast('Updated');
      this.cancelEdit();
      App.render();
      return;
    }

    const amount = U.parseAmount(E.fAmount.value);
    if (!amount || amount <= 0) { this.error('Enter an amount greater than 0.'); E.fAmount.focus(); return; }
    const type = this.type();
    const rec = {
      type, amount,
      date: E.fDate.value || U.today(),
      note: E.fNote.value.trim(),
      headId: null, personId: null, committeeId: null,
    };

    if (type === 'expense' || type === 'income') {
      rec.headId = E.fHead.value;
      if (!rec.headId) { this.error('Choose a head.'); return; }
    }
    if (TYPES[type].person) {
      const name = E.fPerson.value.trim();
      if (!name) { this.error('Type the person\'s name.'); E.fPerson.focus(); return; }
      let p = Store.personByName(name);
      if (!p) p = await Store.add('people', { name });
      rec.personId = p.id;
    }
    if (KINDS.committee.includes(type)) {
      rec.committeeId = E.fCommittee.value;
      if (!rec.committeeId || rec.committeeId === '__new') { this.error('Choose a committee (or add one).'); return; }
    }

    if (editing) {
      await Store.update('entries', editing.id, rec);
      U.toast('Entry updated');
      this.cancelEdit();
    } else {
      const saved = await Store.add('entries', rec);
      U.toast(`Saved ${U.money(amount)} · ${Store.describe(saved)}`, 'Undo', async () => {
        await Store.remove('entries', saved.id);
        App.render();
      });
      E.fAmount.value = '';
      E.fNote.value = '';
      if (TYPES[type].person) E.fPerson.value = '';
    }
    App.render();
    E.fAmount.focus();
  },

  edit(id) {
    const e = Store.get('entries', id);
    if (!e) return;
    const E = this.el;
    this.editingId = id;
    const kind = TYPES[e.type].kind;
    if (KINDS[kind].length > 1) this.sub[kind] = e.type;
    this.setKind(kind);

    E.fAmount.value = U.plain(e.amount);
    E.fDate.value = e.date;
    E.fNote.value = e.note || '';
    if (e.headId) E.fHead.value = e.headId;
    if (e.personId) { const p = Store.get('people', e.personId); E.fPerson.value = p ? p.name : ''; }
    if (e.committeeId) E.fCommittee.value = e.committeeId;

    const locked = !!e.checkId;
    E.fAmount.disabled = locked;
    E.fDate.disabled = locked;
    E.typeTabs.querySelectorAll('button').forEach(b => { b.disabled = locked; });
    E.subToggle.querySelectorAll('button').forEach(b => { b.disabled = locked; });

    E.formTitle.textContent = locked ? 'Edit balance-check difference' : 'Edit entry';
    E.saveBtn.textContent = 'Update';
    E.cancelEdit.hidden = false;
    E.entryForm.classList.add('editing');
    this.renderChips();
    this.updateHints();
    E.entryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (locked ? E.fHead : E.fAmount).focus();
  },

  cancelEdit() {
    const E = this.el;
    this.editingId = null;
    E.fAmount.disabled = false;
    E.fDate.disabled = false;
    E.typeTabs.querySelectorAll('button').forEach(b => { b.disabled = false; });
    E.formTitle.textContent = 'Add entry';
    E.saveBtn.textContent = 'Save';
    E.cancelEdit.hidden = true;
    E.entryForm.classList.remove('editing');
    E.fAmount.value = '';
    E.fNote.value = '';
    E.fPerson.value = '';
    E.fDate.value = U.today();
    this.error('');
    this.setKind(this.kind);
  },

  // Used by People / Committees "quick" buttons.
  prefill(kind, type, opts = {}) {
    if (this.editingId) this.cancelEdit();
    if (type) this.sub[kind] = type;
    this.setKind(kind);
    const E = this.el;
    if (opts.person) E.fPerson.value = opts.person;
    if (opts.committeeId) { E.fCommittee.value = opts.committeeId; E.fAmount.value = ''; this.onCommitteeChange(); }
    if (opts.amount) E.fAmount.value = U.plain(opts.amount);
    this.updateHints();
    E.entryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    E.fAmount.focus();
  },

  focus() { this.el.fAmount.focus(); },
};
