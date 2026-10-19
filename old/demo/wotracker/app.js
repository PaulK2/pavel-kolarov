/**
 * Order Tracker - Web MVP (vanilla JS)
 * Data model mirrors the Python app (open/finished/links/kb_texts/kb_tabs/categories/theme).
 * Persistence: localStorage per user.
 */

// ---- Compatibility: structuredClone polyfill (for older browsers/VMs) ----
if (typeof structuredClone !== "function") {
  window.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

const DEFAULT_TASKS = [
  "MATERIAL LIST",
  "BUSINESS WEB ORDER",
  "SAP AUFTRAG",
  "SAP VERKNÜPFUNG",
  "CISCO ORDER FINISHED",
  "WARENEINGANG GEBUCHT",
  "SAP EFLOW"
];

const DEFAULT_CATEGORIES = [
  { name: "Default", color: "#3b82f6", tasks: [...DEFAULT_TASKS] }
];

const DEFAULT_DATA = {
  open: [],
  finished: [],
  links: [],
  kb_texts: [],
  kb_tabs: [{ name: "General", color: "#3b82f6", rows: [] }],
  categories: [...DEFAULT_CATEGORIES],
  theme: "dark"
};

const State = {
  user: null,
  preview: false,
  snapshot: null, // legacy/unused now, kept for compatibility
  data: structuredClone(DEFAULT_DATA),
};

// Persist preview across navigation (tab/session only; does NOT touch user data)
const PREVIEW_PAYLOAD_KEY = "ot:previewPayload";

function nowTs(){
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function storageKey(username){ return `ot:${username}`; }
function settingsKey(){ return "ot:settings"; }

function getUsersList(){
  const raw = localStorage.getItem("ot:users");
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function setUsersList(users){
  localStorage.setItem("ot:users", JSON.stringify(users));
}

function setCurrentUser(username){
  State.user = username;
  localStorage.setItem("ot:currentUser", username);
}

function getCurrentUser(){
  return localStorage.getItem("ot:currentUser") || null;
}

function loadUser(username){
  setCurrentUser(username);
  State.preview = false;
  State.snapshot = null;

  const raw = localStorage.getItem(storageKey(username));
  if(raw){
    try { State.data = JSON.parse(raw); }
    catch { State.data = structuredClone(DEFAULT_DATA); }
  } else {
    State.data = structuredClone(DEFAULT_DATA);
    saveUser(); // create initial blob
  }
  applyTheme(State.data.theme || "dark");
  updateTopbar();
}

function saveUser(){
  if(State.preview) return; // disabled in preview mode
  if(!State.user) return;
  localStorage.setItem(storageKey(State.user), JSON.stringify(State.data));
  updateTopbar();
}

function applyTheme(theme){
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function toast(msg, kind="ok"){
  const el = document.querySelector("#notice");
  if(!el) return;
  el.textContent = msg;
  el.className = `notice show ${kind}`;
  setTimeout(()=> el.classList.remove("show"), 1800);
}

function copyToClipboard(text){
  if(!text){ toast("Nothing to copy", "bad"); return; }
  navigator.clipboard.writeText(text)
    .then(()=> toast("Copied", "ok"))
    .catch(()=> toast("Copy failed", "bad"));
}

function ensureCategories(){
  if(!Array.isArray(State.data.categories) || !State.data.categories.length){
    State.data.categories = structuredClone(DEFAULT_CATEGORIES);
  }
}

function categoryNames(){
  ensureCategories();
  return State.data.categories.map(c => c.name);
}
function categoryByName(name){
  ensureCategories();
  return State.data.categories.find(c => c.name === name) || State.data.categories[0];
}

function makeOrder({name, val310, val42, category}){
  const cat = categoryByName(category || "Default");
  return {
    id: Date.now(),
    name,
    val310,
    val42,
    val23: "",
    category: cat.name,
    tasks: (cat.tasks || DEFAULT_TASKS).map(t => ({ name: t, done: false })),
    notes: [],
    files: [] // web version uses {name,url}
  };
}

function updateTopbar(){
  const userEl = document.querySelector("[data-user]");
  const openEl = document.querySelector("[data-open]");
  const finEl  = document.querySelector("[data-finished]");
  const banner = document.querySelector("#previewBanner");

  if(userEl) userEl.textContent = State.preview ? "PREVIEW MODE" : (State.user || "No user");
  if(openEl) openEl.textContent = `Open: ${State.data.open?.length || 0}`;
  if(finEl)  finEl.textContent  = `Finished: ${State.data.finished?.length || 0}`;
  if(banner) banner.classList.toggle("show", !!State.preview);
}

function setActiveNav(){
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a").forEach(a=>{
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === here);
  });
}

function initCommon(){
  setActiveNav();

  // If no current user, push to users page.
  const u = getCurrentUser();
  if(!u && !location.pathname.endsWith("users.html")){
    location.href = "users.html";
    return;
  }
  if(u && !State.user) loadUser(u);

  // If preview payload exists, activate preview mode (persists across pages)
  const p = sessionStorage.getItem(PREVIEW_PAYLOAD_KEY);
  if(p){
    try{
      State.preview = true;
      State.snapshot = null;
      State.data = JSON.parse(p);
      applyTheme(State.data.theme || "dark");
      updateTopbar();
    } catch(e){
      sessionStorage.removeItem(PREVIEW_PAYLOAD_KEY);
    }
  }

  // Wire "switch user"
  document.querySelectorAll("[data-switch-user]").forEach(btn=>{
    btn.addEventListener("click", ()=> location.href = "users.html");
  });
}

/* ---------- Data Key (share) ---------- */

function encodeKey(obj){
  // Simple base64 of UTF-8 JSON (no compression). Good enough for MVP.
  const json = JSON.stringify(obj);
  const utf8 = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_,p)=> String.fromCharCode(parseInt(p,16)));
  return btoa(utf8);
}
function decodeKey(key){
  const bin = atob(key.trim());
  const utf8 = Array.from(bin, c=> `%${c.charCodeAt(0).toString(16).padStart(2,"0").toUpperCase()}`).join("");
  const json = decodeURIComponent(utf8);
  return JSON.parse(json);
}

