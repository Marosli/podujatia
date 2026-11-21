"use strict";

const GROUPS = [
  { id: "tradicie", label: "Tradície a víno", cats: ["hody_jarmok", "trh", "vino", "folklor"], color: "#d9861c" },
  { id: "hudba", label: "Hudba", cats: ["koncert", "klub"], color: "#6f55e0" },
  { id: "divadlo", label: "Divadlo", cats: ["divadlo"], color: "#cf3f63" },
  { id: "deti", label: "Pre deti", cats: ["deti"], color: "#19958a" },
  { id: "vystavy", label: "Výstavy", cats: ["vystava_vernisaz"], color: "#3a74d8" },
  { id: "pohyb", label: "Šport a príroda", cats: ["sport_turistika"], color: "#4c9437" },
  { id: "ostatne", label: "Ostatné", cats: ["komunita", "ine"], color: "#8b8475" },
];
const GROUP_OF = Object.fromEntries(GROUPS.flatMap(g => g.cats.map(c => [c, g])));
const groupOf = e => GROUP_OF[e.c] || GROUPS[GROUPS.length - 1];
const CAT_LABEL = {
  hody_jarmok: "hody a jarmok", trh: "trh", vino: "víno", folklor: "folklór", koncert: "koncert", klub: "klub",
  divadlo: "divadlo", deti: "pre deti", vystava_vernisaz: "výstava", sport_turistika: "šport a príroda",
  komunita: "komunita", ine: "iné",
};
const BA_DISTRICTS = new Set(["Staré Mesto", "Ružinov", "Vrakuňa", "Podunajské Biskupice", "Nové Mesto", "Rača",
  "Vajnory", "Karlova Ves", "Dúbravka", "Lamač", "Devín", "Devínska Nová Ves", "Záhorská Bystrica", "Petržalka",
  "Jarovce", "Rusovce", "Čunovo"]);
const PRESET_LABEL = { weekend: "Tento víkend", today: "Dnes", tomorrow: "Zajtra", "next-weekend": "Ďalší víkend" };
const WD = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
const WD_LONG = ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"];
const MONTH_GEN = ["januára", "februára", "marca", "apríla", "mája", "júna", "júla", "augusta", "septembra",
  "októbra", "novembra", "decembra"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "máj", "jún", "júl", "aug", "sep", "okt", "nov", "dec"];
const STRIP_DAYS = 14;
const CENTER = [17.1077, 48.1486];
const DETAIL_ZOOM = 11.5; // below: one circle per town, above: one per venue

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const akcii = n => plural(n, "akcia", "akcie", "akcií");
const isBA = m => m === "Bratislava" || BA_DISTRICTS.has(m);
const townOf = m => (isBA(m) ? "Bratislava" : m);
const placeKey = e => `${e.la},${e.lo}`;
const isPhone = () => window.matchMedia("(max-width: 900px)").matches;
const dayShort = s => { const d = parse(s); return `${WD[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`; };
// "OTVORENÉ PIVNICE LIMBACH" reads calmer as "Otvorené pivnice limbach"; short acronyms stay.
const calm = t => {
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6 || letters !== letters.toUpperCase()) return t;
  const s = t.toLocaleLowerCase("sk");
  return s.charAt(0).toLocaleUpperCase("sk") + s.slice(1);
};
// "Kultúrny dom Devín, Devín - Bratislava" -> "Kultúrny dom Devín" when the tail only repeats the town.
const cleanVenue = e => {
  const parts = (e.v || "").split(",").map(s => s.trim()).filter(Boolean);
  const tail = fold(parts.at(-1));
  if (parts.length > 1 && (tail.includes("bratislava") || tail.includes(fold(e.m)))) parts.pop();
  return parts.join(", ");
};

let DATA = null, map = null, byId = new Map();
const today = parse(iso(new Date()));
const state = { from: null, to: null, preset: null, group: null, radius: 50, q: "", place: null, selected: null };

