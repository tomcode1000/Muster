// Shared app shell: sidebar, top bar, and helpers used by every app screen.

(() => {
  const ICONS = {
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z"/>',
    plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
    crew: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.8.9 2.8 2.6 3 5.2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14.2H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 4.6V4.5a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.1a2 2 0 110 4h-.1a1.6 1.6 0 00-1.2.8z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 21h4"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    chevLeft: '<path d="M15 6l-6 6 6 6"/>',
    chevRight: '<path d="M9 6l6 6-6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    dots: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 00-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    work: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="12" cy="6" r="2.5"/><path d="M10.5 8l-3 7.8M13.5 8l3 7.8M8.5 18h7"/>',
    list: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
    headset: '<path d="M4 13a8 8 0 0116 0v3"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    chart: '<path d="M5 20v-6M10 20V9M15 20v-9M20 20V5"/>',
    log: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  const icon = (name, attrs = "") => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${attrs}>${ICONS[name] || ""}</svg>`;
  const BRAND = '<svg viewBox="0 0 32 28" aria-hidden="true"><g fill="#2f5bea"><rect x="0" y="10" width="3.4" height="8" rx="1.7"/><rect x="7" y="4" width="3.4" height="20" rx="1.7"/><rect x="14" y="0" width="3.4" height="28" rx="1.7"/><rect x="21" y="6" width="3.4" height="16" rx="1.7"/><rect x="28" y="11" width="3.4" height="6" rx="1.7"/></g></svg>';
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
  const initials = (s) => String(s || "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "M";
  const toDate = (iso) => new Date(`${iso}T12:00:00`);
  const fmtDay = (iso) => { const d = toDate(iso); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const shortDay = (iso) => { const d = toDate(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const hours = (a, b) => { const m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; }; const d = (m(b) - m(a)) / 60; return Number.isInteger(d) ? `${d}h` : `${d.toFixed(1)}h`; };
  const timeOf = (iso) => { const d = new Date(iso); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.replace(`signin.html?next=${encodeURIComponent(location.pathname + location.search)}`);
      throw new Error("Sign in to continue.");
    }
    if (!res.ok) {
      const err = new Error((data.errors && data.errors.join(". ")) || data.error || `Request failed (${res.status})`);
      err.errors = data.errors || [err.message];
      throw err;
    }
    return data;
  }

  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3400);
  }

  /** One status per booking, the same words on every screen. */
  function statusOf(checkIn, flagged) {
    if (!checkIn || (checkIn.status === "pending" && !checkIn.attempts)) return flagged ? ["attention", "Needs attention"] : ["notcalled", "Not called"];
    // Pending after a call means the foreman picked up but hung up before confirming anything.
    if (checkIn.status === "pending" && checkIn.callIds?.length) return ["noanswer", "Call ended early"];
    if (checkIn.status === "pending") return ["noanswer", "No answer"];
    if (checkIn.status === "in_progress") return ["oncall", "On call"];
    if (checkIn.status === "unreachable") return ["noanswer", "No answer"];
    if (checkIn.attendance && !checkIn.attendance.coming) return ["notcoming", "Not coming"];
    return flagged ? ["attention", "Needs attention"] : ["confirmed", "Confirmed"];
  }

  const PILL_ICON = {
    confirmed: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" stroke-width="2.4"/>',
    attention: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 7v6M12 16.5v.5" stroke="#fff" stroke-width="2.4"/>',
    oncall: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 7v5l3 2" stroke="#fff" stroke-width="2.2"/>',
    notcalled: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.4"/>',
    notcoming: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" stroke-width="2.4"/>',
    noanswer: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.4"/><path d="M12 8v4" stroke="currentColor" stroke-width="2.4"/>',
  };
  const pill = (cls, label, sub = "") => `<span class="pill ${cls}"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round">${PILL_ICON[cls]}</svg><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></span>`;

  /** Settings is a section: its pages show as a sub list under Settings. */
  const SETTINGS_PAGES = [
    ["settings-project.html", "Project"],
    ["settings-agent.html", "Agent"],
    ["settings-schedule.html", "Call times"],
    ["settings-source.html", "Data source"],
    ["settings-phone.html", "Phone"],
  ];

  function mount(active, { onSearch } = {}) {
    const inSettings = active === "settings.html" || SETTINGS_PAGES.some(([href]) => href === active);
    const nav = [
      ["today.html", "home", "Today"],
      ["plan.html", "plan", "Plan"],
      ["crew.html", "crew", "Crew"],
      ["calls.html", "phone", "Calls"],
      ["talk.html", "wave", "Try a check-in"],
    ];
    const side = document.querySelector("[data-shell-side]");
    side.className = "side";
    side.innerHTML = `
      <a class="brand" href="index.html" aria-label="Muster home">${BRAND}Muster</a>
      <nav class="nav" aria-label="App">
        ${nav.map(([href, ic, label]) => `<a href="${href}" class="${active === href ? "on" : ""}" ${active === href ? 'aria-current="page"' : ""}>${icon(ic)}${label}</a>`).join("")}
        <div class="gap"></div>
        <a href="settings.html" class="${active === "settings.html" ? "on" : ""}">${icon("gear")}Settings</a>
        ${inSettings ? `<div class="subnav">${SETTINGS_PAGES.map(([href, label]) => `<a href="${href}" class="${active === href ? "on" : ""}" ${active === href ? 'aria-current="page"' : ""}><i></i>${label}</a>`).join("")}</div>` : ""}
        <a href="usage.html" class="${active === "usage.html" ? "on" : ""}">${icon("chart")}Usage and limits</a>
        <a href="help.html" class="${active === "help.html" ? "on" : ""}">${icon("help")}Help</a>
      </nav>
      <div class="help-card">
        <span class="b">${icon("headset", 'style="width:16px;height:16px"')}</span>
        <b>Need help?</b>
        <p>Check out our guide or contact support.</p>
        <a href="help.html">Visit help ${icon("arrow", 'style="width:13px;height:13px"')}</a>
      </div>`;

    const top = document.querySelector("[data-shell-top]");
    top.className = "top";
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    top.innerHTML = `
      <button class="burger" id="shellBurger" aria-label="Open menu" aria-expanded="false">${icon("menu")}</button>
      <label class="search">${icon("search", 'style="width:16px;height:16px;color:#6b7390"')}<input id="shellSearch" placeholder="Search crew, bookings or areas" aria-label="Search"><kbd>${mac ? "⌘ K" : "Ctrl K"}</kbd></label>
      <button class="bell" id="shellBell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon("bell")}<i id="shellDot" hidden></i></button>
      <div class="notif" id="shellNotif" hidden>
        <div class="notif-h">${icon("bell")}<b>Notifications</b><button type="button" id="shellMarkRead">Mark all as read</button></div>
        <div class="notif-tabs" role="tablist">
          <button type="button" class="on" data-tab="all" role="tab">All</button>
          <button type="button" data-tab="unread" role="tab">Unread</button>
        </div>
        <div class="notif-list" id="shellNotifList"></div>
        <a class="notif-f" href="today.html">Open Today ${icon("arrow", 'style="width:13px;height:13px"')}</a>
      </div>
      <div class="me" id="shellMe" role="button" tabindex="0" aria-haspopup="true" aria-expanded="false"><span class="avatar" id="shellInitials">M</span><b id="shellName">Your account</b>${icon("chevDown", 'style="width:14px;height:14px"')}
        <div class="menu" id="shellMenu" hidden><a href="settings.html">Settings</a><button type="button" id="shellSignOut">Sign out</button></div>
      </div>`;

    const search = document.getElementById("shellSearch");
    // The field on the page filters what is on screen; the overlay searches everything.
    if (onSearch) search.addEventListener("input", () => onSearch(search.value.trim().toLowerCase()));
    search.addEventListener("focus", () => { if (!onSearch) openSearch(); });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
      if (e.key === "Escape") {
        closeSearch();
        document.querySelectorAll(".menu, .pop, .notif").forEach((m) => (m.hidden = true));
      }
    });
    mountNotifications();
    mountPhoneNav(active, nav);
    const me = document.getElementById("shellMe");
    const menu = document.getElementById("shellMenu");
    const toggle = () => { menu.hidden = !menu.hidden; me.setAttribute("aria-expanded", String(!menu.hidden)); };
    me.addEventListener("click", (e) => { if (!e.target.closest("#shellMenu")) toggle(); });
    me.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    document.addEventListener("click", (e) => { if (!me.contains(e.target)) menu.hidden = true; });

    document.getElementById("shellSignOut").addEventListener("click", async () => {
      await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
      location.replace("signin.html");
    });

    api("GET", "/api/auth/status").then(({ user }) => {
      if (!user) return;
      document.getElementById("shellName").textContent = user.name.split(/\s+/)[0];
      document.getElementById("shellInitials").textContent = initials(user.name);
      document.getElementById("shellMe").title = user.email;
    }).catch(() => {});
  }

  const NOTE_ICON = {
    checkin: ["ok", "check"],
    problem: ["bad", "warn"],
    call_failed: ["blue", "phone"],
    round: ["violet", "crew"],
    limit: ["amber", "chart"],
  };

  function mountNotifications() {
    const bell = document.getElementById("shellBell");
    const panel = document.getElementById("shellNotif");
    const list = document.getElementById("shellNotifList");
    let items = [];
    let seenAt = "";
    let tab = "all";

    function draw() {
      const shown = tab === "unread" ? items.filter((n) => n.at > seenAt) : items;
      if (!shown.length) {
        list.innerHTML = `<p class="notif-empty">${tab === "unread" ? "Nothing new since your last look." : "Nothing has happened yet. Your first round will show up here."}</p>`;
        return;
      }
      const groups = new Map();
      for (const n of shown) {
        const key = dayLabel(n.at);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }
      list.innerHTML = [...groups].map(([label, group]) => `
        <div class="notif-day">${esc(label)}</div>
        ${group.map((n) => {
          const [tone, ic] = NOTE_ICON[n.type] || ["blue", "bell"];
          return `<div class="notif-item ${n.at > seenAt ? "unread" : ""}">
            <span class="ic ${tone}">${icon(ic)}</span>
            <span><b>${esc(n.title)}</b><small>${esc(n.text)}</small></span>
            <span class="when">${timeOf(n.at)}${n.at > seenAt ? '<i class="dot"></i>' : ""}</span>
          </div>`;
        }).join("")}`).join("");
    }

    async function load() {
      try {
        const data = await api("GET", "/api/notifications");
        items = data.items;
        seenAt = data.seenAt || "";
        const unread = data.unread;
        const dot = document.getElementById("shellDot");
        if (dot) dot.hidden = unread === 0;
        draw();
      } catch {}
    }

    bell.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      bell.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) load();
    });
    document.addEventListener("click", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) panel.hidden = true;
    });
    panel.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) {
        tab = t.dataset.tab;
        panel.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === t));
        draw();
      }
    });
    document.getElementById("shellMarkRead").addEventListener("click", async () => {
      const r = await api("POST", "/api/notifications/seen").catch(() => null);
      if (!r) return;
      seenAt = r.seenAt;
      const dot = document.getElementById("shellDot");
      if (dot) dot.hidden = true;
      draw();
    });

    load();
    setInterval(load, 60_000);
  }

  /** Today, Yesterday, or the date, so a list of times reads at a glance. */
  function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (same(d, today)) return "Today";
    if (same(d, yesterday)) return "Yesterday";
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  // ---------------------------------------------------------------- Search
  let searchBox = null;
  let searchTimer = null;

  function openSearch() {
    if (searchBox) { searchBox.hidden = false; searchBox.querySelector("input").focus(); return; }
    searchBox = document.createElement("div");
    searchBox.className = "overlay";
    searchBox.innerHTML = `
      <div class="finder" role="dialog" aria-label="Search">
        <label class="finder-in">${icon("search", 'style="width:16px;height:16px;color:#6b7390"')}<input placeholder="Search crew, bookings or calls" aria-label="Search everything"><button type="button" class="x" aria-label="Close">${icon("x")}</button></label>
        <div class="finder-body" id="finderBody"><p class="notif-empty">Type at least two letters.</p></div>
        <div class="finder-f"><span>Arrow keys to move</span><span>Enter to open</span><span>Esc to close</span></div>
      </div>`;
    document.body.appendChild(searchBox);

    const input = searchBox.querySelector("input");
    const body = searchBox.querySelector("#finderBody");

    const run = async (q) => {
      if (q.trim().length < 2) { body.innerHTML = '<p class="notif-empty">Type at least two letters.</p>'; return; }
      try {
        const r = await api("GET", `/api/search?q=${encodeURIComponent(q.trim())}`);
        const groups = [
          ["Subcontractors", "crew", r.crew, r.counts.crew, (c) => ({ href: `crew.html?q=${encodeURIComponent(c.company)}`, title: c.company, sub: `${c.trade} · ${c.foreman}` })],
          ["Bookings", "plan", r.bookings, r.counts.bookings, (b) => ({ href: `plan.html?date=${b.date}`, title: `${b.company}: ${b.description}`, sub: `${fmtDay(b.date)} · ${clock(b.start)} · ${b.area}` })],
          ["Calls", "phone", r.calls, r.counts.calls, (c) => ({ href: `calls.html?id=${encodeURIComponent(c.id)}`, title: `${c.company}: ${c.work}`, sub: `${timeOf(c.startedAt)} · ${c.foreman}` })],
        ].filter(([, , rows]) => rows.length);

        if (!groups.length) { body.innerHTML = `<p class="notif-empty">Nothing matches "${esc(q)}".</p>`; return; }
        body.innerHTML = groups.map(([label, ic, rows, count, shape]) => `
          <div class="finder-group"><span>${icon(ic)}${label}</span><small>${count > rows.length ? `${rows.length} of ${count}` : count}</small></div>
          ${rows.map((row) => { const v = shape(row); return `<a class="finder-row" href="${v.href}"><span><b>${esc(v.title)}</b><small>${esc(v.sub)}</small></span>${icon("chevRight", 'style="width:14px;height:14px;color:#9aa1b4"')}</a>`; }).join("")}`).join("");
      } catch (ex) {
        body.innerHTML = `<p class="notif-empty">${esc(ex.message)}</p>`;
      }
    };

    input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => run(input.value), 180); });
    input.addEventListener("keydown", (e) => {
      const rows = [...body.querySelectorAll(".finder-row")];
      if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); rows[0].focus(); }
      if (e.key === "Enter" && rows.length) { e.preventDefault(); rows[0].click(); }
    });
    body.addEventListener("keydown", (e) => {
      const rows = [...body.querySelectorAll(".finder-row")];
      const at = rows.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (rows[at + 1] || rows[0]).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); at <= 0 ? input.focus() : rows[at - 1].focus(); }
    });
    searchBox.querySelector(".x").addEventListener("click", closeSearch);
    searchBox.addEventListener("click", (e) => { if (e.target === searchBox) closeSearch(); });
    input.focus();
  }

  function closeSearch() {
    if (searchBox) searchBox.hidden = true;
  }

  /**
   * Phone navigation. The sidebar becomes a drawer, and the places used every
   * day sit in a bar along the bottom where a thumb can reach them. Both are
   * hidden by the stylesheet on anything wider than a handset.
   */
  function mountPhoneNav(active, nav) {
    const side = document.querySelector(".side");
    const burger = document.getElementById("shellBurger");

    const scrim = document.createElement("button");
    scrim.className = "side-scrim";
    scrim.type = "button";
    scrim.setAttribute("aria-label", "Close menu");
    document.body.appendChild(scrim);

    const setOpen = (open) => {
      side.classList.toggle("open", open);
      scrim.classList.toggle("on", open);
      burger.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };

    burger.addEventListener("click", () => setOpen(!side.classList.contains("open")));
    scrim.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    // Following a link should not leave the drawer open behind the new page.
    side.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });

    const tabs = document.createElement("nav");
    tabs.className = "tabbar";
    tabs.setAttribute("aria-label", "Sections");
    tabs.innerHTML = `
      ${nav.slice(0, 4).map(([href, ic, label]) => `<a href="${href}" class="${active === href ? "on" : ""}">${icon(ic)}${label}</a>`).join("")}
      <button type="button" id="shellMore">${icon("menu")}More</button>`;
    document.body.appendChild(tabs);
    document.getElementById("shellMore").addEventListener("click", () => setOpen(true));
  }

  function setAttentionDot(on) {
    const dot = document.getElementById("shellDot");
    if (dot) dot.hidden = !on;
  }

  /** Closes any open row menu when clicking elsewhere. */
  document.addEventListener("click", (e) => {
    document.querySelectorAll("[data-menu] > .menu").forEach((m) => {
      if (!m.parentElement.contains(e.target)) m.hidden = true;
    });
  });

  window.Muster = { icon, esc, clock, initials, fmtDay, shortDay, addDays, hours, timeOf, api, toast, statusOf, pill, mount, setAttentionDot };
})();
