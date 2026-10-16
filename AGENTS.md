# FBTargetingManager Agent Notes

## Architecture Rules

- `targeting-loader.js` is the only loader source of truth.
- `targeting-manager.js` is the payload only. Do not embed a second copy of the loader inside it.
- Loader and payload must remain separate scripts.
- The landing page bookmarklet must be generated from `targeting-loader.js`, not from inline loader code duplicated elsewhere.

## Release Rules

- Build versions use `DDMMYYbN`, based on the local build date.
- `npm run build` runs `scripts/bump-build-version.cjs` before packaging. If the current version date is today, it increments only `bN`; otherwise it resets to today's date with `b1`.
- Do not manually keep old build dates in `Config.VERSION` or `package.json`; release builds update them together.
- After each production deploy, run Facebook Sharing Debugger scrape for:
  - `https://fbtargetingmanager.pages.dev/targeting/latest/manifest.html`
  - every `https://fbtargetingmanager.pages.dev/targeting/latest/og/chunk-*.html`
- Use a real Graph API POST scrape request, not Meta Sharing Debugger in a browser.

## Facebook OG scrape token

- `FB_GRAPH_SCRAPE_TOKEN` is a Facebook **app access token**, not a user/system token: it is `app_id|app_secret` (e.g. `6628568379|c1e620...`). The scrape endpoint `graph.facebook.com/v23.0/?id=<url>&scrape=true&fields=og_object` accepts it, and it does not expire like a user token.
- Use a real Graph POST scrape request, not Meta Sharing Debugger in a browser.
- Credentials live in KeePass under `/Cloudflare/Facebook OG Scrape Token` (username = app id, password = app secret; the token is `username|password`).
- The same value is reused by every YellowWebHub tool repo. Reuse it; do not mint per-tool tokens.

## Hygiene

- Run `npm run check` before `npm run build`.
- Deploy with `npm run deploy` after a successful build.
- If loader behavior changes, verify there is only one implementation in the repo.
- If payload behavior changes, do not touch bookmarklet generation unless loader behavior truly changed.
