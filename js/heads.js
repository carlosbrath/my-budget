'use strict';

// Manage the parent / child heads for expenses and income.
const Heads = {
  render(el) {
    el.innerHTML = `
      <div class="grid-2" style="margin-top:0;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        ${this.column('expense', 'Expense heads')}
        ${this.column('income', 'Income heads')}
      </div>
      <p class="muted" style="margin-top:12px">Tip: entries can use any head, parent or child. Reports add children into their parents.
        A head that has entries can't be deleted — hide it instead.</p>`;
  },

  column(type, title) {
    const counts = {};
    Store.entries().forEach(e => { if (e.headId) counts[e.headId] = (counts[e.headId] || 0) + 1; });
    const tree = Store.headTree(type, true);
    return `<div class="card">
      <div class="card-head"><h2>${title}</h2></div>
      ${tree.map(({ head: h, depth }) => {
        const used = counts[h.id] || 0;
        const canDelete = !h.system && !used && !Store.childHeads(h.id).length;
        return `<div class="tree-row depth-${depth} ${h.archived ? 'archived' : ''}" style="padding-left:${4 + depth * 20}px">
          <span class="tree-name">${depth ? '<span class="muted">└ </span>' : ''}${U.esc(h.name)}
            ${used ? `<span class="badge">${used}</span>` : ''}${h.system ? '<span class="badge warn">auto</span>' : ''}</span>
          <span class="tree-actions">
            ${h.system ? '' : `<button class="link" data-action="addSubHead" data-id="${h.id}">+ Sub</button>
            <button class="link" data-action="renameHead" data-id="${h.id}">Rename</button>
            <button class="link" data-action="moveHead" data-id="${h.id}">Move</button>
            <button class="link" data-action="archiveHead" data-id="${h.id}">${h.archived ? 'Show' : 'Hide'}</button>`}
            ${canDelete ? `<button class="link danger" data-action="deleteHead" data-id="${h.id}">Delete</button>` : ''}
          </span>
        </div>`;
      }).join('')}
      <div class="inline-form" style="margin-top:10px">
        <input id="newHead-${type}" placeholder="New main head">
        <button class="btn" data-action="addHead" data-type="${type}">Add</button>
      </div>
    </div>`;
  },

  async add(type) {
    const input = document.getElementById('newHead-' + type);
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    await Store.add('heads', { name, type, parentId: null, archived: false });
    U.toast('Head added');
    App.render();
  },

  async addSub(parentId) {
    const parent = Store.get('heads', parentId);
    const name = prompt(`New sub-head under "${Store.headPath(parentId)}"`);
    if (!name || !name.trim()) return;
    await Store.add('heads', { name: name.trim(), type: parent.type, parentId, archived: false });
    App.render();
  },

  async rename(id) {
    const h = Store.get('heads', id);
    const name = prompt('Rename head', h.name);
    if (name && name.trim()) { await Store.update('heads', id, { name: name.trim() }); App.render(); }
  },

  async move(id) {
    const h = Store.get('heads', id);
    const blocked = Store.descendantIds(id);
    const options = Store.headTree(h.type, false).filter(t => !blocked.has(t.head.id) && !t.head.system);
    const list = ['0. (Top level)'].concat(options.map((t, i) => `${i + 1}. ${Store.headPath(t.head.id)}`)).join('\n');
    const ans = prompt(`Move "${h.name}" under which head? Type the number:\n\n${list}`);
    if (ans === null) return;
    const n = parseInt(ans, 10);
    if (isNaN(n) || n < 0 || n > options.length) { U.toast('Invalid choice'); return; }
    await Store.update('heads', id, { parentId: n === 0 ? null : options[n - 1].head.id });
    App.render();
  },

  async toggleArchive(id) {
    const h = Store.get('heads', id);
    await Store.update('heads', id, { archived: !h.archived });
    App.render();
  },

  async remove(id) {
    const h = Store.get('heads', id);
    if (!confirm(`Delete head "${h.name}"?`)) return;
    await Store.remove('heads', id);
    App.render();
  },
};
