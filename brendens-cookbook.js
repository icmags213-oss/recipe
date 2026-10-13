(function () {
  'use strict';
  const section = document.createElement('section');
  section.style.cssText = 'padding:8px 0;font:12px var(--ui)';
  section.innerHTML = '<button class="side-row" id="brendens-cookbook">Brendens Cookbook</button><p id="cookbook-status" role="status" style="padding:0 8px;overflow-wrap:anywhere"></p><button class="btn" id="cookbook-refresh" hidden>Reload library</button>';
  document.getElementById('settings-submenu').append(section);
  const button = document.getElementById('brendens-cookbook');
  const status = document.getElementById('cookbook-status');
  const refresh = document.getElementById('cookbook-refresh');
  refresh.onclick = () => location.reload();
  async function read(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('Cookbook download failed. Check your connection and try again.');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  button.onclick = async () => {
    if (!confirm('Add Brendens Cookbook to your current library? Existing recipes will be kept. Sign into Cloud account first if you want these recipes on your other devices. Keep the app open until copying finishes.')) return;
    button.disabled = true;
    refresh.hidden = true;
    let saved = 0, skipped = 0;
    try {
      status.textContent = 'Opening cookbook…';
      await Store.ready();
      if (Store.isMemoryOnly) throw new Error('Browser storage is unavailable; these recipes cannot be saved permanently.');
      const existing = new Set((await Store.allRecipes()).map(recipe => String(recipe.id)));
      const manifest = await read('cookbook/manifest.json');
      if (!Array.isArray(manifest.parts) || manifest.parts.length !== manifest.count) throw new Error('Cookbook index is incomplete.');
      for (let i = 0; i < manifest.parts.length; i++) {
        const file = manifest.parts[i];
        if (!/^recipe-\d{3}\.json$/.test(file)) throw new Error('Invalid cookbook file.');
        status.textContent = `Copying cookbook ${i + 1} of ${manifest.count}… ${saved} added, ${skipped} already in your library.`;
        const raw = await read('cookbook/' + file);
        const recipe = Mela.normalize(raw);
        if (existing.has(String(recipe.id))) { skipped++; continue; }
        await Store.putRecipes([recipe]);
        existing.add(String(recipe.id));
        saved++;
      }
      status.textContent = `Cookbook ready. ${saved} recipes added; ${skipped} already in your library. Tap Reload library to see them.`;
      refresh.hidden = false;
    } catch (error) {
      status.textContent = `${saved} recipes added before copying stopped. ${error.message || 'Please try again.'} Tap Brendens Cookbook again to resume; existing recipes are kept.`;
      refresh.hidden = saved === 0;
    } finally { button.disabled = false; }
  };
})();
