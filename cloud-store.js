/* Recipes and edits are durable on this device. Sign-in enables account-scoped sync. */
(function (global) {
  'use strict';
  const local = global.Store;
  const config = global.RECIPE_SUPABASE || {};
  let client, userId, initialized, mode, device, libraryOwner, syncing, syncTimer;
  let stopped = false, initialDownload = false;
  const panel = document.createElement('section');
  panel.id = 'cloud-account';
  panel.style.cssText = 'padding:8px 0;font-family:var(--ui);font-size:12px';
  panel.innerHTML = '<button class="side-row" id="cloud-toggle" aria-expanded="false" aria-controls="cloud-controls">Cloud account</button> <span id="cloud-status" role="status" style="display:block;padding:0 8px;overflow-wrap:anywhere">On this device</span><div id="cloud-controls" hidden><p>Sign in to save recipes, photos, plans, pantry, shopping lists and settings across devices. Recipes stay saved on this device. Sign in to sync changes across devices. Changes made offline upload when connected.</p><form id="cloud-login"><label>Email <input name="email" type="email" autocomplete="username" required></label> <label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label> <button class="btn" type="submit">Sign in</button> <button class="btn" type="button" id="cloud-signup">Create account</button></form><button class="btn" id="cloud-local">Pause syncing</button> <button class="btn" id="cloud-reload">Sync now</button> <button class="btn" id="cloud-import">Copy device data to cloud</button> <button class="btn" id="cloud-signout">Sign out</button><p id="cloud-message" role="alert"></p></div>';
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
  function fail(error) { throw error; }
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
  async function pages(api, table) {
    const rows = [];
    // Previously saved full-size photos can exceed database response time limits.
    // Fetch one row at a time until re-import replaces those large photo copies.
    const pageSize = 1;
    for (let start = 0; ; start += pageSize) {
      if (table === 'recipe_entries') $('cloud-status').textContent = `Loading cloud recipes… ${rows.length} loaded`;
      const batch = await result(api.from(table).select('*').eq('user_id', userId).order('id').range(start, start + pageSize - 1));
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
  async function loadDeviceModule() {
    if (global.openRecipeDeviceLibrary) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'device-library.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not open device storage. Reconnect and reload the app.'));
      document.head.append(script);
    });
  }
  function status(text) { $('cloud-status').textContent = text; }
  function rememberOwner(owner) { localStorage.setItem('recipe-library-owner', owner); }
  function canSync() { return client && userId && libraryOwner === userId && !stopped && !sessionStorage.getItem('recipe-device-mode'); }
  async function accountClient() {
    const session = (await client.auth.getSession()).data?.session;
    if (!session || session.user.id !== libraryOwner) throw new Error('Sign in to this library account to sync changes.');
    const token = session.access_token;
    const {data, error} = await client.auth.getUser(token);
    if (error) throw error;
    if (data.user?.id !== libraryOwner) throw new Error('The active account changed.');
    return global.supabase.createClient(config.url, config.publishableKey, {accessToken: async () => token});
  }
  async function performSync(pull) {
    if (!canSync()) return;
    if (!pull && !(await device.pending()).length) return;
    const api = await accountClient();
    status('Syncing — recipes are saved on this device');
    for (const operation of await device.pending()) {
      if (!canSync()) return;
      const table = operation.type === 'pref' ? 'recipe_preferences' : 'recipe_entries';
      if (operation.type === 'reset') await result(api.rpc('recipe_reset_library'));
      else if (operation.type === 'delete') await result(api.from(table).delete().eq('user_id', userId).eq('id', operation.key));
      else {
        const data = operation.type === 'recipe' ? await prepareRecipe(operation.data) : operation.data;
        await result(api.from(table).upsert({user_id:userId, id:operation.key, data}, {onConflict:'user_id,id'}));
      }
      await device.acknowledge(operation.id);
    }
    if (!pull) { status('Saved on this device · synced'); return; }
    const version = await device.version();
    if ((await device.pending()).length || !canSync()) return;
    const [entries, settings] = await Promise.all([pages(api, 'recipe_entries'), pages(api, 'recipe_preferences')]);
    if (!canSync()) return;
    const replaced = await device.replaceSnapshot(entries, settings, version);
    if (!replaced) { scheduleSync(); return; }
    status('Saved on this device · synced');
    message('Cloud copy updated. Reload the library to see changes from another device.');
  }
  async function syncNow({pull = true} = {}) {
    if (!canSync()) return;
    if (syncing) return syncing;
    const work = async () => {
      try { await performSync(pull); }
      catch (error) {
        status('Saved on this device · waiting to sync');
        message('Your recipes and edits are saved here. Sync will retry when connected. ' + (error.message || 'Cloud unavailable.'));
      }
    };
    syncing = (navigator.locks ? navigator.locks.request('recipe-sync-' + libraryOwner, work) : work());
    try { await syncing; } finally { syncing = null; }
  }
  function scheduleSync() {
    if (!canSync() || initialDownload) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow({pull:false}); }, 500);
  }
  async function setup() {
    await loadDeviceModule();
    let session = null;
    if (config.url && config.publishableKey) {
      if (!config.publishableKey.startsWith('sb_publishable_')) throw new Error('Use a public Supabase publishable key.');
      client = global.supabase.createClient(config.url, config.publishableKey);
      // An expired session must never prevent access to the device copy.
      let timer;
      try {
        const response = await Promise.race([client.auth.getSession(), new Promise(resolve => { timer = setTimeout(() => resolve({data:{session:null}}), 8000); })]);
        session = response.data?.session || null;
      } catch (_) {} finally { clearTimeout(timer); }
    }
    userId = session?.user.id || null;
    libraryOwner = userId || localStorage.getItem('recipe-library-owner') || 'device';
    device = await global.openRecipeDeviceLibrary(libraryOwner);
    if (libraryOwner === 'device') {
      await local.ready();
      await device.seed(await local.allRecipes(), await local.allPrefs());
    }
    rememberOwner(libraryOwner);
    mode = userId ? 'cloud' : 'local';
    status(!userId ? 'Saved on this device · sign in to sync' : canSync() ? 'Saved on this device · sync enabled' : 'Saved on this device · sync paused');
    if (client) client.auth.onAuthStateChange((event, next) => {
      if (next?.user.id && next.user.id !== libraryOwner) { stopped = true; clearTimeout(syncTimer); location.reload(); }
      else if (!next && userId) {
        userId = null; stopped = true; clearTimeout(syncTimer);
        status('Saved on this device · sign in to sync'); $('cloud-login').hidden = false;
      }
    });
    $('cloud-login').hidden = !!userId;
    $('cloud-signout').hidden = !userId;
    $('cloud-local').hidden = !userId;
    $('cloud-import').hidden = !userId;
    $('cloud-reload').hidden = !userId;
    const login = $('cloud-login');
    async function authenticate(signup) {
      if (!client) { message('Cloud sync is not configured. Device storage still works.'); return; }
      if (!login.reportValidity()) return;
      const values = new FormData(login);
      const credentials = {email:values.get('email'), password:values.get('password')};
      const response = await (signup ? client.auth.signUp(credentials) : client.auth.signInWithPassword(credentials));
      login.elements.password.value = '';
      if (response.error) { message(response.error.message); return; }
      if (!response.data.session) { message('Confirm your email, then sign in to sync.'); return; }
      sessionStorage.removeItem('recipe-device-mode'); location.reload();
    }
    login.onsubmit = event => { event.preventDefault(); authenticate(false).catch(error => message(error.message)); };
    $('cloud-signup').onclick = () => authenticate(true).catch(error => message(error.message));
    $('cloud-signout').onclick = async () => {
      // Retain the account's local library and pending edits after signing out.
      stopped = true; clearTimeout(syncTimer);
      const response = await client.auth.signOut({scope:'local'});
      if (response.error) { stopped = false; message(response.error.message); return; }
      location.reload();
    };
    $('cloud-local').onclick = () => { sessionStorage.setItem('recipe-device-mode', '1'); location.reload(); };
    $('cloud-reload').onclick = async () => {
      sessionStorage.removeItem('recipe-device-mode'); stopped = false;
      await syncing;
      await syncNow(); location.reload();
    };
    $('cloud-import').onclick = async () => {
      if (libraryOwner !== userId) { message('Reload online to download the account library before copying data.'); return; }
      if (!confirm('Copy missing recipes and settings from the separate device library into this account? Existing account data will be kept.')) return;
      const other = await global.openRecipeDeviceLibrary('device');
      try {
        await local.ready();
        await other.seed(await local.allRecipes(), await local.allPrefs());
        const existing = new Set((await device.allRecipes()).map(item => String(item.id)));
        for (const item of await other.allRecipes()) if (!existing.has(String(item.id))) await device.putRecipes([item]);
        const savedPrefs = await device.allPrefs();
        for (const [key,value] of Object.entries(await other.allPrefs())) if (!(key in savedPrefs)) await device.pref(key,value);
        await syncNow(); location.reload();
      } catch (error) { message(error.message); } finally { other.close(); }
    };
    // First connection downloads before the app writes default startup settings.
    // Later starts always open the durable account copy immediately.
    if (canSync() && !(await device.initialized())) {
      initialDownload = true;
      try { await syncNow(); } finally { initialDownload = false; }
    } else if (canSync()) setTimeout(() => syncNow(), 0);
    if (libraryOwner !== 'device' && !(await device.initialized())) {
      // Never upload startup defaults over an account we have not downloaded.
      device.close();
      libraryOwner = 'device';
      device = await global.openRecipeDeviceLibrary('device');
      await local.ready();
      await device.seed(await local.allRecipes(), await local.allPrefs());
      rememberOwner('device');
      status('Device library · reconnect to download your cloud library');
      message('The cloud library has not downloaded on this device yet. Your device-only edits stay separate. Reload when connected to download the account library.');
    }
    global.addEventListener('online', scheduleSync);
    global.addEventListener('focus', () => syncNow());
    setInterval(scheduleSync, 60000);
  }
  async function ready() { if (!initialized) initialized = setup(); return initialized; }
  global.Store = {
    get isMemoryOnly() { return false; },
    get wasRepaired() { return local.wasRepaired; },
    ready,
    async allRecipes() { await ready(); return device.allRecipes(); },
    async putRecipes(list) { await ready(); await device.putRecipes(list); scheduleSync(); },
    async deleteRecipe(id) { await ready(); await device.deleteRecipe(id); scheduleSync(); },
    async clearRecipes() { await ready(); await device.clearRecipes(); scheduleSync(); },
    async resetData() { await ready(); await device.resetData(); scheduleSync(); },
    async pref(key, value) {
      await ready();
      const result = await device.pref(key, value);
      if (value !== undefined) scheduleSync();
      return result;
    }
  };
  const resetSection = document.createElement('section');
  resetSection.innerHTML = '<button class="side-row" id="reset-library" style="color:var(--danger)">Reset library</button><p id="reset-status" role="status" style="font-size:12px;padding:0 8px"></p>';
  $('settings-submenu').append(resetSection);
  $('reset-library').onclick = async () => {
    try { await ready(); } catch (error) { $('reset-status').textContent = error.message; return; }
    const target = libraryOwner === 'device' ? 'this device library' : 'this account library on this device, and its cloud copy when you next sync';
    const answer = prompt(`This permanently deletes all recipes, photos, meal plans, pantry items, shopping lists, restaurants and settings from ${target}. Your login account and the bundled Brendens Cookbook are kept. Export anything you want to keep first. Type RESET to start fresh.`);
    if (answer !== 'RESET') return;
    $('reset-library').disabled = true;
    $('reset-status').textContent = 'Resetting library…';
    try { await global.Store.resetData(); await syncNow(); location.reload(); }
    catch (error) { $('reset-status').textContent = 'Reset failed. ' + error.message; $('reset-library').disabled = false; }
  };
  const cookbookScript = document.createElement('script');
  cookbookScript.src = 'brendens-cookbook.js';
  document.head.append(cookbookScript);
})(window);
