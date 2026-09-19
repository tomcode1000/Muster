// Shared by the Settings pages: load once, save one section without touching the rest.

(() => {
  const M = window.Muster;
  let loaded = null;

  async function load() {
    const data = await M.api("GET", "/api/settings");
    loaded = data.settings;
    return data;
  }

  /**
   * Saves one section. The server validates the whole settings object, so the
   * other sections are sent back exactly as they were read.
   */
  async function save(patch) {
    if (!loaded) throw new Error("Settings are still loading.");
    const body = { ...loaded, ...patch };
    const { settings } = await M.api("PUT", "/api/settings", body);
    loaded = settings;
    return settings;
  }

  const current = () => loaded;

  function timezones(selected) {
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [selected];
    if (!zones.includes(selected)) zones.unshift(selected);
    return zones;
  }

  /** Reads a time zone as people say it: "(GMT-05:00) America/New_York". */
  function zoneLabel(zone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date());
      const name = parts.find((p) => p.type === "timeZoneName")?.value || "";
      return name ? `(${name.replace("GMT", "GMT")}) ${zone.replace(/_/g, " ")}` : zone.replace(/_/g, " ");
    } catch {
      return zone;
    }
  }

  function options(el, list, value) {
    el.innerHTML = list.map(([v, label]) => `<option value="${M.esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${M.esc(label)}</option>`).join("");
  }

  /** Renders the page head, with a link back to the settings list. */
  function head(eyebrowHref, title, sub) {
    return `
      <a class="back" href="${eyebrowHref}">${M.icon("arrow")}Back to settings</a>
      <div class="head"><div><h1>${M.esc(title)}</h1><p>${M.esc(sub)}</p></div></div>`;
  }

  function setMessage(el, text, tone = "") {
    el.textContent = text;
    el.className = `msg ${tone}`;
  }

  /** A chip input for a list of words, used for the site words the agent listens for. */
  function wordBox(box, words, { max = 100, onChange = () => {} } = {}) {
    let list = [...words];
    function draw() {
      box.innerHTML = `
        ${list.map((w, i) => `<span class="word">${M.esc(w)}<button type="button" data-i="${i}" aria-label="Remove ${M.esc(w)}">${M.icon("x")}</button></span>`).join("")}
        <span class="add"><input placeholder="Add a word..." aria-label="Add a word" maxlength="40"><button type="button" data-add aria-label="Add">${M.icon("plus")}</button></span>`;
      onChange(list.length);
    }
    function add() {
      const input = box.querySelector(".add input");
      const words = input.value.split(",").map((w) => w.trim()).filter(Boolean);
      for (const w of words) {
        if (list.length >= max) return M.toast(`Up to ${max} words.`);
        if (!list.some((x) => x.toLowerCase() === w.toLowerCase())) list.push(w);
      }
      draw();
      box.querySelector(".add input").focus();
    }
    box.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-i]");
      if (remove) { list.splice(Number(remove.dataset.i), 1); return draw(); }
      if (e.target.closest("[data-add]")) add();
    });
    box.addEventListener("keydown", (e) => {
      if (e.target.matches(".add input") && (e.key === "Enter" || e.key === ",")) { e.preventDefault(); add(); }
      if (e.target.matches(".add input") && e.key === "Backspace" && !e.target.value && list.length) { list.pop(); draw(); }
    });
    draw();
    return { value: () => [...list] };
  }

  window.MusterSettings = { load, save, current, timezones, zoneLabel, options, head, setMessage, wordBox };
})();
