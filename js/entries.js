'use strict';

const Entries = {
  filter: { q: '', type: '', headId: '' },

  render(el) {
    const F = this.filter;
    const headOpts = type => Store.headTree(type, true).map(({ head, depth }) =>
      `<option value="${head.id}" ${F.headId === head.id ? 'selected' : ''}>${'   '.repeat(depth)}${U.esc(head.name)}</option>`).join('');

    el.innerHTML = `
      <div class="card">
        <div class="filters">
          <input id="eSearch" placeholder="Search note, head or person…" value="${U.esc(F.q)}">
          <select id="eType">
            <option value="">All types</option>
            ${Object.keys(TYPES).map(t => `<option value="${t}" ${F.type === t ? 'selected' : ''}>${TYPES[t].label}</option>`).join('')}
          </select>
          <select id="eHead">
            <option value="">All heads</option>
            <optgroup label="Expense">${headOpts('expense')}</optgroup>
            <optgroup label="Income">${headOpts('income')}</optgroup>
          </select>
        </div>
        <div id="eList"></div>
      </div>`;

    const bind = (id, key) => el.querySelector('#' + id).addEventListener('input', ev => { F[key] = ev.target.value; this.renderList(); });
    bind('eSearch', 'q');
    bind('eType', 'type');
    bind('eHead', 'headId');
    this.renderList();
  },

  renderList() {
    const box = document.getElementById('eList');
    if (!box) return;
    const F = this.filter;
    let list = App.periodEntries();
    if (F.type) list = list.filter(e => e.type === F.type);
    if (F.headId) { const ids = Store.descendantIds(F.headId); list = list.filter(e => ids.has(e.headId)); }
    if (F.q) {
      const q = F.q.toLowerCase();
      list = list.filter(e => (Store.describe(e) + ' ' + (e.note || '')).toLowerCase().includes(q));
    }
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    if (!list.length) {
      box.innerHTML = `<div class="empty">No entries ${App.period.mode === 'month' ? 'in ' + U.monthLabel(App.period.ym) : 'yet'}${F.q || F.type || F.headId ? ' matching the filters' : ''}.</div>`;
      return;
    }

    const days = [];
    list.forEach(e => {
      const last = days[days.length - 1];
      if (last && last.date === e.date) last.items.push(e); else days.push({ date: e.date, items: [e] });
    });

    let totalIn = 0, totalOut = 0;
    list.forEach(e => { if (TYPES[e.type].flow > 0) totalIn += e.amount; else totalOut += e.amount; });

    box.innerHTML = days.map(d => {
      const net = Store.flow(d.items);
      return `<div class="day">
        <div class="day-head"><span>${U.dateLabel(d.date, true)}</span><span class="num">${U.money(net, true)}</span></div>
        ${d.items.map(e => this.row(e)).join('')}
      </div>`;
    }).join('') + `
      <div class="list-foot">
        <span>${list.length} entries</span>
        <span>Money in <b class="in num">${U.money(totalIn)}</b></span>
        <span>Money out <b class="out num">${U.money(totalOut)}</b></span>
      </div>`;
  },

  row(e) {
    const t = TYPES[e.type];
    const badge = e.checkId ? '<span class="badge warn">Balance check</span>'
      : (e.type !== 'expense' && e.type !== 'income') ? `<span class="badge accent">${t.label}</span>` : '';
    return `<div class="entry">
      <div class="entry-main">
        <div class="entry-title">${U.esc(Store.describe(e))}${badge}</div>
        ${e.note ? `<div class="entry-note">${U.esc(e.note)}</div>` : ''}
      </div>
      <div class="entry-amount num ${t.flow > 0 ? 'in' : 'out'}">${U.money(t.flow * e.amount, true)}</div>
      <div class="entry-actions">
        <button class="link" data-action="editEntry" data-id="${e.id}">Edit</button>
        ${e.checkId ? '' : `<button class="link danger" data-action="deleteEntry" data-id="${e.id}">Delete</button>`}
      </div>
    </div>`;
  },
};
