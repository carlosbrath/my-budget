'use strict';

// Thin storage layer. Uses IndexedDB, falls back to localStorage if IndexedDB is unavailable.
// The real copy of the data lives in a file on disk (see filestore.js); IndexedDB is the working cache.
const DB = (() => {
  const NAME = 'my-budget';
  const VERSION = 2;
  const STORES = ['heads', 'accounts', 'people', 'committees', 'entries', 'checks', 'meta'];
  let db = null;
  let useLS = false;

  const lsKey = store => NAME + ':' + store;
  const lsRead = store => JSON.parse(localStorage.getItem(lsKey(store)) || '[]');
  const lsWrite = (store, rows) => localStorage.setItem(lsKey(store), JSON.stringify(rows));

  function open() {
    return new Promise(resolve => {
      if (!window.indexedDB) { useLS = true; return resolve(); }
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { useLS = true; return resolve(); }
      req.onupgradeneeded = () => {
        const d = req.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
        // Small key/value store for app internals (data-folder handle, sync state). Not part of backups.
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => { useLS = true; resolve(); };
    });
  }

  function getAll(store) {
    if (useLS) return Promise.resolve(lsRead(store));
    return new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function put(store, rec) {
    if (useLS) {
      const rows = lsRead(store);
      const i = rows.findIndex(r => r.id === rec.id);
      if (i >= 0) rows[i] = rec; else rows.push(rec);
      lsWrite(store, rows);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Used by "restore backup": wipes every store and writes the given data.
  function replaceAll(data) {
    if (useLS) {
      STORES.forEach(s => lsWrite(s, data[s] || []));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach(s => {
        const os = tx.objectStore(s);
        os.clear();
        (data[s] || []).forEach(r => os.put(r));
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function kvGet(key) {
    if (useLS) return Promise.resolve(U.lsGet(lsKey('kv:' + key), undefined));
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function kvSet(key, value) {
    if (useLS) { U.lsSet(lsKey('kv:' + key), value); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    STORES, open, getAll, put, replaceAll, kvGet, kvSet,
    get mode() { return useLS ? 'localStorage' : 'IndexedDB'; },
  };
})();