/* Period */
function weekendOf(d) {
  const wd = d.getDay(); // 0 = Sunday
  if (wd === 5 || wd === 6 || wd === 0) return [d, addDays(d, wd === 0 ? 0 : 7 - wd)];
  return [addDays(d, 5 - wd), addDays(d, 7 - wd)];
}
function applyPreset(p) {
  let range;
  if (p === "today") range = [today, today];
  else if (p === "tomorrow") range = [addDays(today, 1), addDays(today, 1)];
  else if (p === "next-weekend") { const w = weekendOf(today); range = weekendOf(addDays(w[1], 1)); }
  else { p = "weekend"; range = weekendOf(today); }
  state.from = iso(range[0]); state.to = iso(range[1]); state.preset = p;
}
function periodLabel() {
  if (state.preset) return PRESET_LABEL[state.preset];
  return state.from === state.to ? dayShort(state.from) : `${dayShort(state.from)} – ${dayShort(state.to)}`;
}

/* Filtering */
function matches(e, skip = {}) {
  if (!skip.date && (e.d > state.to || (e.e || e.d) < state.from)) return false;
  if (e.km > state.radius) return false;
  if (!skip.group && state.group && groupOf(e).id !== state.group) return false;
  if (!skip.place && state.place) {
    if (state.place.kind === "town" && townOf(e.m) !== state.place.m) return false;
    if (state.place.kind === "loc" && placeKey(e) !== state.place.key) return false;
  }
  if (state.q && !e._q.includes(state.q)) return false;
  return true;
}

/* URL state: #p=…|od=…&do=…, druh, km, q */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  if (h.get("p") in PRESET_LABEL) applyPreset(h.get("p"));
  else if (ok(h.get("od")) && ok(h.get("do"))) { state.from = h.get("od"); state.to = h.get("do"); }
  else applyPreset("weekend");
  if (GROUPS.some(g => g.id === h.get("druh"))) state.group = h.get("druh");
  if (["12", "25", "50"].includes(h.get("km"))) state.radius = Number(h.get("km"));
  if (h.get("q")) { state.q = fold(h.get("q")); $("#q").value = h.get("q"); }
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.preset) h.set("p", state.preset); else { h.set("od", state.from); h.set("do", state.to); }
  if (state.group) h.set("druh", state.group);
  if (state.radius !== 50) h.set("km", state.radius);
  if ($("#q").value.trim()) h.set("q", $("#q").value.trim());
  history.replaceState(null, "", `#${h}`);
}

/* Header and controls */
function renderSummary(list) {
  const towns = {};
  for (const e of list) if (!isBA(e.m)) towns[e.m] = (towns[e.m] || 0) + 1;
  const top = Object.entries(towns).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const what = state.group ? ` v kategórii ${GROUPS.find(g => g.id === state.group).label.toLowerCase()}` : "";
  let html = `<b>${esc(periodLabel())}</b> ${akcii(list.length)}${what}.`;
  if (top.length) {
    html += " Mimo Bratislavy najviac: " + top.map(([m, n]) =>
      `<button type="button" data-town="${esc(m)}">${esc(m)}</button> <span class="n">${n}</span>`).join(" · ") + ".";
  }
  $("#summary").innerHTML = html;
}

function renderPresets() {
  document.querySelectorAll(".preset").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset)));
}

