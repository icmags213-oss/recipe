# Recipe

A private recipe box that runs entirely in the browser. It imports Mela
exports, scales by servings, tracks what is in the fridge, freezer and pantry,
plans the week, and works offline.

**Live:** `https://YOUR-USERNAME.github.io/recipe/`

## What it is

One HTML file. No build step, no framework, no server, and no account. Every
recipe, photo and shopping list lives in your browser's own storage on your
device — nothing is uploaded anywhere.

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

Replace `index.html` with a newer build and commit. Your recipes are stored in
the browser, not in the repository, so they survive an update untouched.
