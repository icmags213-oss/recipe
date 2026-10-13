/* Supabase is authoritative in cloud mode. Local mode keeps the original
   IndexedDB database intact. No background upload or automatic account merge. */
(function (global) {
  'use strict';
  const local = global.Store;
  const config = global.RECIPE_SUPABASE || {};
  let client, userId, initialized, mode;
  const prefs = new Map();
  const recipes = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const panel = document.createElement('section');
  panel.id = 'cloud-account';
  panel.style.cssText = 'padding:8px 0;font-family:var(--ui);font-size:12px';
  panel.innerHTML = '<button class="side-row" id="cloud-toggle" aria-expanded="false" aria-controls="cloud-controls">Cloud account</button> <span id="cloud-status" role="status" style="display:block;padding:0 8px;overflow-wrap:anywhere">On this device</span><div id="cloud-controls" hidden><p>Sign in to save recipes, photos, plans, pantry, shopping lists and settings across devices. Cloud mode requires a connection. Your existing device data stays separate.</p><form id="cloud-login"><label>Email <input name="email" type="email" autocomplete="username" required></label> <label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label> <button class="btn" type="submit">Sign in</button> <button class="btn" type="button" id="cloud-signup">Create account</button></form><button class="btn" id="cloud-local">Use this device</button> <button class="btn" id="cloud-reload">Reload cloud data</button> <button class="btn" id="cloud-import">Copy device data to cloud</button> <button class="btn" id="cloud-signout">Sign out</button><p id="cloud-message" role="alert"></p></div>';
  document.getElementById('settings-submenu').append(panel);
  const style = document.createElement('style');
  style.textContent = '#side{overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding-bottom:calc(24px + env(safe-area-inset-bottom))}#side > *{flex-shrink:0}#cloud-controls{padding-bottom:16px}#cloud-controls label{display:block;margin:8px 0}#cloud-controls input{display:block;width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--rule);border-radius:6px;background:var(--list);color:var(--ink)}#cloud-controls .btn{font-size:12px;margin:4px 0;max-width:100%;white-space:normal}';
  document.head.append(style);
  const $ = id => document.getElementById(id);
  const message = text => { $('cloud-message').textContent = text; };
  function showControls(open) {
    $('cloud-controls').hidden = !open;
    $('cloud-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      $('settings-submenu').hidden = false;
      $('btn-settings').setAttribute('aria-expanded', 'true');
      panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
  }
  $('cloud-toggle').onclick = () => showControls($('cloud-controls').hidden);
  function fail(error) {
    message('Cloud operation failed. Changes were not confirmed saved. Check your connection and reload cloud data before continuing. ' + (error.message || 'Please try again.'));
    showControls(true);
    throw error;
  }
  async function result(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let response;
    try { response = await (typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query); }
    catch (error) { return fail(error); }
    finally { clearTimeout(timer); }
    if (response.error) return fail(response.error);
    return response.data;
  }
  async function pages(table) {
    const rows = [];
    // Previously saved full-size photos can exceed database response time limits.
    // Fetch one row at a time until re-import replaces those large photo copies.
    const pageSize = 1;
    for (let start = 0; ; start += pageSize) {
      if (table === 'recipe_entries') $('cloud-status').textContent = `Loading cloud recipes… ${rows.length} loaded`;
      const batch = await result(client.from(table).select('*').eq('user_id', userId).order('id').range(start, start + pageSize - 1));
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }
  async function prepareRecipe(item) {
    const images = [];
    for (const source of item.images || []) {
      if (typeof source !== 'string' || source.length <= 400000 || !source.startsWith('data:image/')) {
        images.push(source); continue;
      }
      images.push(await new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => finish(new Error('Photo preparation timed out. Your original export is unchanged.')), 15000);
        function finish(error, value) {
          clearTimeout(timer);
          image.onload = image.onerror = null;
          image.removeAttribute('src');
          if (error) reject(error); else resolve(value);
        }
        image.onerror = () => finish(new Error('Could not prepare a photo. Your original export is unchanged.'));
        image.onload = () => {
          let canvas;
          try {
            const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
            canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            let encoded = canvas.toDataURL('image/jpeg', 0.8);
            if (encoded.length > 600000) encoded = canvas.toDataURL('image/jpeg', 0.6);
            finish(null, encoded.length < source.length ? encoded : source);
          } catch (error) { finish(error); }
          finally { if (canvas) canvas.width = canvas.height = 0; }
        };
        image.src = source;
      }));
    }
    return { ...item, images };
  }
  async function setup() {
    if (!config.url || !config.publishableKey) {
      message('Cloud storage is not configured yet. Device storage is available.');
      for (const id of ['cloud-login', 'cloud-local', 'cloud-reload', 'cloud-import', 'cloud-signout']) $(id).hidden = true;
      mode = 'local';
      return local.ready();
    }
    if (!config.publishableKey.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key, never a secret or service-role key.');
    client = global.supabase.createClient(config.url, config.publishableKey);
    const session = await result(client.auth.getSession());
    if (session.session && !sessionStorage.getItem('recipe-device-mode')) {
      userId = session.session.user.id;
      mode = 'cloud';
      // Do not fall back to another account's data when a cloud read fails.
      const [savedRecipes, savedPrefs] = await Promise.all([pages('recipe_entries'), pages('recipe_preferences')]);
      savedRecipes.forEach(row => recipes.set(row.id, row.data));
      savedPrefs.forEach(row => prefs.set(row.id, row.data));
      $('cloud-status').textContent = 'Cloud account: ' + session.session.user.email;
      $('cloud-login').hidden = true;
      // Auth events from another tab invalidate this in-memory account immediately.
      client.auth.onAuthStateChange((event, next) => {
        if (!next || next.user.id !== userId) {
          userId = null;
          recipes.clear(); prefs.clear();
          location.reload();
        }
      });
    } else {
      mode = 'local';
      await local.ready();
    }
    $('cloud-signout').hidden = !session.session;
    $('cloud-local').hidden = mode === 'local';
    $('cloud-import').hidden = mode !== 'cloud';
    $('cloud-reload').hidden = mode !== 'cloud';
    const login = $('cloud-login');
    async function authenticate(signup) {
      if (!login.reportValidity()) return;
      const values = new FormData(login);
      const credentials = { email: values.get('email'), password: values.get('password') };
      const response = await (signup ? client.auth.signUp(credentials) : client.auth.signInWithPassword(credentials));
      login.elements.password.value = '';
      if (response.error) { message(response.error.message); return; }
      if (!response.data.session) { message('Check your email to confirm your account, then sign in.'); return; }
      sessionStorage.removeItem('recipe-device-mode');
      location.reload();
    }
    login.onsubmit = event => { event.preventDefault(); authenticate(false).catch(error => message(error.message)); };
    $('cloud-signup').onclick = () => authenticate(true).catch(error => message(error.message));
    $('cloud-signout').onclick = async () => {
      try { await result(client.auth.signOut()); sessionStorage.removeItem('recipe-device-mode'); location.reload(); }
      catch (error) { message(error.message); }
    };
    $('cloud-local').onclick = () => { sessionStorage.setItem('recipe-device-mode', '1'); location.reload(); };
    $('cloud-reload').onclick = () => location.reload();
    $('cloud-import').onclick = async () => {
      if (!confirm('Copy the data saved in this browser into this signed-in account? Only missing recipes and settings will be copied. Existing cloud data and the device copy will be kept. You can retry if interrupted.')) return;
      const button = $('cloud-import');
      button.disabled = true;
      try {
        const deviceRecipes = await local.allRecipes();
        const devicePrefs = await local.allPrefs();
        const uid = await owner();
        for (let i = 0; i < deviceRecipes.length; i++) {
          message(`Copying recipe ${i + 1} of ${deviceRecipes.length}. Keep the app open.`);
          const item = await prepareRecipe(deviceRecipes[i]);
          await result(client.from('recipe_entries').upsert({ user_id: uid, id: String(item.id), data: item }, { onConflict: 'user_id,id', ignoreDuplicates: true }));
        }
        for (const [id, data] of Object.entries(devicePrefs)) {
          message('Copying device settings…');
          await result(client.from('recipe_preferences').upsert({ user_id: uid, id, data }, { onConflict: 'user_id,id', ignoreDuplicates: true }));
        }
        location.reload();
      } catch (error) { message(error.message); button.disabled = false; }
    };
  }
  async function ready() { if (!initialized) initialized = setup(); return initialized; }
  async function owner() {
    await ready();
    if (!userId) throw new Error('Please sign in again.');
    const data = await result(client.auth.getUser());
    if (data.user.id !== userId) throw new Error('Account changed. Reload before continuing.');
    return userId;
  }
  global.Store = {
    get isMemoryOnly() { return mode === 'local' && local.isMemoryOnly; },
    get wasRepaired() { return local.wasRepaired; },
    ready,
    async allRecipes() { await ready(); return mode === 'local' ? local.allRecipes() : clone([...recipes.values()]); },
    async putRecipes(list) {
      await ready();
      if (mode === 'local') return local.putRecipes(list);
      const uid = await owner();
      if (!list.length) return;
      for (const source of list) {
        const item = await prepareRecipe(source);
        await result(client.from('recipe_entries').upsert({ user_id: uid, id: String(item.id), data: item }, { onConflict: 'user_id,id' }));
        recipes.set(String(item.id), clone(item));
      }
    },
    async deleteRecipe(id) {
      await ready();
      if (mode === 'local') return local.deleteRecipe(id);
      await result(client.from('recipe_entries').delete().eq('user_id', await owner()).eq('id', String(id)));
      recipes.delete(String(id));
    },
    async clearRecipes() {
      await ready();
      if (mode === 'local') return local.clearRecipes();
      await result(client.from('recipe_entries').delete().eq('user_id', await owner()));
      recipes.clear();
    },
    async pref(key, value) {
      await ready();
      if (mode === 'local') return local.pref(key, value);
      if (value === undefined) return prefs.has(key) ? clone(prefs.get(key)) : undefined;
      await result(client.from('recipe_preferences').upsert({ user_id: await owner(), id: key, data: value }, { onConflict: 'user_id,id' }));
      prefs.set(key, clone(value));
    }
  };
  global.addEventListener('unhandledrejection', event => {
    if (mode === 'cloud') { message('A cloud operation failed. Reload cloud data before continuing; your last change may not be saved.'); showControls(true); }
  });
})(window);
