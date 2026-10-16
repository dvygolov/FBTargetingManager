#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const SOURCE = path.join(ROOT, "targeting-manager.js");
const LOADER_SOURCE = path.join(ROOT, "targeting-loader.js");
const LANDING_SCREENSHOT = path.join(ROOT, "target-current.png");
const OUT_ROOT = path.join(ROOT, "dist", "targeting");
const CHUNK_SIZE = 350000;
const APP_MARK_FILE = "assets/targeting-mark.svg";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitString(input, chunkSize) {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive");
  const chunks = [];
  for (let index = 0; index < input.length; index += chunkSize) {
    chunks.push(input.slice(index, index + chunkSize));
  }
  return chunks;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildAppMarkSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="FBTargetingManager mark">',
    '  <defs>',
    '    <linearGradient id="targeting-gold" x1="0%" x2="100%" y1="0%" y2="100%">',
    '      <stop offset="0%" stop-color="#ffe16a"/>',
    '      <stop offset="55%" stop-color="#ffd000"/>',
    '      <stop offset="100%" stop-color="#ffab00"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#targeting-gold)" stroke-width="6"/>',
    '  <circle cx="48" cy="48" r="22" fill="#222" stroke="url(#targeting-gold)" stroke-width="5"/>',
    '  <circle cx="48" cy="48" r="7" fill="#ffd000"/>',
    '  <path d="M48 12v16M48 68v16M12 48h16M68 48h16" stroke="#fff2bd" stroke-width="5" stroke-linecap="round"/>',
    '</svg>',
  ].join("\n");
}

function parseListArg(name) {
  return readArg(name, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function detectBuild(source) {
  const match = source.match(/VERSION:\s*"([^"]+)"/);
  if (!match) {
    throw new Error("Cannot detect FBTargetingManager VERSION in source file.");
  }
  return match[1];
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function pruneOldBuildDirs(outRoot, currentBuild) {
  if (!fs.existsSync(outRoot)) return;
  for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "latest" || entry.name === currentBuild) continue;
    if (!/^\d{6}b\d+$/i.test(entry.name)) continue;
    fs.rmSync(path.join(outRoot, entry.name), { recursive: true, force: true });
  }
}

