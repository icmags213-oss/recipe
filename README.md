# Recipe

A private recipe box that runs in the browser, with optional Supabase cloud storage. It imports Mela
exports, scales by servings, tracks what is in the fridge, freezer and pantry,
plans the week, and works offline.

**Live:** `https://YOUR-USERNAME.github.io/recipe/`

## What it is

No build step or framework. Device mode keeps recipes, photos and shopping lists
in the browser and works offline. Optional cloud mode uses a confirmed Supabase
account to save recipes and app data across devices. Each account has a private
library protected by row-level security. See [SUPABASE.md](SUPABASE.md) to configure
the separate Recipe project and deploy. Cloud mode requires a connection.

## Files

| File | Why it is here |
| --- | --- |
| `index.html` | The whole app. Renamed from `Recipe-v144.html` because GitHub Pages serves `index.html` by default. |
| `healthy-kitchen-vegetables.webp` | An image the page loads by name, so it has to sit beside it. |
| `manifest.webmanifest` | Tells the browser this is an app, so it offers to install it. Without it there is no "Add to Home screen". |
| `sw.js` | Caches the app so it opens with no signal. |
| `icons/` | The home-screen icon, in the three sizes Android and iOS ask for. |
| `.nojekyll` | Stops GitHub trying to process the site as a Jekyll blog. |

## Putting it on the web

Settings → Pages → Source: *Deploy from a branch* → `main` → `/ (root)` → Save.
Give it a minute, then open the address above.

## On your phone

Open the address in Chrome, then **⋮ → Add to Home screen**. It gets its own
icon and opens without browser chrome.

## Updating it later

Deploy the complete app files together and bump the cache name in `sw.js` after
updates. Device recipes remain in the original browser database; cloud recipes
remain in Supabase. Neither library is stored in this repository.