function renderStrip() {
  const counts = {};
  for (const e of DATA.events) if (matches(e, { date: true, place: true })) {
    for (let d = parse(e.d), end = parse(e.e || e.d); d <= end; d = addDays(d, 1)) counts[iso(d)] = (counts[iso(d)] || 0) + 1;
  }
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));
  const max = Math.max(1, ...days.map(d => counts[iso(d)] || 0));
  $("#strip").innerHTML = days.map((d, i) => {
    const k = iso(d), n = counts[k] || 0, wd = d.getDay(), sel = k >= state.from && k <= state.to;
    const mo = i === 0 || d.getDate() === 1 ? `<span class="mo">${MONTH_SHORT[d.getMonth()]}</span>` : "";
    return `<button type="button" class="day${sel ? " sel" : ""}${wd === 0 || wd === 6 ? " we" : ""}" data-d="${k}"
      aria-pressed="${sel}" aria-label="${WD_LONG[wd]} ${d.getDate()}. ${MONTH_GEN[d.getMonth()]}: ${akcii(n)}">${mo}
      <span class="bar"><span class="cnt">${n || ""}</span><i style="height:${n ? Math.max(2, Math.round(24 * n / max)) : 0}px"></i></span>
      <span class="wd">${WD[wd]}</span><span class="dn">${d.getDate()}</span></button>`;
  }).join("");
}

