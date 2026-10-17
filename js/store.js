'use strict';

// Every entry type and how it moves money.
//   flow   : +1 money comes into my accounts, -1 money goes out
//   person : +1 the person owes me more, -1 the person owes me less (or I owe them more)
const TYPES = {
  expense:           { label: 'Expense',            kind: 'expense',   flow: -1 },
  income:            { label: 'Income',             kind: 'income',    flow: +1 },
  committee_pay:     { label: 'Committee paid',     kind: 'committee', flow: -1, sub: 'Paid installment' },
  committee_receive: { label: 'Committee received', kind: 'committee', flow: +1, sub: 'Received payout' },
  lend:              { label: 'Lent',               kind: 'lend',      flow: -1, person: +1, sub: 'I gave' },
  lend_back:         { label: 'Got back',           kind: 'lend',      flow: +1, person: -1, sub: 'Got back' },
  borrow:            { label: 'Borrowed',           kind: 'borrow',    flow: +1, person: -1, sub: 'I took' },
  borrow_repay:      { label: 'Repaid',             kind: 'borrow',    flow: -1, person: +1, sub: 'I repaid' },
};

const KINDS = {
  expense: ['expense'],
  income: ['income'],
  committee: ['committee_pay', 'committee_receive'],
  lend: ['lend', 'lend_back'],
  borrow: ['borrow', 'borrow_repay'],
};

const UNTRACKED_EXPENSE = 'untracked-expense';
const UNTRACKED_INCOME = 'untracked-income';

