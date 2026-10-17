'use strict';

const Reports = {
  render(el) {
    const P = App.period;
    const isMonth = P.mode === 'month';
    const cur = App.periodEntries();
    const prevYm = isMonth ? U.addMonths(P.ym, -1) : null;
    const prev = isMonth ? Store.inMonth(prevYm) : null;

    const totals = list => {
      const t = {
        income: Store.sum(list, 'income'),
        expense: Store.sum(list, 'expense'),
        cpay: Store.sum(list, 'committee_pay'),
      };
      t.left = t.income - t.expense - t.cpay;
      return t;
    };
    const a = totals(cur);
    const b = prev ? totals(prev) : null;
    const prevName = isMonth ? U.monthLabel(prevYm, true) : '';

    const stat = (label, value, prevValue, cls, lowerIsBetter, note) => `
      <div class="card stat">
        <div class="label">${label}</div>
        <div class="value ${cls}">${U.money(value)}</div>
        <div class="sub">${b ? `${prevName}: ${U.money(prevValue)} ${U.delta(value, prevValue, lowerIsBetter)}` : (note || '&nbsp;')}</div>
      </div>`;

    const untracked = cur.filter(e => e.headId === UNTRACKED_EXPENSE).reduce((s, e) => s + e.amount, 0);

    el.innerHTML = `
      <div class="stats">
        ${stat('Income', a.income, b && b.income, 'in', false)}
        ${stat('Expenses', a.expense, b && b.expense, 'out', true)}
        ${stat('Committee saved', a.cpay, b && b.cpay, '', false)}
        ${stat('Left over', a.left, b && b.left, a.left >= 0 ? 'in' : 'out', false, 'Income − expenses − committee')}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <h2>Expenses by head</h2>
            ${untracked ? `<span class="badge warn" title="Money missing in balance checks">Untracked ${U.money(untracked)}</span>` : ''}
          </div>
          ${this.headTable(cur, prev, 'expense', a.expense, prevName)}
        </div>
        <div class="stack">
          ${this.balanceCard()}
          <div class="card">
            <div class="card-head"><h2>Income by head</h2></div>
            ${this.headTable(cur, prev, 'income', a.income, prevName)}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <h2>Last 12 months</h2>
          <div class="legend"><span><i style="background:var(--series-in)"></i>Income</span><span><i style="background:var(--series-out)"></i>Expenses</span></div>
        </div>
        ${this.trend()}
      </div>`;
  },

  headTable(cur, prev, type, total, prevName) {
    const direct = list => {
      const m = {};
      list.forEach(e => { if (e.type === type) m[e.headId] = (m[e.headId] || 0) + e.amount; });
      return m;
    };
    const tree = Store.headTree(type, true);
    const rollup = d => {
      const r = { ...d };
      for (let i = tree.length - 1; i >= 0; i--) {
        const h = tree[i].head;
        if (h.parentId) r[h.parentId] = (r[h.parentId] || 0) + (r[h.id] || 0);
      }
      return r;
    };
    const rc = rollup(direct(cur));
    const rp = prev ? rollup(direct(prev)) : {};
    const rows = tree.filter(({ head }) => rc[head.id] || rp[head.id]);

    if (!rows.length) return `<div class="empty">No ${type === 'expense' ? 'expenses' : 'income'} in this period.</div>`;

    const pct = v => total ? Math.round(v / total * 100) : 0;
    const showPrev = !!prev && type === 'expense';
    return `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Head</th><th class="r">Amount</th><th>Share</th>${showPrev ? `<th class="r">${prevName}</th>` : ''}</tr></thead>
        <tbody>
          ${rows.map(({ head, depth }) => `
            <tr class="clickable depth-${depth}" data-action="filterHead" data-id="${head.id}" title="Show entries">
              <td style="padding-left:${8 + depth * 18}px">${U.esc(head.name)}</td>
              <td class="r num">${U.money(rc[head.id] || 0)}</td>
              <td><div class="share"><div class="share-bar ${type === 'income' ? 'in' : ''}"><div style="width:${pct(rc[head.id] || 0)}%"></div></div><span>${pct(rc[head.id] || 0)}%</span></div></td>
              ${showPrev ? `<td class="r num muted">${rp[head.id] ? U.money(rp[head.id]) : '–'} ${depth === 0 ? U.delta(rc[head.id] || 0, rp[head.id] || 0, true) : ''}</td>` : ''}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td><td class="r num">${U.money(total)}</td><td></td>${showPrev ? '<td></td>' : ''}</tr></tfoot>
      </table></div>`;
  },

  balanceCard() {
    const last = Store.lastCheck();
    const pt = Store.peopleTotals();
    const held = Store.committeeHeld();
    if (!last) {
      return `<div class="card">
        <div class="card-head"><h2>Balances</h2></div>
        <p class="muted">Enter your current account balances once to start tracking.</p>
        <button class="btn primary" data-action="goTab" data-tab="check">Start balance check</button>
      </div>`;
    }
    const est = Store.estimatedBalance();
    const net = est + held + pt.owedToMe - pt.iOwe;
    return `<div class="card">
      <div class="card-head"><h2>Balances</h2><button class="link" data-action="goTab" data-tab="check">Check now</button></div>
      <div class="kv"><span>Last check <span class="muted">(${U.shortDate(last.date)})</span></span><span class="num">${U.money(last.actualTotal)}</span></div>
      <div class="kv"><span>Expected in accounts now</span><span class="num">${U.money(est)}</span></div>
      <div class="kv"><span>In committees</span><span class="num">${U.money(held)}</span></div>
      <div class="kv"><span>Others owe me</span><span class="num in">${U.money(pt.owedToMe)}</span></div>
      <div class="kv"><span>I owe others</span><span class="num out">${U.money(-pt.iOwe)}</span></div>
      <div class="kv total"><span>Net worth</span><span class="num">${U.money(net)}</span></div>
    </div>`;
  },

  trend() {
    const end = App.period.mode === 'month' ? App.period.ym : U.thisMonth();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const ym = U.addMonths(end, -i);
      const list = Store.inMonth(ym);
      months.push({ ym, income: Store.sum(list, 'income'), expense: Store.sum(list, 'expense') });
    }
    const max = Math.max(1, ...months.map(m => Math.max(m.income, m.expense)));
    const h = v => (v / max * 100).toFixed(1);
    const sel = App.period.mode === 'month' ? App.period.ym : null;
    return `<div class="trend" role="img" aria-label="Income and expenses for the last 12 months">
      ${months.map(m => `
        <div class="trend-col ${m.ym === sel ? 'current' : ''}" data-action="goMonth" data-ym="${m.ym}">
          <div class="tip"><b>${U.monthLabel(m.ym)}</b><br>
            <i style="background:var(--series-in)"></i>Income ${U.money(m.income)}<br>
            <i style="background:var(--series-out)"></i>Expenses ${U.money(m.expense)}</div>
          <div class="trend-bars">
            <div class="bar in" style="height:${h(m.income)}%"></div>
            <div class="bar out" style="height:${h(m.expense)}%"></div>
          </div>
          <div class="trend-label">${U.monthLabel(m.ym, true)}</div>
        </div>`).join('')}
    </div>`;
  },
};