function loadFromKeyPreview(key){
  let shared;
  try {
    shared = decodeKey(key);
  } catch(e){
    toast("Invalid key", "bad");
    return;
  }

  const normalized = normalizeData(shared);

  // Persist preview across navigation in this tab only
  sessionStorage.setItem(PREVIEW_PAYLOAD_KEY, JSON.stringify(normalized));

  State.preview = true;
  State.snapshot = null;
  State.data = normalized;

  applyTheme(State.data.theme || "dark");
  updateTopbar();
  toast("Loaded shared data (preview)", "ok");
}

function restoreFromPreview(){
  if(!State.user){
    toast("No user loaded", "bad");
    return;
  }

  sessionStorage.removeItem(PREVIEW_PAYLOAD_KEY);

  State.preview = false;
  State.snapshot = null;

  // Reload real user data from localStorage
  loadUser(State.user);

  toast("Restored your data", "ok");
}

/* ---------- Page helpers ---------- */

function el(html){
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }

function byId(id){ return document.getElementById(id); }

function normalizeData(obj){
  // Accept:
  // - Web schema (open/finished/links/kb_texts/kb_tabs/categories/theme)
  // - Python app exports: orders.json (open/finished/links/kb_texts/kb_chart/kb_tabs) + settings.json (theme/categories/default_tasks)
  const out = structuredClone(DEFAULT_DATA);
  const src = (obj && typeof obj === "object") ? obj : {};

  // Orders
  out.open = Array.isArray(src.open) ? src.open : out.open;
  out.finished = Array.isArray(src.finished) ? src.finished : out.finished;

  // Links may live in orders.json
  out.links = Array.isArray(src.links) ? src.links : out.links;

  // KB common texts
  out.kb_texts = Array.isArray(src.kb_texts) ? src.kb_texts : out.kb_texts;

  // KB tabs: prefer kb_tabs; else migrate legacy kb_chart into one tab
  if(Array.isArray(src.kb_tabs) && src.kb_tabs.length){
    out.kb_tabs = src.kb_tabs;
  } else if(Array.isArray(src.kb_chart)){
    out.kb_tabs = [{ name: "General", color: "#3b82f6", rows: src.kb_chart }];
  } else {
    out.kb_tabs = out.kb_tabs;
  }

  // Categories: prefer categories; else migrate from default_tasks (old settings)
  if(Array.isArray(src.categories) && src.categories.length){
    out.categories = src.categories;
  } else if(Array.isArray(src.default_tasks) && src.default_tasks.length){
    out.categories = [{ name: "Default", color: "#3b82f6", tasks: src.default_tasks }];
  } else {
    out.categories = out.categories;
  }

  // Theme
  out.theme = (src.theme === "light" || src.theme === "dark") ? src.theme : out.theme;

  // Normalize orders fields
  const ensureOrder = (o)=>{
    if(!o || typeof o !== "object") return null;
    o.id ??= Date.now();
    o.val23 ??= "";
    o.notes ??= [];
    o.files ??= [];
    o.category ??= out.categories?.[0]?.name || "Default";

    // tasks
    if(!Array.isArray(o.tasks) || !o.tasks.length){
      const cat = out.categories.find(c=>c.name===o.category) || out.categories[0];
      const tpl = (cat?.tasks?.length ? cat.tasks : DEFAULT_TASKS);
      o.tasks = tpl.map(t=>({name:t, done:false}));
    } else {
      o.tasks = o.tasks.map(t=> (typeof t === "string") ? ({name:t, done:false}) : ({name:t.name||"", done:!!t.done}));
    }

    // files: allow strings/paths from python; web expects {name,url}
    if(Array.isArray(o.files)){
      o.files = o.files.map((f)=>{
        if(!f) return null;
        if(typeof f === "string") return {name: f.split(/[\\/]/).pop(), url: f};
        if(typeof f === "object") return {name: f.name || "link", url: f.url || f.path || f.link || ""};
        return null;
      }).filter(Boolean);
    }
    return o;
  };

  out.open = (out.open||[]).map(ensureOrder).filter(Boolean);
  out.finished = (out.finished||[]).map(ensureOrder).filter(Boolean);

  // Normalize kb tabs/rows
  if(!Array.isArray(out.kb_tabs) || !out.kb_tabs.length){
    out.kb_tabs = [{ name: "General", color: "#3b82f6", rows: [] }];
  }
  out.kb_tabs = out.kb_tabs.map(t=>{
    const tab = (t && typeof t === "object") ? t : {};
    tab.name = tab.name || "Tab";
    tab.color = tab.color || "#3b82f6";
    tab.rows = Array.isArray(tab.rows) ? tab.rows : [];
    tab.rows = tab.rows.map(r=>{
      if(!r) return null;
      if(typeof r === "string") return {name:"", value:r};
      return {name: r.name || "", value: r.value || ""};
    }).filter(Boolean);
    return tab;
  });

  // Normalize links (python: {name, link})
  out.links = (out.links||[]).map(l=>{
    if(!l) return null;
    if(typeof l === "string") return {name:"Link", link:l};
    return {name: l.name || "Link", link: l.link || l.url || ""};
  }).filter(Boolean);

  return out;
}

window.OT = {
  State, DEFAULT_TASKS, DEFAULT_DATA,
  initCommon, saveUser, applyTheme, toast, copyToClipboard,
  categoryNames, categoryByName, makeOrder, nowTs,
  encodeKey, loadFromKeyPreview, restoreFromPreview,
  normalizeData,
  el, clear, byId,
};
