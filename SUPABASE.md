# Supabase setup

## Current project status

Recipe (`pnykwfzfosewnrulaxog`) is active in the Free-plan LevelUp Pickleball Club
organization. The schema has been applied as `recipe_persistence`; do not run the
schema again. Owner CRUD, cross-user isolation, ownership protection, and anonymous
denial passed tests against the live database, using rolled-back test rows. The
security advisor returned no findings. Email login and confirmation are enabled;
anonymous sign-in is disabled. Site URL and the exact redirect URL are configured
for `https://icmags213-oss.github.io/recipe/`. The included configuration already
contains this project's public URL and publishable key.

The remaining step is deploying the app files. Automatic approval review blocked
the earlier GitHub upload because the large HTML file exceeded its review budget.
Unzip `recipe-supabase.zip` and upload the **contents** of its `recipe` directory to
the root of `icmags213-oss/recipe`, retaining subdirectories such as `vendor` and
`icons`. GitHub Pages should serve `main` at the repository root. Once deployed,
open Cloud account → Create account, confirm your email, and sign in. Use the copy
device-data button on your original browser to upload your existing library.

Supabase's default email sender may restrict delivery to organization members.
If confirmation email fails, configure custom SMTP in the project's email settings.
The complete browser signup/login flow has not been verified with a real account.

The existing device database (`mise`) is preserved. Without configuration or a
signed-in cloud account, the app continues using that database. Cloud mode stores
recipes (including their existing embedded photos) in `recipe_entries`. All other
data that the app saves through Store.pref—restaurants, pantry/fridge/freezer,
shopping lists, calendar plans, custom holidays, kitchen recipes, swipe progress,
custom food photos, and settings—lives in `recipe_preferences`.

## Configure and deploy

1. Create a **separate Recipe Supabase project** in the organization you choose.
   Do not apply the schema to the existing LevelUp Ladder project.
2. Run `supabase/schema.sql` once in the Recipe project's SQL editor. It creates
   new tables and policies in one transaction; it does not alter existing tables.
   If the tables already exist, the transaction fails rather than replacing data.
3. In Authentication → URL Configuration set Site URL to
   `https://icmags213-oss.github.io/recipe/` (or your actual deployed URL). Add that
   exact URL to the allowed redirects. Enable email/password login and keep email
   confirmation enabled. Configure SMTP for reliable production confirmation email.
4. In `supabase-config.js`, set `url` to the Recipe project URL and
   `publishableKey` to its **sb_publishable_** key. These are public configuration.
   Never use a secret key, service_role key, database password, or personal token.
5. Deploy the branch through GitHub Pages as described in README. No build step.
   The Supabase browser library is vendored and pinned to 2.117.3; its checksum is
   recorded in `vendor/DEPENDENCIES.json`. No runtime CDN is required.
6. Open Cloud account → Create account, confirm the email, then sign in. Create,
   edit, and delete recipes through the existing app controls. Reload cloud data
   or open another device signed into the same account to see the saved changes.

## Existing data and offline use

Use **Copy device data to a cloud account with no recipes** on the original browser
and origin where the recipes were saved. This is an explicit, atomic upload;
existing cloud preferences win on conflicts. It keeps the device copy intact and
refuses an import when cloud recipes already exist. Browser data from another
origin cannot be discovered automatically. Use the existing export/import tools
to move data from another origin or to merge additional recipe collections.

Cloud mode requires an internet connection. A failed cloud read never falls back
to device data, and failed writes show an account-panel error rather than claiming
success. Reload before continuing after an error, because some existing app
controls update their displayed state before persistence completes. The app does
not implement an offline cloud write queue or automatic conflict merging. Select
Use this device for the separate offline library; signing in again returns to
cloud mode. Account changes reload the page to discard prior account state.

Cloud data is loaded at startup and refreshed by reloading. Concurrent edits use
last successful write wins for each recipe or preference. Avoid editing the same
shopping list or plan from multiple devices simultaneously. Photos retain the
app's existing base64 representation in JSON, so large collections consume
database storage; a separate Storage upload pipeline is a future enhancement.

## Access rules and verification

Each row belongs to `auth.users.id`; compound primary keys allow different users
to have identical recipe IDs. RLS restricts select/insert/update/delete to that
owner. Updates check both existing and resulting ownership. Anonymous requests
have no table privileges. The import function is SECURITY INVOKER and requires
authentication; it never bypasses RLS. No service key is used in the browser.

The service worker caches only known same-origin app files, never Supabase API
responses. Do not add API URLs to its shell cache list.

Before production deployment, install test dependencies with `pnpm install
--frozen-lockfile`, then run `pnpm test`. The test dependency is pinned and has a
committed lockfile. Also verify in the real project with two separate confirmed test
accounts: create/update a recipe and plan as A; confirm B cannot read, update,
delete, or assign itself A's rows. Confirm signed-out access fails, cloud errors
are visible, and the original device library survives sign-out. Run Supabase's
security advisors after applying the schema.