function buildOgHtml({ appName, build, chunk, index, total }) {
  const title = `${appName} ${build} chunk ${index + 1}/${total}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="robots" content="noindex,nofollow" />',
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(chunk)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `  <pre>${escapeHtml(title)}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildManifestHtml({ appName, build, manifestBase64 }) {
  const title = `${appName} ${build} manifest`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="robots" content="noindex,nofollow" />',
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(manifestBase64)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `  <pre>${escapeHtml(title)}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildLandingHtml({ appName, displayName = appName, build, bookmarklet, manifestUrl, screenshotUrl, iconUrl }) {
  const title = `${displayName} Loader`;
  const inlineMark = buildAppMarkSvg();
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <meta name="robots" content="noindex,nofollow" />',
    `  <meta name="description" content="${escapeHtml(displayName)} bookmarklet loader for Facebook Ads Manager column preset export and import." />`,
    `  <link rel="icon" href="${escapeHtml(iconUrl)}" type="image/svg+xml" />`,
    "  <style>",
    "    :root {",
    "      --bg: #141414;",
    "      --panel: #202020;",
    "      --panel-2: #292929;",
    "      --ink: #f8f0c8;",
    "      --muted: #a5a08f;",
    "      --gold: #ffd000;",
    "      --gold-2: #ffab00;",
    "      --line: rgba(255, 208, 0, 0.34);",
    "      --soft: rgba(255, 208, 0, 0.11);",
    "    }",
    "    * { box-sizing: border-box; }",
    "    html { scroll-behavior: smooth; }",
    "    body {",
    "      margin: 0;",
    "      min-height: 100vh;",
    "      color: var(--ink);",
    "      font-family: 'Trebuchet MS', Verdana, sans-serif;",
    "      background:",
    "        radial-gradient(circle at 16% 12%, rgba(255, 208, 0, 0.28) 0 10rem, transparent 26rem),",
    "        radial-gradient(circle at 92% 18%, rgba(255, 171, 0, 0.18) 0 12rem, transparent 30rem),",
    "        linear-gradient(135deg, #101010, #1b1b1b 52%, #111);",
    "      overflow-x: hidden;",
    "    }",
    "    body::before {",
    "      content: '';",
    "      position: fixed;",
    "      inset: 0;",
    "      pointer-events: none;",
    "      opacity: 0.12;",
    "      background-image: linear-gradient(90deg, var(--gold) 1px, transparent 1px), linear-gradient(var(--gold) 1px, transparent 1px);",
    "      background-size: 44px 44px;",
    "      mask-image: linear-gradient(to bottom, black, transparent 85%);",
    "    }",
    "    a { color: inherit; }",
    "    main {",
    "      width: min(1180px, calc(100vw - 36px));",
    "      margin: 0 auto;",
    "      padding: 38px 0 72px;",
    "    }",
    "    .nav {",
    "      display: flex;",
    "      align-items: center;",
    "      justify-content: space-between;",
    "      gap: 20px;",
    "      margin-bottom: 24px;",
    "      color: var(--muted);",
    "      font-size: 13px;",
    "    }",
    "    .brand-wrap { display: grid; gap: 2px; }",
    "    .brand-line { display: inline-flex; align-items: center; gap: 12px; }",
    "    .brand-mark { width: 42px; height: 42px; display: block; flex: 0 0 auto; filter: drop-shadow(0 8px 18px rgba(255, 208, 0, 0.14)); }",
    "    .brand { color: var(--gold); font-size: 30px; font-weight: 900; letter-spacing: -0.05em; }",
    "    .byline { color: var(--muted); font-size: 13px; }",
    "    .byline a { color: var(--gold); text-decoration: none; }",
    "    .byline a:hover, .nav-links a:hover { text-decoration: underline; }",
    "    .nav-links { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }",
    "    .nav-links a { color: var(--muted); text-decoration: none; }",
    "    .tg-link {",
    "      display: inline-grid;",
    "      place-items: center;",
    "      width: 32px;",
    "      height: 32px;",
    "      border: 1px solid var(--line);",
    "      border-radius: 999px;",
    "      background: rgba(255, 208, 0, 0.08);",
    "      color: var(--gold);",
    "    }",
    "    .tg-link svg { width: 16px; height: 16px; display: block; }",
    "    .hero {",
    "      width: 100%;",
    "      border: 2px solid var(--gold);",
    "      border-radius: 22px;",
    "      background: linear-gradient(145deg, rgba(32, 32, 32, 0.98), rgba(18, 18, 18, 0.96));",
    "      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.44), 0 0 0 8px rgba(255, 208, 0, 0.05);",
    "      padding: clamp(24px, 4vw, 54px);",
    "      position: relative;",
    "      overflow: hidden;",
    "    }",
    "    .hero::after {",
    "      content: '';",
    "      position: absolute;",
    "      right: -80px;",
    "      top: -80px;",
    "      width: 220px;",
    "      height: 220px;",
    "      border-radius: 999px;",
    "      background: var(--soft);",
    "      border: 1px solid var(--line);",
    "    }",
    "    .eyebrow {",
    "      display: inline-flex;",
    "      gap: 10px;",
    "      align-items: center;",
    "      padding: 8px 12px;",
    "      border: 1px solid var(--gold);",
    "      border-radius: 999px;",
    "      background: rgba(255, 208, 0, 0.08);",
    "      color: var(--gold);",
    "      font: 800 12px/1.2 Verdana, sans-serif;",
    "      letter-spacing: 0.12em;",
    "      text-transform: uppercase;",
    "    }",
    "    .hero-grid {",
    "      display: grid;",
    "      grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.1fr);",
    "      gap: clamp(28px, 5vw, 64px);",
    "      align-items: center;",
    "      position: relative;",
    "      z-index: 1;",
    "    }",
    "    h1 {",
    "      max-width: 680px;",
    "      margin: 26px 0 16px;",
    "      color: #fff6c8;",
    "      font-size: clamp(50px, 7vw, 102px);",
    "      line-height: 0.88;",
    "      letter-spacing: -0.08em;",
    "    }",
    "    .lead {",
    "      max-width: 660px;",
    "      margin: 0;",
    "      color: #c9c1a5;",
    "      font: 18px/1.55 Verdana, sans-serif;",
    "    }",
    "    .shot {",
    "      margin: 0;",
    "      border: 1px solid var(--line);",
    "      border-radius: 18px;",
    "      background: #0f0f0f;",
    "      padding: 10px;",
    "      box-shadow: 18px 18px 0 rgba(255, 208, 0, 0.08);",
    "      transform: rotate(1deg);",
    "    }",
    "    .shot img {",
    "      display: block;",
    "      width: 100%;",
    "      border-radius: 10px;",
    "      border: 1px solid rgba(255, 255, 255, 0.08);",
    "    }",
    "    .install {",
    "      display: grid;",
    "      grid-template-columns: 1fr;",
    "      gap: 18px;",
    "      align-items: start;",
    "      margin-top: 34px;",
    "      max-width: 560px;",
    "    }",
    "    .bookmarklet {",
    "      display: inline-flex;",
    "      align-items: center;",
    "      justify-content: center;",
    "      min-height: 74px;",
    "      padding: 0 28px;",
    "      border: 3px solid #050505;",
    "      border-radius: 14px;",
    "      color: #111;",
    "      background: linear-gradient(135deg, var(--gold), var(--gold-2));",
    "      box-shadow: 8px 8px 0 #050505;",
    "      text-decoration: none;",
    "      font: 900 24px/1 Verdana, sans-serif;",
    "      cursor: pointer;",
    "      user-select: none;",
    "      transform: rotate(-1.2deg);",
    "      transition: transform 160ms ease, box-shadow 160ms ease;",
    "    }",
    "    .bookmarklet:hover { transform: rotate(0deg) translate(-2px, -2px); box-shadow: 11px 11px 0 #050505; }",
    "    .install .bookmarklet { width: min(320px, 100%); }",
    "    .hint {",
    "      margin: 0;",
    "      color: var(--muted);",
    "      font: 15px/1.6 Verdana, sans-serif;",
    "    }",
    "    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }",
    "    button:not(.bookmarklet) {",
      "      border: 1px solid var(--line);",
      "      border-radius: 999px;",
      "      background: rgba(255, 208, 0, 0.08);",
      "      color: var(--gold);",
    "      padding: 12px 16px;",
    "      font: 700 14px/1 Verdana, sans-serif;",
    "      cursor: pointer;",
    "    }",
    "    code {",
    "      display: inline-block;",
    "      margin-top: 22px;",
    "      color: #4f472f;",
    "      font: 13px/1.4 Consolas, monospace;",
    "      word-break: break-word;",
    "    }",
    "    .section { margin-top: 28px; }",
    "    .cards {",
    "      display: grid;",
    "      grid-template-columns: repeat(3, minmax(0, 1fr));",
    "      gap: 14px;",
    "    }",
    "    .card {",
    "      min-height: 154px;",
    "      border: 1px solid rgba(255, 208, 0, 0.25);",
    "      border-radius: 18px;",
    "      background: rgba(32, 32, 32, 0.82);",
    "      padding: 20px;",
    "    }",
    "    .card strong { display: block; color: var(--gold); font-size: 18px; margin-bottom: 10px; }",
    "    .card p { margin: 0; color: #c9c1a5; font: 14px/1.55 Verdana, sans-serif; }",
    "    .steps {",
    "      display: grid;",
    "      grid-template-columns: repeat(3, 1fr);",
    "      gap: 1px;",
    "      overflow: hidden;",
    "      border: 1px solid rgba(255, 208, 0, 0.25);",
    "      border-radius: 18px;",
    "      background: rgba(255, 208, 0, 0.25);",
    "    }",
    "    .step { background: #1d1d1d; padding: 18px; color: #d7cfb3; font: 14px/1.55 Verdana, sans-serif; }",
    "    .step b { color: var(--gold); display: block; margin-bottom: 8px; }",
    "    .footer { margin-top: 22px; color: var(--muted); font: 13px/1.5 Verdana, sans-serif; }",
    "    @media (max-width: 760px) {",
    "      .hero-grid { grid-template-columns: 1fr; }",
    "      .cards, .steps { grid-template-columns: 1fr; }",
    "      .install { grid-template-columns: 1fr; }",
    "      .bookmarklet { width: 100%; }",
    "      .shot { transform: none; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <nav class=\"nav\">",
    "      <div class=\"brand-wrap\">",
    `        <div class="brand-line"><span class="brand-mark">${inlineMark}</span><div class="brand">${escapeHtml(displayName)}</div></div>`,
    "        <div class=\"byline\">by <a href=\"https://yellowweb.top\" target=\"_blank\" rel=\"noopener\">Yellow Web</a></div>",
    "      </div>",
    "      <div class=\"nav-links\"><a href=\"#install\">Install</a><a href=\"#features\">Features</a><a href=\"#how\">How it works</a><a class=\"tg-link\" href=\"https://t.me/yellow_web\" target=\"_blank\" rel=\"noopener\" aria-label=\"Yellow Web Telegram\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M21.8 4.6 18.6 19.7c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.2 1.1 11.7c-1.1-.3-1.1-1.1.2-1.6L20.5 2.7c.9-.3 1.7.2 1.3 1.9Z\"/></svg></a></div>",
    "    </nav>",
    "    <section class=\"hero\" id=\"install\">",
    "      <div class=\"hero-grid\">",
    "        <div>",
    `          <div class="eyebrow">${escapeHtml(displayName)} build ${escapeHtml(build)}</div>`,
    "          <h1>Account-level targeting controls across all your ad accounts.</h1>",
    "          <p class=\"lead\">FB Targeting Manager is a browser-side tool that lists every ad account, shows where age, geo and placement restrictions are already set, and applies the ones you pick to one or many accounts at once.</p>",
    "          <div class=\"install\">",
    `            <a class="bookmarklet" id="bookmarkletLink" href="${escapeHtml(bookmarklet)}">Targeting</a>`,
    "            <p class=\"hint\">Drag the yellow button to your bookmarks bar. If dragging is awkward in your browser, use the copy button below and paste the loader into a bookmark URL manually.</p>",
    "          </div>",
    "          <div class=\"actions\">",
    `            <button id="copyBookmarklet" type="button" data-bookmarklet="${escapeHtml(bookmarklet)}">Copy to clipboard</button>`,
    "            <button id=\"copyUrl\" type=\"button\">Copy page URL</button>",
    "          </div>",
    `          <code>manifest URL: ${escapeHtml(manifestUrl || "not configured")}</code>`,
    "        </div>",
    "        <figure class=\"shot\">",
    `          <img src="${escapeHtml(screenshotUrl)}" alt="FBTargetingManager running inside Facebook Ads Manager" />`,
    "        </figure>",
    "      </div>",
    "    </section>",
    "    <section class=\"section cards\" id=\"features\">",
    "      <div class=\"card\"><strong>All accounts</strong><p>Loads every ad account and shows whether age, geo or placement restrictions are already set.</p></div>",
    "      <div class=\"card\"><strong>Placements</strong><p>Exclude or allow Audience Network, Marketplace and the right column per account.</p></div>",
    "      <div class=\"card\"><strong>Age and geo</strong><p>Set a minimum age and a country include list, or clear them, at the account level.</p></div>",
    "      <div class=\"card\"><strong>Bulk apply</strong><p>Select all or any accounts and write the changes in batches through Ads Manager Graph.</p></div>",
    "      <div class=\"card\"><strong>Tri-state editor</strong><p>Every field is keep, set or clear, so untouched settings are never overwritten.</p></div>",
    "      <div class=\"card\"><strong>Browser-side</strong><p>Runs inside the current Facebook session and does not require a separate backend.</p></div>",
    "      <div class=\"card\"><strong>Versioned loader</strong><p>The bookmarklet carries build metadata, verifies payload SHA-256, and caches the latest payload locally.</p></div>",
    "    </section>",
    "    <section class=\"section steps\" id=\"how\">",
    "      <div class=\"step\"><b>1. Install</b>Drag the Targeting button to your bookmarks bar, or use Copy to clipboard and paste the loader into a bookmark URL.</div>",
    "      <div class=\"step\"><b>2. Open Ads Manager</b>Use the Facebook profile you want to work with, then click the bookmark.</div>",
    "      <div class=\"step\"><b>3. Manage targeting</b>The loader checks the versioned payload, uses cache when current, and opens the FB Targeting Manager panel in-page.</div>",
    "    </section>",
    "    <p class=\"footer\">by <a href=\"https://yellowweb.top\" target=\"_blank\" rel=\"noopener\">Yellow Web</a> · <a href=\"https://t.me/yellow_web\" target=\"_blank\" rel=\"noopener\">Telegram</a>. The tool runs in your current Facebook Ads Manager session. No external direct payload fetch is attempted from Ads Manager; runtime loading uses Facebook OG metadata through Ads Manager Graph.</p>",
    "  </main>",
    "  <script>",
    "    window.setStatus = function(message) {",
    "      var hint = document.querySelector('.hint');",
    "      if (hint) hint.textContent = message;",
    "    };",
    "    document.getElementById('copyBookmarklet').addEventListener('click', async function() {",
    "      try {",
    "        await navigator.clipboard.writeText(document.getElementById('copyBookmarklet').dataset.bookmarklet || '');",
    "        window.setStatus('Bookmarklet copied. Create a new bookmark and paste it into the URL field.');",
    "      } catch (error) {",
    "        window.setStatus('Copy failed. Try again from a secure browser tab with clipboard access enabled.');",
    "      }",
    "    });",
    "    document.getElementById('copyUrl').addEventListener('click', async function() {",
    "      await navigator.clipboard.writeText(location.href);",
    "      window.setStatus('Page URL copied.');",
    "    });",
    "  </script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildBookmarkletLoader(loaderManifest) {
  const loaderSource = fs.readFileSync(LOADER_SOURCE, "utf8").trim();
  const configJson = JSON.stringify({
    app: loaderManifest.app,
    manifestUrl: loaderManifest.latestManifestUrl,
    cacheKey: "fbtargetingmanager.loader.cache.v1",
  });
  return `${loaderSource.replace(/\)\(\);?\s*$/, `)(${configJson});`)}`;
}

function main() {
  const sourcePath = path.resolve(readArg("source", SOURCE));
  const outRoot = path.resolve(readArg("out", OUT_ROOT));
  const distRoot = path.dirname(outRoot);
  const baseUrl = readArg("base-url", "");
  const appName = readArg("app", "FBTargetingManager");
  const displayName = "FB Targeting Manager";
  const chunkOgObjectIds = parseListArg("chunk-og-object-ids");
  const source = fs.readFileSync(sourcePath, "utf8");
  const build = readArg("build", detectBuild(source));
  const buildDir = path.join(outRoot, build);
  const latestDir = path.join(outRoot, "latest");
  const ogDir = path.join(buildDir, "og");
  const latestOgDir = path.join(latestDir, "og");
  const base64 = Buffer.from(source, "utf8").toString("base64");
  const chunks = splitString(base64, CHUNK_SIZE);
  const generatedAt = new Date().toISOString();

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(latestDir, { recursive: true, force: true });
  writeFile(path.join(buildDir, "payload.js"), source);
  writeFile(path.join(latestDir, "payload.js"), source);
  chunks.forEach((chunk, index) => {
    const chunkFileName = `chunk-${String(index + 1).padStart(3, "0")}.html`;
    const html = buildOgHtml({
      appName,
      build,
      chunk,
      index,
      total: chunks.length,
    });
    writeFile(path.join(ogDir, chunkFileName), html);
    writeFile(path.join(latestOgDir, chunkFileName), html);
  });

  const publicUrl = (relativePath) => {
    if (!baseUrl) return "";
    return `${baseUrl.replace(/\/+$/, "")}/${relativePath.replace(/\\/g, "/")}`;
  };
  const manifest = {
    app: appName,
    build,
    version: build,
    generatedAt,
    payload: {
      encoding: "base64",
      sha256: sha256Hex(source),
      byteLength: Buffer.byteLength(source, "utf8"),
    },
    chunks: chunks.map((chunk, index) => ({
      index: index + 1,
      file: `og/chunk-${String(index + 1).padStart(3, "0")}.html`,
      url: publicUrl(`${build}/og/chunk-${String(index + 1).padStart(3, "0")}.html`),
      latestUrl: publicUrl(`latest/og/chunk-${String(index + 1).padStart(3, "0")}.html`),
      ogObjectId: chunkOgObjectIds[index] || "",
      base64Length: chunk.length,
      base64Sha256: sha256Hex(chunk),
    })),
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestBase64 = Buffer.from(manifestJson, "utf8").toString("base64");
  const manifestHtml = buildManifestHtml({ appName, build, manifestBase64 });
  writeFile(path.join(buildDir, "manifest.html"), manifestHtml);
  writeFile(path.join(latestDir, "manifest.html"), manifestHtml);

  const packageInfo = {
    ...manifest,
    source: path.relative(ROOT, sourcePath).replace(/\\/g, "/"),
    chunkSize: CHUNK_SIZE,
    payloadFile: "payload.js",
    manifestFile: "manifest.html",
    manifestUrl: publicUrl(`${build}/manifest.html`),
    latestManifestUrl: publicUrl("latest/manifest.html"),
  };
  writeFile(path.join(buildDir, "package-info.json"), `${JSON.stringify(packageInfo, null, 2)}\n`);
  writeFile(path.join(latestDir, "package-info.json"), `${JSON.stringify(packageInfo, null, 2)}\n`);
  const loaderManifest = {
    app: appName,
    build,
    version: build,
    generatedAt,
    payload: manifest.payload,
    latestManifestUrl: packageInfo.latestManifestUrl,
    chunks: manifest.chunks.map((chunk) => ({
      index: chunk.index,
      latestUrl: chunk.url,
      url: chunk.url,
      ogObjectId: chunk.ogObjectId,
    })),
  };
  const loaderSource = buildBookmarkletLoader(loaderManifest);
  const bookmarklet = `javascript:${encodeURIComponent(loaderSource)}`;
  const toolMeta = {
    app: appName,
    title: displayName,
    shortName: "Targeting",
    description: "Account-level age, geo and placement restrictions across all ad accounts, applied in bulk from a single panel.",
    build,
    version: build,
    landingUrl: "https://fbtargetingmanager.pages.dev/",
    sourceUrl: "https://github.com/dvygolov/FBTargetingManager",
    bookmarkletHref: bookmarklet,
    latestManifestUrl: packageInfo.latestManifestUrl,
    generatedAt,
  };
  writeFile(path.join(latestDir, "tool-meta.json"), `${JSON.stringify(toolMeta, null, 2)}\n`);
  const screenshotUrl = fs.existsSync(LANDING_SCREENSHOT) ? "assets/targeting-ui.png" : APP_MARK_FILE;
  const iconUrl = APP_MARK_FILE;
  if (fs.existsSync(LANDING_SCREENSHOT)) {
    fs.mkdirSync(path.join(distRoot, "assets"), { recursive: true });
    fs.copyFileSync(LANDING_SCREENSHOT, path.join(distRoot, screenshotUrl));
  }
  writeFile(path.join(distRoot, APP_MARK_FILE), `${buildAppMarkSvg()}\n`);
  writeFile(path.join(distRoot, "index.html"), buildLandingHtml({
    appName,
    displayName,
    build,
    bookmarklet,
    manifestUrl: publicUrl("latest/manifest.html"),
    screenshotUrl,
    iconUrl,
  }));
  writeFile(path.join(distRoot, "_headers"), [
    "/",
    "  Cache-Control: no-store",
    "",
    "/*",
    "  Cache-Control: no-store",
    "",
    "/targeting/*",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: no-store",
    "",
  ].join("\n"));
  writeFile(path.join(distRoot, "_redirects"), [
    "/ /index.html 200",
    "/* /index.html 200",
    "",
  ].join("\n"));
  pruneOldBuildDirs(outRoot, build);

  console.log(`FBTargetingManager ${build} packaged.`);
  console.log(`Payload: ${path.join(buildDir, "payload.js")}`);
  console.log(`Latest payload: ${path.join(latestDir, "payload.js")}`);
  console.log(`OG chunks: ${chunks.length}`);
  if (baseUrl) {
    console.log(`Manifest latest URL: ${packageInfo.latestManifestUrl}`);
    console.log("Scrape the stable latest manifest and OG chunk URLs after deploy:");
    console.log(`- ${packageInfo.latestManifestUrl}`);
    for (const chunk of packageInfo.chunks) {
      console.log(`- ${chunk.latestUrl}`);
    }
  }
}

main();
