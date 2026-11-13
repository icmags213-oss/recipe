/* Durable account-scoped library and upload queue. No credentials are stored here. */
(function (global) {
  'use strict';
  const request = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  global.openRecipeDeviceLibrary = async function (owner) {
    const opening = indexedDB.open('recipe-device-library-v1-' + owner, 1);
    opening.onupgradeneeded = () => {
      for (const name of ['recipes', 'prefs', 'outbox', 'meta']) opening.result.createObjectStore(name);
    };
    const db = await request(opening);
    db.onversionchange = () => db.close();
    async function transaction(names, write, action) {
      const tx = db.transaction(names, write ? 'readwrite' : 'readonly');
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Device storage failed'));
        tx.onabort = () => reject(tx.error || new Error('Device storage failed'));
      });
      const stores = Object.fromEntries(names.map(n => [n, tx.objectStore(n)]));
      try {
        const value = await action(stores);
        await done;
        return value;
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        await done.catch(() => {});
        throw error;
      }
    }
    async function change(action) {
      return transaction(['recipes', 'prefs', 'outbox', 'meta'], true, async stores => {
        const version = (await request(stores.meta.get('version'))) || 0;
        let sequence = 0;
        const queue = operation => stores.outbox.put(operation, String(version + 1).padStart(16, '0') + ':' + String(sequence++).padStart(8, '0')); 
        if (await action(stores, queue) === false) return;
        stores.meta.put(version + 1, 'version');
      });
    }
    const api = {
      async allRecipes() { return transaction(['recipes'], false, s => request(s.recipes.getAll())); },
      async allPrefs() {
        return transaction(['prefs'], false, async s => {
          const keys = await request(s.prefs.getAllKeys());
          const values = await request(s.prefs.getAll());
          return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
        });
      },
      async pref(key, value) {
        if (value === undefined) return transaction(['prefs'], false, s => request(s.prefs.get(key)));
        return change(async (s, queue) => {
          const previous = await request(s.prefs.get(key));
          if (JSON.stringify(previous) === JSON.stringify(value)) return false;
          s.prefs.put(value, key); queue({type:'pref', key, data:value});
        });
      },
      async putRecipes(list) {
        return change((s, queue) => list.forEach(item => {
          s.recipes.put(item, String(item.id)); queue({type:'recipe', key:String(item.id), data:item});
        }));
      },
      async deleteRecipe(id) {
        return change((s, queue) => { s.recipes.delete(String(id)); queue({type:'delete', key:String(id)}); });
      },
      async clearRecipes() {
        return change(async (s, queue) => {
          const keys = await request(s.recipes.getAllKeys());
          keys.forEach(key => queue({type:'delete', key})); s.recipes.clear();
        });
      },
      async resetData() {
        return change((s, queue) => {
          s.recipes.clear(); s.prefs.clear(); s.outbox.clear(); queue({type:'reset'});
        });
      },
      async pending() {
        return transaction(['outbox'], false, async s => {
          // Ordered sequence keys preserve operation order, including reset/delete.
          const keys = await request(s.outbox.getAllKeys());
          const values = await request(s.outbox.getAll());
          return keys.map((id, i) => ({id, ...values[i]}));
        });
      },
      async acknowledge(id) { return transaction(['outbox'], true, s => request(s.outbox.delete(id))); },
      async version() { return transaction(['meta'], false, s => request(s.meta.get('version'))); },
      async initialized() { return transaction(['meta'], false, s => request(s.meta.get('initialized'))); },
      async replaceSnapshot(recipes, prefs, expectedVersion) {
        return transaction(['recipes','prefs','outbox','meta'], true, async s => {
          const version = await request(s.meta.get('version'));
          const pending = await request(s.outbox.count());
          if (version !== expectedVersion || pending) return false;
          s.recipes.clear(); s.prefs.clear();
          recipes.forEach(row => s.recipes.put(row.data, String(row.id)));
          prefs.forEach(row => s.prefs.put(row.data, row.id));
          s.meta.put(true, 'initialized');
          s.meta.put((version || 0) + 1, 'version');
          return true;
        });
      },
      async seed(recipes, prefs) {
        return transaction(['recipes','prefs','meta'], true, async s => {
          if (await request(s.meta.get('seeded'))) return;
          recipes.forEach(item => s.recipes.put(item, String(item.id)));
          Object.entries(prefs).forEach(([key,value]) => s.prefs.put(value,key));
          s.meta.put(true,'seeded');
        });
      },
      close() { db.close(); }
    };
    return api;
  };
})(window);