function renderChips() {
  const counts = {};
  for (const e of DATA.events) if (matches(e, { group: true })) counts[groupOf(e).id] = (counts[groupOf(e).id] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $("#chips").innerHTML =
    `<button type="button" class="chip all" data-g="" aria-pressed="${!state.group}">Všetko <span class="n">${total}</span></button>` +
    GROUPS.map(g => {
      const n = counts[g.id] || 0, on = state.group === g.id;
      return `<button type="button" class="chip" data-g="${g.id}" style="--g:${g.color}" aria-pressed="${on}"${!n && !on ? " disabled" : ""}>
        <span class="dot"></span>${g.label} <span class="n">${n}</span></button>`;
    }).join("");
}

function renderPlacebar(list) {
  const bar = $("#placebar");
  if (!state.place) { bar.hidden = true; return; }
  let name = state.place.m;
  if (state.place.kind === "loc") {
    const e = list[0] || DATA.events.find(x => placeKey(x) === state.place.key);
    name = e ? [cleanVenue(e), e.m].filter(Boolean).join(", ") : "Vybrané miesto";
  }
  $("#placebar-label").innerHTML = `<strong>${esc(name)}</strong> · ${akcii(list.length)}`;
  bar.hidden = false;
}

/* Picks: a few village events worth the trip, shown above the list. */
function renderPicks(list) {
  const box = $("#picks");
  if (state.place || state.q) { box.hidden = true; return; }
  const score = e => (groupOf(e).id === "tradicie" ? 3 : 0) + Math.min(e.n, 3) - 1 + (isBA(e.m) ? 0 : 2) - (e.q ? 9 : 0);
  const seen = new Set(), picks = [];
  for (const e of [...list].sort((a, b) => score(b) - score(a) || a.d.localeCompare(b.d))) {
    if (score(e) < 4 || seen.has(e.m)) continue;
    seen.add(e.m); picks.push(e);
    if (picks.length === 5) break;
  }
  if (picks.length < 2) { box.hidden = true; return; }
  box.innerHTML = `<h2>Neprehliadnite</h2><div class="picks-row">${picks.map(e =>
    `<button type="button" class="pick" data-pick="${e.id}">
      <span class="town"><i style="background:${groupOf(e).color}"></i>${esc(e.m)}</span>
      <span class="what">${esc(e.t)}</span><span class="when">${dayShort(e.d)}${e.h ? ` · ${e.h}` : ""}</span></button>`).join("")}</div>`;
  box.hidden = false;
}

/* List */
function eventRow(e) {
  const g = groupOf(e), venue = cleanVenue(e), sel = state.selected === e.id;
  const host = (() => { try { return new URL(e.u).hostname.replace(/^www\./, ""); } catch { return "zdroj"; } })();
  const meta = [];
  if (venue) meta.push(`<span class="v">${esc(venue)}</span>`);
  meta.push(esc(CAT_LABEL[e.c] || "iné"));
  if (e.e) { const d = parse(e.e); meta.push(`do ${d.getDate()}. ${d.getMonth() + 1}.`); }
  if (e.q) meta.push(`<span class="warn">dátum overiť</span>`);
  const time = e.h ? `<span class="tm">${e.h}</span>` : `<span class="tm day">${e.e ? "celý deň" : ""}</span>`;
  return `<article class="ev${sel ? " sel" : ""}" data-id="${e.id}" tabindex="0" aria-expanded="${sel}">
    ${time}<div><div class="ti">${esc(e.t)}</div>
    <div class="me"><span class="dot" style="background:${g.color}"></span>${meta.join(" · ")}</div></div>
    <div class="more">${e.s ? `<p>${esc(e.s)}</p>` : ""}<div class="links">
      <a href="${esc(e.u)}" target="_blank" rel="noopener">Pozvánka na ${esc(host)} ↗</a>
      <button type="button" data-show="${e.id}">Ukázať na mape</button>
      ${e.n > 1 ? `<span class="src">Nájdené v ${e.n} zdrojoch</span>` : ""}</div></div></article>`;
}

function renderList(list) {
  if (!list.length) {
    $("#list").innerHTML = `<div class="empty"><h3>Nič sme nenašli.</h3>
      Skúste iný deň, širší okruh alebo zrušte filter. Malé akcie sa často objavia až pár dní vopred.</div>`;
    return;
  }
  const days = new Map();
  for (const e of list) {
    const day = e.d < state.from ? state.from : e.d;
    if (!days.has(day)) days.set(day, new Map());
    const places = days.get(day);
    if (!places.has(e.m)) places.set(e.m, []);
    places.get(e.m).push(e);
  }
  let html = "";
  for (const day of [...days.keys()].sort()) {
    const d = parse(day), places = days.get(day);
    const n = [...places.values()].reduce((a, p) => a + p.length, 0);
    html += `<section><h2 class="dayhead"><span class="num">${d.getDate()}</span>
      <span class="lab"><b>${WD_LONG[d.getDay()]}</b><span>${MONTH_GEN[d.getMonth()]}</span></span>
      <span class="cnt">${akcii(n)}</span></h2>`;
    const order = [...places.entries()].sort(([a, ea], [b, eb]) => (isBA(b) - isBA(a)) || (ea[0].km - eb[0].km) || a.localeCompare(b, "sk"));
    for (const [m, evs] of order) {
      evs.sort((a, b) => (a.h || "99").localeCompare(b.h || "99") || a.t.localeCompare(b.t, "sk"));
      const label = BA_DISTRICTS.has(m) ? `${esc(m)} <span class="ba">Bratislava</span>`
        : `${esc(m)}${isBA(m) ? "" : ` <span class="km">${Math.round(evs[0].km)} km</span>`}`;
      html += `<h3 class="place">${label}</h3>${evs.map(eventRow).join("")}`;
    }
    html += `</section>`;
  }
  $("#list").innerHTML = html;
}

function renderColophon() {
  const s = DATA.sources || {}, built = new Date(DATA.built);
  const audit = DATA.audit ? ` Pri poslednej kontrole bolo ${DATA.audit.clean} z ${DATA.audit.n} náhodne vybraných akcií úplne správne.` : "";
  $("#colophon").innerHTML = `Zbierame každý deň z <b>${s.municipality || 0} webov obcí</b>, <b>${s.venue || 0} kultúrnych domov a inštitúcií</b>
    a <b>${s.aggregator || 0} kalendárov</b>. Pozvánky číta umelá inteligencia, preto si detaily over v zdroji.${audit}
    Aktualizované ${built.getDate()}. ${built.getMonth() + 1}. o ${String(built.getHours()).padStart(2, "0")}:${String(built.getMinutes()).padStart(2, "0")}.
    Mapa © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">prispievatelia OpenStreetMap</a>.`;
}

function render() {
  const list = DATA.events.filter(e => matches(e));
  const unplaced = state.place ? DATA.events.filter(e => matches(e, { place: true })) : list;
  renderPresets(); renderStrip(); renderChips(); renderPlacebar(list);
  $("#radius").value = String(state.radius);
  renderSummary(unplaced); renderPicks(list); renderList(list);
  $("#status").textContent = `${akcii(list.length)}, ${periodLabel()}`;
  updateMap(unplaced);
  writeHash();
}

/* Map */
function ring(km) {
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * 2 * Math.PI;
    pts.push([CENTER[0] + (km / (111.32 * Math.cos(CENTER[1] * Math.PI / 180))) * Math.cos(a), CENTER[1] + (km / 110.57) * Math.sin(a)]);
  }
  return pts;
}
const ringFeature = km => ({ type: "Feature", geometry: { type: "LineString", coordinates: ring(km) }, properties: {} });
const maskFeature = km => ({ type: "Feature", properties: {}, geometry: { type: "Polygon",
  coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ring(km).reverse()] } });
