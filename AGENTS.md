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

## Hygiene

- Run `npm run check` before `npm run build`.
- Deploy with `npm run deploy` after a successful build.
- If loader behavior changes, verify there is only one implementation in the repo.
- If payload behavior changes, do not touch bookmarklet generation unless loader behavior truly changed.