// In-memory copy of all data. Every change is written straight to the database.
// Records are never hard-deleted (deleted: true) and carry updatedAt, so sync can be added later.
const Store = {
  seeding: false,
  S: { heads: [], accounts: [], people: [], committees: [], entries: [], checks: [], meta: [] },

  async load() {
    await DB.open();
    for (const s of DB.STORES) this.S[s] = await DB.getAll(s);
    await FileStore.init(); // may replace the data with the copy from the data file
    if (!this.S.heads.length) {
      // Default heads are not a "change": they must never overwrite a real data file.
      this.seeding = true;
      try { await this.seed(); } finally { this.seeding = false; }
    }
    await Lock.migrate();
  },

  async seed() {
    const H = async (name, type, parentId = null, extra = {}) =>
      (await this.add('heads', { name, type, parentId, archived: false, ...extra })).id;

    const personal = await H('Personal', 'expense');
    await H('Daily', 'expense', personal);
    await H('Food', 'expense', personal);
    await H('Mobile & Internet', 'expense', personal);

    const vehicles = await H('Vehicles', 'expense');
    const car = await H('Car', 'expense', vehicles);
    await H('Petrol', 'expense', car);
    await H('Work / Repair', 'expense', car);
    const bike = await H('Bike', 'expense', vehicles);
    await H('Petrol', 'expense', bike);
    await H('Work / Repair', 'expense', bike);

    const shopping = await H('Shopping', 'expense');
    await H('Clothes', 'expense', shopping);
    await H('Home', 'expense', shopping);

    const bills = await H('Bills', 'expense');
    await H('Electricity', 'expense', bills);
    await H('Gas', 'expense', bills);

    await H('Untracked', 'expense', null, { id: UNTRACKED_EXPENSE, system: true });

    await H('Salary', 'income');
    await H('Other income', 'income');
    await H('Untracked', 'income', null, { id: UNTRACKED_INCOME, system: true });

    const accounts = ['Meezan', 'UBL', 'HBL', 'Easypaisa', 'Cash'];
    for (let i = 0; i < accounts.length; i++) {
      await this.add('accounts', { name: accounts[i], order: i, archived: false });
    }
    await this.setMeta('reportPin', null); // new user: no PIN until they choose one
    await this.setMeta('pinCleanup1437', true);
  },

  // ---------- generic CRUD ----------
  live(store) { return this.S[store].filter(r => !r.deleted); },
  get(store, id) { return id ? this.S[store].find(r => r.id === id) : undefined; },

  async add(store, data) {
    const t = U.now();
    const rec = { id: U.uid(), createdAt: t, updatedAt: t, deleted: false, ...data };
    this.S[store].push(rec);
    await DB.put(store, rec);
    FileStore.changed();
    return rec;
  },

  async update(store, id, changes) {
    const rec = this.get(store, id);
    if (!rec) return null;
    Object.assign(rec, changes, { updatedAt: U.now() });
    await DB.put(store, rec);
    FileStore.changed();
    return rec;
  },

  async remove(store, id) { return this.update(store, id, { deleted: true }); },

  meta(key) { const r = this.S.meta.find(m => m.id === key); return r ? r.value : undefined; },
  async setMeta(key, value) {
    let r = this.S.meta.find(m => m.id === key);
    if (!r) { r = { id: key }; this.S.meta.push(r); }
    r.value = value;
    r.updatedAt = U.now();
    await DB.put('meta', r);
    FileStore.changed();
  },

  // ---------- heads ----------
  headPath(id, sep = ' › ') {
    const parts = [];
    let h = this.get('heads', id);
    let guard = 0;
    while (h && guard++ < 20) {
      parts.unshift(h.name);
      h = h.parentId ? this.get('heads', h.parentId) : null;
    }
    return parts.join(sep);
  },

  // Depth-first list: [{ head, depth }]
  headTree(type, includeArchived = true) {
    const all = this.live('heads').filter(h => h.type === type && (includeArchived || !h.archived));
    const byParent = {};
    all.forEach(h => { (byParent[h.parentId || ''] = byParent[h.parentId || ''] || []).push(h); });
    const sortFn = (a, b) => ((a.system ? 1 : 0) - (b.system ? 1 : 0)) || a.name.localeCompare(b.name);
    const out = [];
    const walk = (pid, depth) => (byParent[pid] || []).sort(sortFn).forEach(h => {
      out.push({ head: h, depth });
      walk(h.id, depth + 1);
    });
    walk('', 0);
    return out;
  },

  childHeads(id) { return this.live('heads').filter(h => h.parentId === id); },

  descendantIds(id) {
    const ids = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      this.live('heads').forEach(h => {
        if (h.parentId && ids.has(h.parentId) && !ids.has(h.id)) { ids.add(h.id); added = true; }
      });
    }
    return ids;
  },

  // ---------- entries ----------
  entries() { return this.live('entries'); },
  inMonth(ym) { return this.entries().filter(e => e.date.slice(0, 7) === ym); },
  sum(list, type) { return list.reduce((a, e) => a + (e.type === type ? e.amount : 0), 0); },
  flow(list) { return list.reduce((a, e) => a + TYPES[e.type].flow * e.amount, 0); },

  describe(e) {
    if (e.type === 'expense' || e.type === 'income') return this.headPath(e.headId) || '(deleted head)';
    if (TYPES[e.type].person) {
      const p = this.get('people', e.personId);
      const name = p ? p.name : '?';
      return {
        lend: 'Lent to ', lend_back: 'Got back from ', borrow: 'Borrowed from ', borrow_repay: 'Repaid to ',
      }[e.type] + name;
    }
    const c = this.get('committees', e.committeeId);
    return (e.type === 'committee_pay' ? 'Installment · ' : 'Payout · ') + (c ? c.name : '?');
  },

  // Most-used heads of a type (for quick chips).
  topHeads(type, n) {
    const counts = {};
    this.entries().forEach(e => { if (e.type === type && e.headId) counts[e.headId] = (counts[e.headId] || 0) + 1; });
    return Object.keys(counts)
      .map(id => this.get('heads', id))
      .filter(h => h && !h.deleted && !h.archived && !h.system)
      .sort((a, b) => counts[b.id] - counts[a.id])
      .slice(0, n);
  },

  // ---------- people ----------
  personBalance(pid) {
    return this.entries().reduce((a, e) => a + (e.personId === pid ? (TYPES[e.type].person || 0) * e.amount : 0), 0);
  },
  personByName(name) {
    const n = name.trim().toLowerCase();
    return this.live('people').find(p => p.name.trim().toLowerCase() === n);
  },
  peopleTotals() {
    let owedToMe = 0, iOwe = 0;
    this.live('people').forEach(p => {
      const b = this.personBalance(p.id);
      if (b > 0) owedToMe += b; else iOwe -= b;
    });
    return { owedToMe, iOwe };
  },

  // ---------- committees ----------
  committeeStats(cid) {
    let paid = 0, count = 0, received = 0;
    this.entries().forEach(e => {
      if (e.committeeId !== cid) return;
      if (e.type === 'committee_pay') { paid += e.amount; count++; }
      if (e.type === 'committee_receive') received += e.amount;
    });
    return { paid, count, received };
  },
  committeeHeld() {
    return this.live('committees').reduce((a, c) => { const s = this.committeeStats(c.id); return a + s.paid - s.received; }, 0);
  },

  // ---------- balance checks ----------
  checks() {
    return this.live('checks').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  },
  lastCheck() { const c = this.checks(); return c[c.length - 1] || null; },

  // Was this entry recorded after the given check? (Same-day entries count by when they were created.)
  isAfterCheck(e, c) {
    if (!c) return true;
    return e.date > c.date || (e.date === c.date && e.createdAt > c.createdAt);
  },

  // Entries that change the expected balance since a check (adjustments are excluded).
  entriesSince(c, uptoDate) {
    return this.entries().filter(e => !e.checkId && this.isAfterCheck(e, c) && (!uptoDate || e.date <= uptoDate));
  },

  estimatedBalance() {
    const c = this.lastCheck();
    if (!c) return null;
    return c.actualTotal + this.flow(this.entriesSince(c));
  },

  accountsActive() {
    return this.live('accounts').filter(a => !a.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
  },
};