const point = (lo, la, props = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lo, la] }, properties: props });
const fc = features => ({ type: "FeatureCollection", features });

function fitTo(coords, padding, animate = true) {
  if (!map || !coords.length) return;
  const lons = coords.map(p => p[0]), lats = coords.map(p => p[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding, animate, duration: 700, maxZoom: 12 });
}
const fitRadius = (animate = true) => fitTo(ring(state.radius), 36, animate);

function recolor(m) {
  const P = { land: "#efeae0", water: "#c6d5de", green: "#dde3cc", building: "#e2dcd0", road: "#ffffff",
    casing: "#e0d9cb", major: "#fbf3e4", rail: "#d2cbbb", label: "#6f6a60", halo: "#efeae0", boundary: "#b9b0a0" };
  for (const l of m.getStyle().layers) {
    const id = l.id, set = (p, v) => { try { m.setPaintProperty(id, p, v); } catch { /* property not on this layer */ } };
    if (l.type === "background") set("background-color", P.land);
    else if (/water/.test(id) && l.type === "fill") set("fill-color", P.water);
    else if (/waterway/.test(id) && l.type === "line") set("line-color", P.water);
    else if (/park|wood|grass/.test(id) && l.type === "fill") { set("fill-color", P.green); set("fill-opacity", 0.8); }
    else if (/residential|landuse/.test(id) && l.type === "fill") set("fill-color", P.land);
    else if (/building/.test(id) && l.type === "fill") set("fill-color", P.building);
    else if (/casing/.test(id) && l.type === "line") set("line-color", P.casing);
    else if (/motorway|major/.test(id) && l.type === "line") set("line-color", P.major);
    else if (/highway|road/.test(id) && l.type === "line") set("line-color", P.road);
    else if (/rail/.test(id) && l.type === "line") set("line-color", P.rail);
    else if (/boundary/.test(id) && l.type === "line") set("line-color", P.boundary);
    else if (l.type === "symbol") {
      set("text-color", P.label); set("text-halo-color", P.halo); set("text-halo-width", 1.4);
      if (/^label_|water_name/.test(id)) {
        try { m.setLayoutProperty(id, "text-field", ["coalesce", ["get", "name:sk"], ["get", "name"]]); } catch { /* keep default */ }
      }
    }
  }
}

function townsData(list) {
  const towns = new Map();
  for (const e of list) {
    const m = townOf(e.m);
    if (!towns.has(m)) towns.set(m, { m, n: 0, c: DATA.towns[m] || DATA.towns[e.m] || [e.la, e.lo] });
    towns.get(m).n++;
  }
  return fc([...towns.values()].map(t => point(t.c[1], t.c[0], { m: t.m, count: t.n })));
}

