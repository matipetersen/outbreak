// A tiny in-memory stand-in for the artifact `db` capability, shared by several "clients" in one process.
class FakeStore {
  constructor() { this.docs = new Map(); this.subs = []; }
  _notify() { for (const s of this.subs.slice()) s(); }
  db() {
    const store = this;
    const snapDoc = (path) => { const d = store.docs.get(path); return { id: path.split('/').pop(), exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined), metadata: {} }; };
    const docRef = (path) => ({
      id: path.split('/').pop(), path,
      async get() { return snapDoc(path); },
      async set(data) { store.docs.set(path, JSON.parse(JSON.stringify(data))); store._notify(); },
      async update(data) { if (!store.docs.has(path)) throw { code: 'invalid_argument' }; store.docs.set(path, Object.assign({}, store.docs.get(path), JSON.parse(JSON.stringify(data)))); store._notify(); },
      async delete() { store.docs.delete(path); store._notify(); },
      onSnapshot(next) {
        let last = null;
        const fire = () => { const cur = JSON.stringify(store.docs.get(path) || null); if (cur !== last) { last = cur; next(snapDoc(path)); } };
        store.subs.push(fire); setTimeout(fire, 0); return () => { store.subs = store.subs.filter((x) => x !== fire); };
      },
    });
    const collRef = (name, filters = [], lim = 0) => {
      const matching = () => [...store.docs.entries()].filter(([p, d]) => p.startsWith(name + '/') && p.split('/').length === 2 && filters.every(([f, op, v]) => op === '==' ? d[f] === v : true))
        .map(([p]) => p).sort();
      const snap = (changes) => { const docs = matching().map(snapDoc); return { docs, size: docs.length, empty: !docs.length, docChanges: () => changes(docs), metadata: {} }; };
      const q = {
        path: name,
        where(f, op, v) { return collRef(name, filters.concat([[f, op, v]]), lim); },
        limit(n) { return collRef(name, filters, n); },
        orderBy() { return q; },
        doc(id) { return docRef(`${name}/${id || Math.random().toString(36).slice(2)}`); },
        async add(data) { const r = q.doc(); await r.set(data); return r; },
        async get() { return snap((docs) => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i }))); },
        onSnapshot(next) {
          let seen = new Map();
          const fire = () => {
            const cur = new Map(matching().map((p) => [p, JSON.stringify(store.docs.get(p))]));
            const changes = [];
            for (const [p, v] of cur) { if (!seen.has(p)) changes.push({ type: 'added', doc: snapDoc(p) }); else if (seen.get(p) !== v) changes.push({ type: 'modified', doc: snapDoc(p) }); }
            for (const [p] of seen) if (!cur.has(p)) changes.push({ type: 'removed', doc: { id: p.split('/').pop(), exists: true, data: () => JSON.parse(seen.get(p)) } });
            seen = cur;
            if (changes.length) next({ docs: [...cur.keys()].map(snapDoc), size: cur.size, empty: !cur.size, docChanges: () => changes, metadata: {} });
          };
          store.subs.push(fire); setTimeout(fire, 0); return () => { store.subs = store.subs.filter((x) => x !== fire); };
        },
      };
      return q;
    };
    return { doc: docRef, collection: (n) => collRef(n) };
  }
}
module.exports = { FakeStore };
