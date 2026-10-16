/* FB Targeting Manager — UI-оверлей для Ads Manager. by Yellow Web (https://yellowweb.top/)
 *
 * Что делает:
 *   - тянет все доступные кабинеты (me/adaccounts);
 *   - пачкой читает account_controls каждого кабинета (Batch API);
 *   - показывает таблицу: возраст / гео / плейсменты, где ограничения уже стоят;
 *   - даёт выбрать все или часть кабинетов и применить ограничения тристейтом
 *     (не трогать / поставить / снять).
 *
 * Как запустить:
 *   1. Открыть любую страницу adsmanager.facebook.com (залогиненным).
 *   2. F12 -> Console, вставить весь файл, Enter.
 *   Токен берётся из runtime страницы. Ничего не устанавливается, работает до перезагрузки.
 */
(() => {
  "use strict";
  const V = "v22.0";
  const GRAPH = "https://graph.facebook.com/" + V;
  const Config = { APP: "FBTargetingManager", VERSION: "161026b4" }; // VERSION = ДДММГГbN

  const PLACEMENTS = [
    { id: "audience_network_classic", code: "AN", name: "Audience Network native, banner, interstitial" },
    { id: "audience_network_rewarded_video", code: "AN-R", name: "Audience Network rewarded videos" },
    { id: "facebook_marketplace", code: "MP", name: "Facebook Marketplace" },
    { id: "facebook_right_hand_column", code: "RHC", name: "Facebook right column" },
  ];

  const STATUS = {
    1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_REVIEW",
    9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED",
  };

  const I18N = {
    ru: {
      title: "Рекламные кабинеты · Account controls",
      search: "Поиск по названию или ID",
      refresh: "Обновить",
      edit: "Редактировать выбранные",
      apply: "Применить к выбранным",
      account: "Кабинет",
      age: "Возраст",
      geo: "Гео",
      placements: "Плейсменты",
      settings: "Настройки ограничений",
      keep: "не трогать",
      set: "поставить",
      clear: "снять",
      worldwide: "весь мир",
      setCountries: "поставить страны",
      geoPlaceholder: "US,GB,DE",
      exclude: "исключить",
      allow: "разрешить",
      loading: "загрузка…",
      applying: "Применяю…",
      reading: "Читаю ограничения",
      loadingAccounts: "Загружаю кабинеты…",
      done: "Готово",
      success: "успешно",
      errors: "ошибок",
      reloading: "Перечитываю состояние…",
      updated: "Состояние обновлено.",
      noSel: "Отметь хотя бы один кабинет.",
      noAcc: "Кабинетов не найдено.",
      errLoad: "Ошибка загрузки",
      clickCycle: "клик:",
    },
    en: {
      title: "Ad accounts · Account controls",
      search: "Search by name or ID",
      refresh: "Refresh",
      edit: "Edit selected",
      apply: "Apply to selected",
      account: "Account",
      age: "Age",
      geo: "Geo",
      placements: "Placements",
      settings: "Restriction settings",
      keep: "keep",
      set: "set",
      clear: "clear",
      worldwide: "worldwide",
      setCountries: "set countries",
      geoPlaceholder: "US,GB,DE",
      exclude: "exclude",
      allow: "allow",
      loading: "loading…",
      applying: "Applying…",
      reading: "Reading restrictions",
      loadingAccounts: "Loading accounts…",
      done: "Done",
      success: "ok",
      errors: "errors",
      reloading: "Re-reading state…",
      updated: "State updated.",
      noSel: "Select at least one account.",
      noAcc: "No accounts found.",
      errLoad: "Load error",
      clickCycle: "click:",
    },
  };

  const S = {
    token: null,
    lang: (function () { try { return localStorage.getItem("fbac_lang") || "ru"; } catch { return "ru"; } })() ,
    accounts: [],
    controls: {},
    selected: new Set(),
    query: "",
    busy: false,
  };

  const t = (k) => (I18N[S.lang] && I18N[S.lang][k]) || k;

  // ---------------- token + api ----------------

  function getToken() {
    if (window.__accessToken) return window.__accessToken;
    const urls = performance.getEntriesByType("resource").map((r) => r.name);
    for (const u of urls) {
      const m = /access_token=([^&]+)/.exec(u);
      if (m) return decodeURIComponent(m[1]);
    }
    throw new Error("access_token not found. Open Ads Manager, refresh and retry.");
  }

  async function batch(requests) {
    const url = GRAPH + "/?batch=" + encodeURIComponent(JSON.stringify(requests)) +
      "&access_token=" + encodeURIComponent(S.token);
    const r = await fetch(url, { method: "POST", credentials: "include" });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { throw new Error("Batch response is not JSON: " + txt.slice(0, 200)); }
  }

  async function loadAccounts() {
    let url = GRAPH + "/me/adaccounts?fields=account_id,name,account_status&limit=200&access_token=" +
      encodeURIComponent(S.token);
    const all = [];
    let guard = 0;
    while (url && guard++ < 100) {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "Graph error");
      all.push(...(j.data || []));
      url = j.paging && j.paging.next;
    }
    return all;
  }

  function normalize(s) {
    s = s || {};
    const ac = s.audience_controls || null;
    return {
      exclusions: (s.placement_controls && s.placement_controls.placement_exclusions) || [],
      ageMin: (s.is_age_restriction_enabled && ac && ac.age_min) || null,
      ageEnabled: !!s.is_age_restriction_enabled,
      genderEnabled: !!s.is_gender_exclusion_enabled,
      geo: (ac && ac.geo_locations) || null,
      audienceControls: ac,
      raw: s,
    };
  }

  async function loadControls(accounts, onProgress) {
    const out = {};
    for (let i = 0; i < accounts.length; i += 50) {
      const chunk = accounts.slice(i, i + 50);
      const items = chunk.map((a) => ({ method: "GET", relative_url: a.id + "/account_controls" }));
      const res = await batch(items);
      const list = Array.isArray(res) ? res : [];
      chunk.forEach((a, idx) => {
        let data = [];
        try { data = (JSON.parse((list[idx] || {}).body || "{}").data) || []; } catch { data = []; }
        out[a.id] = normalize(data[0]);
      });
      if (onProgress) onProgress(Math.min(i + 50, accounts.length), accounts.length);
    }
    return out;
  }

  // ---------------- merge + write ----------------

  function buildBody(cur, ops) {
    const ac = Object.assign({}, (cur && cur.audienceControls) || {});
    if (ac.geo_locations == null) ac.geo_locations = { country_groups: ["worldwide"], location_types: ["home", "recent"] };

    let ageEnabled;
    if (ops.age.mode === "set") { ac.age_min = Number(ops.age.value); ageEnabled = true; }
    else if (ops.age.mode === "clear") { delete ac.age_min; ageEnabled = false; }
    else { ageEnabled = !!(cur && cur.ageEnabled); if (!ageEnabled) delete ac.age_min; }

    if (ops.geo.mode === "set") {
      ac.geo_locations = { countries: ops.geo.countries, location_types: ["home", "recent"] };
    } else if (ops.geo.mode === "worldwide" || ops.geo.mode === "clear") {
      ac.geo_locations = { country_groups: ["worldwide"], location_types: ["home", "recent"] };
    }

    const ex = new Set((cur && cur.exclusions) || []);
    for (const p of PLACEMENTS) {
      const op = ops.placements[p.id];
      if (op === "exclude") ex.add(p.id);
      if (op === "allow") ex.delete(p.id);
    }

    const genderEnabled = !!(cur && cur.genderEnabled);

    return {
      placement_controls: JSON.stringify({ placement_exclusions: Array.from(ex) }),
      audience_controls: JSON.stringify(ac),
      is_age_restriction_enabled: String(ageEnabled),
      is_gender_exclusion_enabled: String(genderEnabled),
    };
  }

  async function applyOps(ops, targets) {
    const results = [];
    for (let i = 0; i < targets.length; i += 50) {
      const chunk = targets.slice(i, i + 50);
      const items = chunk.map((a) => ({
        method: "POST",
        relative_url: a.id + "/account_controls",
        body: new URLSearchParams(buildBody(S.controls[a.id], ops)).toString(),
      }));
      const res = await batch(items);
      const list = Array.isArray(res) ? res : [];
      chunk.forEach((a, idx) => {
        const item = list[idx] || {};
        let payload = {};
        try { payload = JSON.parse(item.body || "{}"); } catch { payload = {}; }
        results.push({ id: a.id, name: a.name, code: item.code, ok: item.code === 200 && payload.success === true, error: payload.error });
      });
      renderTable();
    }
    return results;
  }

  // ---------------- UI ----------------

  const css = `
  .fbac-overlay{position:fixed;inset:0;background:rgba(10,12,18,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1e21}
  .fbac-panel{width:min(680px,96vw);max-height:92vh;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45)}
  .fbac-head{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #e4e6eb}
  .fbac-brand{display:flex;flex-direction:column;line-height:1.15}
  .fbac-brand h2{margin:0;font-size:15px;font-weight:700}
  .fbac-by{font-size:11px;color:#8a8d91;text-decoration:none}
  .fbac-by:hover{color:#1877f2;text-decoration:underline}
  .fbac-ver{font-size:10.5px;color:#b0b3b8}
  .fbac-head .fbac-spacer{flex:1}
  .fbac-langs{display:flex;border:1px solid #ccd0d5;border-radius:7px;overflow:hidden}
  .fbac-langs button{border:0;background:#fff;padding:3px 9px;cursor:pointer;font-size:11px;font-weight:600;color:#65676b}
  .fbac-langs button.on{background:#1877f2;color:#fff}
  .fbac-x{border:0;background:#f0f2f5;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:15px;line-height:28px;text-align:center}
  .fbac-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #e4e6eb}
  .fbac-bar input[type=search]{flex:1;padding:6px 10px;border:1px solid #ccd0d5;border-radius:8px;outline:none;font-size:12.5px}
  .fbac-iconbtn{width:32px;height:32px;border:1px solid #ccd0d5;background:#fff;border-radius:8px;cursor:pointer;font-size:15px;line-height:1;color:#444}
  .fbac-iconbtn:hover{background:#f0f2f5}
  .fbac-editbtn{padding:7px 12px;border:0;border-radius:8px;background:#1877f2;color:#fff;font-weight:600;cursor:pointer;font-size:12.5px}
  .fbac-editbtn.on{background:#1c2b3a}
  .fbac-scroll{overflow:auto;flex:1;min-height:0}
  table.fbac{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}
  table.fbac th,table.fbac td{padding:7px 8px;border-bottom:1px solid #eef0f3;text-align:left;vertical-align:middle;overflow:hidden}
  table.fbac th{position:sticky;top:0;background:#f5f6f7;z-index:1;font-weight:600;white-space:nowrap}
  table.fbac tr:hover td{background:#f7f9fc}
  .fbac-acc{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fbac-id{color:#8a8d91;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fbac-tag{display:inline-block;padding:1px 7px;border-radius:20px;background:#e7f0fe;color:#1877f2;font-size:11px;white-space:nowrap}
  .fbac-none{color:#bcc0c4}
  .fbac-pl{display:inline-block;min-width:20px;text-align:center;padding:2px 6px;margin:0 2px 0 0;border-radius:6px;font-size:10.5px;font-weight:700;background:#e7f0fe;color:#1877f2;cursor:default}
  .fbac-edit{border-top:1px solid #e4e6eb;background:#fafbfc;padding:10px 14px}
  .fbac-edithead{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .fbac-edithead b{font-size:13px}
  .fbac-edithead .fbac-spacer{flex:1}
  .fbac-grid{display:grid;grid-template-columns:96px 1fr;gap:8px 12px;align-items:center}
  .fbac-grid select,.fbac-grid input[type=text],.fbac-grid input[type=number]{padding:5px 7px;border:1px solid #ccd0d5;border-radius:7px;font-size:12.5px}
  .fbac-chips{display:flex;gap:6px;flex-wrap:wrap}
  .fbac-chip{width:44px;height:28px;border:1px solid #ccd0d5;border-radius:7px;background:#fff;cursor:pointer;font-size:11px;font-weight:700;color:#65676b}
  .fbac-chip.exclude{background:#fde8e8;border-color:#f0b4b4;color:#c0392b}
  .fbac-chip.allow{background:#e7f6ec;border-color:#a9d9b8;color:#1a7f37}
  .fbac-log{margin-top:8px;font-size:11.5px;max-height:96px;overflow:auto;white-space:pre-wrap;color:#444}
  .fbac-log .ok{color:#1a7f37}
  .fbac-log .err{color:#c0392b}
  `;

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach((c) => el.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return el;
  }

  let root, tbody, editWrap, logEl, headCheck, accHead, editBtn, titleEl, searchEl, refreshBtn;

  function geoText(g) {
    if (!g) return null;
    if (g.country_groups && g.country_groups.indexOf("worldwide") >= 0) return null;
    if (g.countries && g.countries.length) return g.countries.join(", ");
    if (g.country_groups && g.country_groups.length) return g.country_groups.join(", ");
    return "…";
  }

  function plByCode() {
    const map = {};
    PLACEMENTS.forEach((p) => { map[p.id] = p; });
    return map;
  }

  function rowNode(a) {
    const c = S.controls[a.id];
    const plMap = plByCode();
    const age = c && c.ageEnabled && c.ageMin ? c.ageMin + "+" : null;
    const geo = c ? geoText(c.geo) : null;
    const ex = (c && c.exclusions) || [];

    const ageEl = age ? h("span", { class: "fbac-tag" }, [age]) : h("span", { class: "fbac-none" }, ["—"]);
    const geoEl = geo ? h("span", { class: "fbac-tag" }, [geo]) : h("span", { class: "fbac-none" }, ["—"]);
    let plEl;
    if (c == null) plEl = h("span", { class: "fbac-none" }, [t("loading")]);
    else if (!ex.length) plEl = h("span", { class: "fbac-none" }, ["—"]);
    else plEl = h("span", {}, ex.map((id) => {
      const p = plMap[id];
      return h("span", { class: "fbac-pl", title: (p ? p.name : id) + " — " + t("exclude") }, [p ? p.code : id]);
    }));

    const tr = h("tr", {}, [
      h("td", {}, [h("input", { type: "checkbox", checked: S.selected.has(a.id) ? "checked" : null,
        onchange: (e) => { e.target.checked ? S.selected.add(a.id) : S.selected.delete(a.id); syncHeadCheck(); } })]),
      h("td", {}, [
        h("div", { class: "fbac-acc" }, [a.name || "(—)"]),
        h("div", { class: "fbac-id" }, [a.id + " · " + (STATUS[a.account_status] || a.account_status || "?")]),
      ]),
      h("td", {}, [ageEl]),
      h("td", {}, [geoEl]),
      h("td", {}, [plEl]),
    ]);
    return tr;
  }

  function visibleAccounts() {
    const q = S.query.trim().toLowerCase();
    if (!q) return S.accounts;
    return S.accounts.filter((a) => (a.name || "").toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }

  function syncHeadCheck() {
    if (!headCheck) return;
    const list = visibleAccounts();
    const sel = list.filter((a) => S.selected.has(a.id)).length;
    headCheck.checked = list.length > 0 && sel === list.length;
    headCheck.indeterminate = sel > 0 && sel < list.length;
    if (editBtn) editBtn.textContent = t("edit") + " (" + S.selected.size + ")";
    if (accHead) {
      const total = S.accounts.length;
      accHead.textContent = t("account") + " · " + (S.selected.size > 0 ? (S.selected.size + "/" + total) : total);
    }
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = "";
    const list = visibleAccounts();
    if (!list.length) {
      tbody.appendChild(h("tr", {}, [h("td", { colspan: "5", class: "fbac-none" }, [S.accounts.length ? t("noAcc") : t("loadingAccounts")])]));
      syncHeadCheck();
      return;
    }
    list.forEach((a) => tbody.appendChild(rowNode(a)));
    syncHeadCheck();
  }

  function render() { renderTable(); }

  function selectOptions(options, value) {
    return h("select", {}, options.map((o) => h("option", { value: o[0], selected: o[0] === value ? "selected" : null }, [o[1]])));
  }

  // placements chips: keep -> exclude -> allow -> keep
  const PL_STATE = ["keep", "exclude", "allow"];

  function collectOps() {
    const ageMode = editWrap.querySelector("[data-age-mode]").value;
    const ageVal = editWrap.querySelector("[data-age-val]").value;
    const geoMode = editWrap.querySelector("[data-geo-mode]").value;
    const geoVal = editWrap.querySelector("[data-geo-val]").value;
    const placements = {};
    PLACEMENTS.forEach((p) => {
      placements[p.id] = editWrap.querySelector('[data-pl="' + p.id + '"]').getAttribute("data-state");
    });
    const countries = geoVal.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    return {
      age: { mode: ageMode, value: ageVal },
      geo: { mode: geoMode, countries },
      placements,
    };
  }

  function buildEdit() {
    editWrap.innerHTML = "";

    const applyBtn = h("button", { class: "fbac-editbtn", onclick: () => doApply() }, [t("apply")]);
    const head = h("div", { class: "fbac-edithead" }, [
      h("b", {}, [t("settings")]),
      h("span", { class: "fbac-spacer" }),
      applyBtn,
    ]);
    editWrap.appendChild(head);

    const grid = h("div", { class: "fbac-grid" });
    const add = (label, node) => {
      grid.appendChild(h("div", {}, [h("b", {}, [label])]));
      grid.appendChild(h("div", {}, [node]));
    };

    const ageSel = selectOptions([["keep", t("keep")], ["set", t("set")], ["clear", t("clear")]], "keep");
    ageSel.setAttribute("data-age-mode", "1");
    const ageVal = h("input", { type: "number", min: "18", max: "65", value: "18", style: "width:72px" });
    ageVal.setAttribute("data-age-val", "1");
    add(t("age"), h("span", {}, [ageSel, " ", ageVal]));

    const geoSel = selectOptions([["keep", t("keep")], ["set", t("setCountries")], ["worldwide", t("worldwide")], ["clear", t("clear")]], "keep");
    geoSel.setAttribute("data-geo-mode", "1");
    const geoVal = h("input", { type: "text", placeholder: t("geoPlaceholder"), style: "width:150px" });
    geoVal.setAttribute("data-geo-val", "1");
    add(t("geo"), h("span", {}, [geoSel, " ", geoVal]));

    const chips = h("div", { class: "fbac-chips" });
    PLACEMENTS.forEach((p) => {
      const chip = h("button", { class: "fbac-chip", "data-state": "keep", "data-pl": p.id, title: p.name + " — " + t("keep") }, [p.code]);
      chip.addEventListener("click", () => {
        const cur = chip.getAttribute("data-state");
        const next = PL_STATE[(PL_STATE.indexOf(cur) + 1) % PL_STATE.length];
        chip.setAttribute("data-state", next);
        chip.className = "fbac-chip" + (next === "keep" ? "" : " " + next);
        chip.title = p.name + " — " + t(next);
      });
      chips.appendChild(chip);
    });
    add(t("placements"), chips);

    editWrap.appendChild(grid);
    logEl = h("div", { class: "fbac-log" });
    editWrap.appendChild(logEl);
  }

  async function doApply() {
    if (S.busy) return;
    const targets = S.accounts.filter((a) => S.selected.has(a.id));
    if (!targets.length) { log(t("noSel"), "err"); return; }
    const ops = collectOps();
    S.busy = true;
    logEl.textContent = "";
    log(t("applying") + " " + targets.length + "…");
    try {
      const results = await applyOps(ops, targets);
      let ok = 0, fail = 0;
      results.forEach((r) => {
        if (r.ok) { ok++; log("✓ " + (r.name || r.id), "ok"); }
        else { fail++; log("✗ " + (r.name || r.id) + " — " + (r.error ? (r.error.message || JSON.stringify(r.error)) : ("code " + r.code)), "err"); }
      });
      log(t("done") + ": " + t("success") + " " + ok + ", " + t("errors") + " " + fail + ". " + t("reloading"));
      const fresh = await loadControls(targets);
      Object.assign(S.controls, fresh);
      renderTable();
      log(t("updated"));
    } catch (e) {
      log("✗ " + e.message, "err");
    } finally {
      S.busy = false;
    }
  }

  function log(text, cls) {
    if (!logEl) return;
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function refresh(keepSelection) {
    try {
      tbody && (tbody.innerHTML = "");
      editBtn && editBtn.setAttribute("disabled", "disabled");
      const accs = await loadAccounts();
      S.accounts = accs;
      S.controls = {};
      if (!keepSelection) S.selected = new Set();
      editBtn && editBtn.removeAttribute("disabled");
      render();
      logEl && log(t("reading") + "…");
      const c = await loadControls(accs, (done, total) => { if (logEl) logEl.textContent = t("reading") + " " + done + "/" + total + "…"; });
      S.controls = c;
      if (logEl) { logEl.textContent = ""; }
      render();
    } catch (e) {
      if (logEl) log(t("errLoad") + ": " + e.message, "err");
      alert("FB Targeting Manager: " + e.message);
    }
  }

  function setLang(lang) {
    S.lang = lang;
    try { localStorage.setItem("fbac_lang", lang); } catch {}
    rebuild();
  }

  function rebuild() {
    if (!root) return;
    const keepSel = new Set(S.selected);
    root.remove();
    document.querySelectorAll("style.fbac-style").forEach((s) => s.remove());
    mount();
    S.selected = keepSel;
    refresh(true);
  }

  function mount() {
    const style = h("style", { class: "fbac-style" }, [css]);
    document.head.appendChild(style);

    editWrap = h("div", { class: "fbac-edit", style: "display:none" });
    buildEdit();

    tbody = h("tbody");
    titleEl = h("div", { class: "fbac-brand" }, [
      h("h2", {}, ["FB Targeting Manager"]),
      h("a", { class: "fbac-by", href: "https://yellowweb.top/", target: "_blank", rel: "noopener noreferrer" }, ["by Yellow Web"]),
      h("div", { class: "fbac-ver" }, ["v." + Config.VERSION]),
    ]);
    headCheck = h("input", { type: "checkbox", title: t("account"),
      onchange: (e) => {
        const list = visibleAccounts();
        list.forEach((a) => e.target.checked ? S.selected.add(a.id) : S.selected.delete(a.id));
        renderTable();
      } });
    accHead = h("span", {}, [t("account")]);

    editBtn = h("button", { class: "fbac-editbtn", onclick: function () {
      const on = editWrap.style.display === "none";
      editWrap.style.display = on ? "block" : "none";
      this.className = "fbac-editbtn" + (on ? " on" : "");
    } }, [t("edit") + " (0)"]);

    const langBox = h("div", { class: "fbac-langs" }, [
      h("button", { class: (S.lang === "ru" ? "on" : ""), onclick: () => setLang("ru") }, ["RU"]),
      h("button", { class: (S.lang === "en" ? "on" : ""), onclick: () => setLang("en") }, ["EN"]),
    ]);

    const head = h("div", { class: "fbac-head" }, [
      titleEl, h("span", { class: "fbac-spacer" }), langBox,
      h("button", { class: "fbac-x", title: "×", onclick: () => root.remove() }, ["×"]),
    ]);

    searchEl = h("input", { type: "search", placeholder: t("search"), oninput: (e) => { S.query = e.target.value; renderTable(); } });
    refreshBtn = h("button", { class: "fbac-iconbtn", title: t("refresh"), onclick: () => refresh() }, ["\u21bb"]);
    const bar = h("div", { class: "fbac-bar" }, [searchEl, refreshBtn, editBtn]);

    const table = h("table", { class: "fbac" }, [
      h("colgroup", {}, [
        h("col", { style: "width:26px" }),
        h("col", { style: "width:212px" }),
        h("col", { style: "width:60px" }),
        h("col", { style: "width:104px" }),
        h("col", {}),
      ]),
      h("thead", {}, [h("tr", {}, [
        h("th", {}, [headCheck]),
        h("th", {}, [accHead]),
        h("th", {}, [t("age")]),
        h("th", {}, [t("geo")]),
        h("th", {}, [t("placements")]),
      ])]),
      tbody,
    ]);

    const scroll = h("div", { class: "fbac-scroll" }, [table]);
    const panel = h("div", { class: "fbac-panel" }, [head, bar, scroll, editWrap]);
    root = h("div", { class: "fbac-overlay" }, [panel]);
    document.body.appendChild(root);
  }

  try {
    S.token = getToken();
  } catch (e) {
    alert("FB Targeting Manager: " + e.message);
    return;
  }
  mount();
  refresh();
})();