function venuesData(list) {
  const byKey = new Map();
  for (const e of list) {
    const k = placeKey(e);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  return fc([...byKey.entries()].map(([key, evs]) => {
    const g = {};
    for (const e of evs) g[groupOf(e).id] = (g[groupOf(e).id] || 0) + 1;
    const top = GROUPS.find(x => x.id === Object.entries(g).sort((a, b) => b[1] - a[1])[0][0]);
    const e0 = evs[0];
    return point(e0.lo, e0.la, { key, count: evs.length, color: top.color,
      title: evs.length === 1 ? e0.t : (cleanVenue(e0) || e0.m), place: [cleanVenue(e0), e0.m].filter(Boolean).join(", ") });
  }));
}

let popup = null;
function showPopup(lngLat, html, interactive = false) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: interactive, offset: 14, maxWidth: "260px" })
    .setLngLat(lngLat).setHTML(html).addTo(map);
}

function initMap() {
  map = new maplibregl.Map({
    container: "map", style: "https://tiles.openfreemap.org/styles/positron",
    center: [17.3, 48.2], zoom: 9, minZoom: 7, maxZoom: 17, attributionControl: { compact: true },
    dragRotate: false, pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    recolor(map);
    const bold = ["Noto Sans Bold"], regular = ["Noto Sans Regular"];
    map.addSource("mask", { type: "geojson", data: maskFeature(state.radius) });
    map.addSource("ring", { type: "geojson", data: ringFeature(state.radius) });
    map.addSource("towns", { type: "geojson", data: fc([]) });
    map.addSource("venues", { type: "geojson", data: fc([]) });
    map.addSource("sel", { type: "geojson", data: fc([]) });
    map.addSource("hl", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#efeae0", "fill-opacity": 0.6 } });
    map.addLayer({ id: "ring", type: "line", source: "ring",
      paint: { "line-color": "#e5482a", "line-opacity": 0.6, "line-width": 1.5, "line-dasharray": [3, 3] } });
    map.addLayer({ id: "towns", type: "circle", source: "towns", maxzoom: DETAIL_ZOOM,
      paint: { "circle-color": "#e5482a", "circle-opacity": 0.88, "circle-stroke-color": "#fbf9f4", "circle-stroke-width": 1.5,
        "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "count"]], 1, 5, 4, 9, 14, 24] } });
    map.addLayer({ id: "towns-label", type: "symbol", source: "towns", maxzoom: DETAIL_ZOOM,
      layout: { "text-field": ["format", ["get", "m"], { "text-font": ["literal", bold] }, "  ", {},
          ["to-string", ["get", "count"]], { "text-font": ["literal", regular], "text-color": "#66625a" }],
        "text-font": bold, "text-size": 12, "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": ["interpolate", ["linear"], ["sqrt", ["get", "count"]], 1, 0.7, 14, 2.1],
        "text-justify": "auto", "symbol-sort-key": ["-", 0, ["get", "count"]] },
      paint: { "text-color": "#1c1b18", "text-halo-color": "#f3efe6", "text-halo-width": 1.6 } });
    map.addLayer({ id: "venues", type: "circle", source: "venues", minzoom: DETAIL_ZOOM,
      paint: { "circle-color": ["get", "color"], "circle-stroke-color": "#fbf9f4", "circle-stroke-width": 2,
        "circle-radius": ["case", [">", ["get", "count"], 1], 11, 7] } });
    map.addLayer({ id: "venues-n", type: "symbol", source: "venues", minzoom: DETAIL_ZOOM, filter: [">", ["get", "count"], 1],
      layout: { "text-field": ["to-string", ["get", "count"]], "text-font": bold, "text-size": 11.5, "text-allow-overlap": true },
      paint: { "text-color": "#ffffff" } });
    map.addLayer({ id: "sel", type: "circle", source: "sel",
      paint: { "circle-radius": 17, "circle-color": "rgba(229,72,42,0.16)", "circle-stroke-color": "#e5482a", "circle-stroke-width": 2 } });
    map.addLayer({ id: "hl", type: "circle", source: "hl",
      paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1c1b18", "circle-stroke-width": 2.5 } });

    const hover = (layer, html) => {
      map.on("mouseenter", layer, ev => {
        map.getCanvas().style.cursor = "pointer";
        if (!isPhone()) showPopup(ev.features[0].geometry.coordinates, html(ev.features[0].properties));
      });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; if (!isPhone()) popup?.remove(); });
    };
    hover("towns", p => `<div class="pop"><b>${esc(p.m)}</b><span>${akcii(p.count)}</span></div>`);
    hover("venues", p => `<div class="pop"><b>${esc(p.title)}</b><span>${p.count > 1 ? `${esc(p.place)} · ${akcii(p.count)}` : esc(p.place)}</span></div>`);

    map.on("click", "towns", ev => {
      const p = ev.features[0].properties, at = ev.features[0].geometry.coordinates;
      if (isPhone()) return phoneChoice(at, p.m, p.count, { kind: "town", m: p.m });
      setPlace({ kind: "town", m: p.m });
      map.easeTo({ center: at, zoom: p.m === "Bratislava" ? 12 : 12.5 });
    });
    map.on("click", "venues", ev => {
      const p = ev.features[0].properties, at = ev.features[0].geometry.coordinates;
      if (isPhone()) return phoneChoice(at, p.title, p.count, { kind: "loc", key: p.key });
      setPlace({ kind: "loc", key: p.key });
    });
    fitRadius(false);
    render();
  });
}

function phoneChoice(at, title, count, place) {
  showPopup(at, `<div class="pop"><b>${esc(title)}</b><span>${akcii(count)}</span>
    <button type="button" id="pop-go">Zobraziť v zozname</button></div>`, true);
  $("#pop-go").addEventListener("click", () => { popup.remove(); setPlace(place); showMap(false); });
}

function updateMap(list) {
  if (!map?.getSource("towns")) return;
  map.getSource("mask").setData(maskFeature(state.radius));
  map.getSource("ring").setData(ringFeature(state.radius));
  map.getSource("towns").setData(townsData(list));
  map.getSource("venues").setData(venuesData(list));
  const sel = byId.get(state.selected);
  map.getSource("sel").setData(fc(sel ? [point(sel.lo, sel.la)] : []));
  $("#legend").innerHTML = `<b>${akcii(list.length)}</b> · ${esc(periodLabel())}`;
}

function highlight(e) {
  if (map?.getSource("hl")) map.getSource("hl").setData(fc(e ? [point(e.lo, e.la)] : []));
}

/* Interaction */
function setPlace(place) {
  state.place = place; state.selected = null;
  render();
  $("#panel").scrollTo({ top: 0, behavior: "smooth" });
}

function select(id) {
  state.selected = state.selected === id ? null : id;
  document.querySelectorAll(".ev").forEach(el => {
    const on = Number(el.dataset.id) === state.selected;
    el.classList.toggle("sel", on);
    el.setAttribute("aria-expanded", String(on));
  });
  const e = byId.get(state.selected);
  if (map && e && !isPhone()) {
    const ll = [e.lo, e.la];
    if (map.getZoom() < 11) map.easeTo({ center: ll, zoom: 12 });
    else if (!map.getBounds().contains(ll)) map.easeTo({ center: ll });
    showPopup(ll, `<div class="pop"><b>${esc(e.t)}</b><span>${esc([cleanVenue(e), e.m].filter(Boolean).join(", "))}</span></div>`);
  } else popup?.remove();
  map?.getSource("sel")?.setData(fc(e ? [point(e.lo, e.la)] : []));
}

function showMap(on) {
  $("#app").classList.toggle("show-map", on);
  $("#toggle span").textContent = on ? "Zoznam" : "Mapa";
  if (on && map) {
    setTimeout(() => {
      map.resize();
      const pts = DATA.events.filter(e => matches(e)).map(e => [e.lo, e.la]);
      fitTo(pts.length ? pts : ring(state.radius), { top: 76, bottom: 110, left: 24, right: 24 }, false);
    }, 30);
  }
}

function bind() {
  document.querySelectorAll(".preset").forEach(b => b.addEventListener("click", () => {
    applyPreset(b.dataset.preset); state.place = null; render();
  }));
  $("#strip").addEventListener("click", ev => {
    const b = ev.target.closest(".day"); if (!b) return;
    state.from = state.to = b.dataset.d; state.preset = null; state.place = null; render();
  });
  $("#strip-wrap").addEventListener("wheel", ev => {
    const w = ev.currentTarget;
    if (w.scrollWidth > w.clientWidth && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { w.scrollLeft += ev.deltaY; ev.preventDefault(); }
  }, { passive: false });
  $("#chips").addEventListener("click", ev => {
    const b = ev.target.closest(".chip"); if (!b || b.disabled) return;
    state.group = b.dataset.g || null; render();
  });
  $("#radius").addEventListener("change", ev => { state.radius = Number(ev.target.value); state.place = null; render(); fitRadius(); });
  let t;
  $("#q").addEventListener("input", ev => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = fold(ev.target.value.trim()); render(); }, 140);
  });
  $("#summary").addEventListener("click", ev => {
    const b = ev.target.closest("[data-town]"); if (!b) return;
    setPlace({ kind: "town", m: b.dataset.town });
    const c = DATA.towns[b.dataset.town];
    if (c && map && !isPhone()) map.easeTo({ center: [c[1], c[0]], zoom: 12.5 });
  });
  $("#picks").addEventListener("click", ev => {
    const b = ev.target.closest("[data-pick]"); if (!b) return;
    const id = Number(b.dataset.pick);
    if (state.selected !== id) select(id);
    document.querySelector(`.ev[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#placebar-clear").addEventListener("click", () => { setPlace(null); if (!isPhone()) fitRadius(); });
  $("#list").addEventListener("click", ev => {
    const show = ev.target.closest("[data-show]");
    if (show) {
      const e = byId.get(Number(show.dataset.show));
      if (isPhone()) showMap(true);
      setTimeout(() => map?.flyTo({ center: [e.lo, e.la], zoom: 15 }), isPhone() ? 120 : 0);
      return;
    }
    if (ev.target.closest("a")) return;
    const row = ev.target.closest(".ev");
    if (row) select(Number(row.dataset.id));
  });
  $("#list").addEventListener("keydown", ev => {
    const row = ev.target.closest(".ev");
    if (row && ev.target === row && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); select(Number(row.dataset.id)); }
  });
  $("#list").addEventListener("mouseover", ev => {
    const row = ev.target.closest(".ev");
    if (row) highlight(byId.get(Number(row.dataset.id)));
  });
  $("#list").addEventListener("mouseleave", () => highlight(null));
  $("#toggle").addEventListener("click", () => showMap(!$("#app").classList.contains("show-map")));
  // Day headings stick just below the sticky filters (desktop only; on phones the filters scroll away).
  const controls = $("#controls");
  new ResizeObserver(() => {
    const sticky = getComputedStyle(controls).position === "sticky";
    $("#panel").style.setProperty("--ch", `${sticky ? controls.offsetHeight : 0}px`);
  }).observe(controls);
}

async function main() {
  $("#list").innerHTML = `<div class="loading">Načítavam akcie…</div>`;
  const res = await fetch("data/events.json", { cache: "no-cache" });
  DATA = await res.json();
  DATA.towns = DATA.towns || {};
  for (const e of DATA.events) { e.t = calm(e.t); e._q = fold(`${e.t} ${e.v} ${e.m} ${e.s}`); }
  byId = new Map(DATA.events.map(e => [e.id, e]));
  readHash();
  bind();
  renderColophon();
  render();
  initMap();
}

main().catch(err => {
  console.error(err);
  $("#list").innerHTML = `<div class="empty"><h3>Dáta sa nenačítali.</h3>Skúste stránku obnoviť o chvíľu.</div>`;
});
