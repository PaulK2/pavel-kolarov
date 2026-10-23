import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Veo, State } from './veo.js';
import { createEnvironment } from './environment.js';

/* ============================================================
   Project Veo 3.0 - orchestrator (Phases 1 - 2 + visual redesign)
   One persistent canvas carries Veo between the hero and the
   dock. Hash routing drives in-place transitions. The homepage
   nav is a true orbit around Veo: a tilted 3D ring with nodes,
   and the DOM labels are positioned onto those projected nodes.
   Subtle camera life, cinematic lighting and restrained UI.
   Logic (routing, docking, interaction) is unchanged (§25).
   ============================================================ */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const forceSkip = new URLSearchParams(location.search).has('skip');
let introSeen = false;
try { introSeen = sessionStorage.getItem('veoIntroSeen') === '1'; } catch { /* ignore */ }

const REST_YAW = -Math.PI * 0.32;
const REST_POS = new THREE.Vector3(0, 0, 0);
const REST_SCALE = 0.75;                 // reduced ~25% so the menu can breathe (§2)
const START_POS = new THREE.Vector3(-2.7, -0.7, -7);
const DOCK_SCALE = 0.32;
const ROUTES = ['projects', 'portfolio', 'experience', 'contact'];
const HOME_KEYS = ['experience', 'portfolio', 'projects', 'contact']; // ring order: right, top, left, bottom
// Each project opens its own in-site detail page (like portfolio/experience/contact).
const PROJ_SLUGS = { stickers: 'proj-stickers', glass: 'proj-glass', fleet: 'proj-fleet', personal: 'proj-personal' };
const DETAIL_ROUTES = Object.values(PROJ_SLUGS);

const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// ---------- time-of-day mood (§7): subtle brightness/colour by local time ----------
const _cNight = new THREE.Color(0x05101c), _cDay = new THREE.Color(0x0c2436), _cMix = new THREE.Color();
const _bgNight = new THREE.Color(0x060f1a), _bgDay = new THREE.Color(0x0d2538), _bgMix = new THREE.Color();
function computeMood() {
  const d = new Date(); const hour = d.getHours() + d.getMinutes() / 60;
  const dl = 0.5 - 0.5 * Math.cos((hour - 3) / 24 * Math.PI * 2); // darkest ~03:00, brightest ~15:00
  _cMix.copy(_cNight).lerp(_cDay, dl);
  _bgMix.copy(_bgNight).lerp(_bgDay, dl);
  return {
    keyMul: 0.8 + dl * 0.5, hemiMul: 0.7 + dl * 0.7, rimMul: 0.85 + dl * 0.3, accentMul: 0.8 + dl * 0.5,
    particleMul: 0.75 + dl * 0.45,
    fogDensity: 0.052 * (1.18 - dl * 0.32),
    fogColor: _cMix.getHex(),
    oceanDeep: '#' + _bgMix.getHexString(),
    hazeAlpha: 0.05 + dl * 0.09,
  };
}
function applyMoodCSS(m) {
  const r = document.documentElement.style;
  r.setProperty('--ocean-deep', m.oceanDeep);
  r.setProperty('--ocean-haze', `rgba(77,217,207,${m.hazeAlpha.toFixed(3)})`);
}

// ---------- DOM ----------
const stage = document.getElementById('veo-stage');
const navEl = document.getElementById('veo-nav');
const navItems = Array.from(navEl.querySelectorAll('.veo-nav__item'));
const projNavEl = document.getElementById('veo-projnav');
const projItems = Array.from(projNavEl.querySelectorAll('.veo-nav__item'));
const hubEl = document.getElementById('veo-hub');
const skipBtn = document.getElementById('veo-skip');
const contentEl = document.getElementById('veo-content');
const pages = Array.from(document.querySelectorAll('.veo-page'));
const dockEl = document.getElementById('veo-dock');
const dockClock = document.getElementById('veo-dock-clock');
const statusClock = document.getElementById('veo-status-clock');
const homeHit = document.getElementById('veo-home-hit');
const speechEl = document.getElementById('veo-speech');
const speechText = document.getElementById('veo-speech-text');

// ---------- Veo dialogue (§15, §16) - single central data structure ----------
const VEO_DIALOGUE = {
  intro: ["Hi! I'm Veo.", "I'll show you around."],
  back: 'Back already?',
  projects: 'You are going to find interesting stuff there.',
  portfolio: "That's where you'll find out who my friend really is.",
  experience: 'I hate it when my friend leaves me and goes to work.',
  contact: 'Reach out to my friend!',
  returnHome: 'Want to go back?',
  locked: 'Still working on those - check back soon!',
  hub: 'Pick a project - or tap me to head back.',
};
// Per-project one-liners Veo says when you hover a project node (§15).
const PROJ_DIALOGUE = {
  stickers: 'Custom vinyl, plates and wall art - my design venture.',
  glass: 'Serial-numbered collectible glass coins.',
  fleet: 'Software for running delivery operations.',
  personal: "This very site - 3D, built from scratch.",
};
// Routes temporarily locked (not yet ready to show). Easy to unlock later.
const LOCKED_ROUTES = new Set();
let veoScreen = { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };
let speechTimer = null, lastSpeech = { key: null, t: 0 };
function positionSpeech() {
  if (!speechEl || speechEl.hidden) return;
  const x = Math.max(120, Math.min(window.innerWidth - 120, veoScreen.x));
  const y = Math.max(70, veoScreen.y - 96);
  speechEl.style.left = `${x}px`;
  speechEl.style.top = `${y}px`;
}
function showSpeech(text, duration = 3200) {
  if (!speechEl) return;
  speechText.textContent = text;
  speechEl.hidden = false;
  positionSpeech();
  requestAnimationFrame(() => speechEl.classList.add('is-show'));
  clearTimeout(speechTimer);
  if (duration > 0) speechTimer = setTimeout(() => hideSpeech(), duration);
}
function hideSpeech(immediate) {
  if (!speechEl) return;
  clearTimeout(speechTimer);
  speechEl.classList.remove('is-show');
  if (immediate) speechEl.hidden = true;
  else setTimeout(() => { if (!speechEl.classList.contains('is-show')) speechEl.hidden = true; }, 240);
}
function speakFor(key, text) {
  const now = performance.now();
  if (lastSpeech.key === key && now - lastSpeech.t < 6000) return; // per-line cooldown (§17)
  lastSpeech = { key, t: now };
  showSpeech(text);
}
// Veo (the invisible accessible control over docked Veo) is the return control:
// from a project detail it returns to the projects hub, otherwise to home (§12).
if (homeHit) homeHit.addEventListener('click', () => {
  location.hash = isDetail(currentRoute) ? '#/projects' : '#/';
});

document.querySelectorAll('.veo-year').forEach((el) => { el.textContent = new Date().getFullYear(); });

const ROUTE_TITLE = {
  home: 'Pavel Kolarov | Home', projects: 'Pavel Kolarov | Projects',
  portfolio: 'Pavel Kolarov | Portfolio', experience: 'Pavel Kolarov | Experience',
  contact: 'Pavel Kolarov | Contact',
  'proj-stickers': 'Pavel Kolarov | Stickers Studio',
  'proj-glass': 'Pavel Kolarov | Glass Trading',
  'proj-fleet': 'Pavel Kolarov | Delivery Fleet',
  'proj-personal': 'Pavel Kolarov | Personal Website',
};

function routeFromHash() {
  const h = location.hash.replace(/^#\/?/, '').trim().replace(/\/+$/, '');
  if (h === '') return 'home';
  if (h === 'projects') return 'projects';
  if (h.startsWith('projects/')) return PROJ_SLUGS[h.slice('projects/'.length)] || 'projects';
  return ROUTES.includes(h) ? h : 'home';
}
const isDetail = (r) => DETAIL_ROUTES.includes(r);

function revealCluster(el, items) {
  el.classList.add('is-revealed');
  el.classList.remove('is-selecting');
  items.forEach((it, i) => {
    it.style.transitionDelay = reduceMotion ? '0ms' : `${i * 90}ms`;
    it.classList.add('is-in');
    it.classList.remove('is-selected');
  });
}
function hideCluster(el, items) {
  el.classList.remove('is-revealed', 'is-selecting');
  items.forEach((it) => { it.classList.remove('is-in', 'is-selected'); it.style.transitionDelay = ''; });
}
function revealNav() { revealCluster(navEl, navItems); }
function hideNav() { hideCluster(navEl, navItems); }
function revealProjNav() { revealCluster(projNavEl, projItems); }
function hideProjNav() { hideCluster(projNavEl, projItems); }

let contentHideTimer = null, dockHideTimer = null;
let currentRoute = 'home';
function applyRouteDOM(route) {
  currentRoute = route;
  const isHome = route === 'home';
  const isHub = route === 'projects';          // projects is its own radial hub, not a scroll page
  const isContent = !isHome && !isHub;          // portfolio / experience / contact / project details
  document.body.classList.toggle('veo-route-content', isContent);
  document.body.classList.toggle('veo-route-hub', isHub);
  document.body.classList.toggle('veo-route-home', isHome);
  document.title = ROUTE_TITLE[route] || ROUTE_TITLE.home;

  // hub caption (the return control on the hub is Veo himself - tap him)
  if (hubEl) hubEl.hidden = !isHub;

  clearTimeout(contentHideTimer); clearTimeout(dockHideTimer);
  if (isContent) {
    pages.forEach((p) => { p.hidden = p.dataset.route !== route; });
    contentEl.hidden = false; contentEl.scrollTop = 0;
    dockEl.hidden = false;
    requestAnimationFrame(() => { contentEl.classList.add('is-shown'); dockEl.classList.add('is-shown'); });
  } else {
    contentEl.classList.remove('is-shown');               // crossfade out over the reviving ocean
    contentHideTimer = setTimeout(() => { contentEl.hidden = true; pages.forEach((p) => { p.hidden = true; }); }, 820);
    dockEl.classList.remove('is-shown');
    dockHideTimer = setTimeout(() => { dockEl.hidden = true; }, 520);
  }
  if (homeHit) homeHit.hidden = !isContent; // docked Veo is the return-home control (content only)
  hideSpeech(true);
}

function updateClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  if (dockClock) dockClock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (statusClock) statusClock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
}
updateClock();
setInterval(updateClock, 1000);

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

let scene3d = null;
let initialRoute = routeFromHash();
if (LOCKED_ROUTES.has(initialRoute)) initialRoute = 'home'; // don't open a locked route directly
applyRouteDOM(initialRoute);

applyMoodCSS(computeMood());
setInterval(() => applyMoodCSS(computeMood()), 60000);

if (!webglOK()) {
  document.body.classList.add('veo-no-webgl');
  if (skipBtn) skipBtn.classList.add('is-hidden');
  revealNav(); revealProjNav();   // both clusters shown; route class picks which is visible
} else {
  startExperience(initialRoute);
}

window.addEventListener('hashchange', () => {
  let r = routeFromHash();
  if (LOCKED_ROUTES.has(r)) { // locked: bounce back home
    if (location.hash && location.hash !== '#/') { location.hash = '#/'; return; }
    r = 'home';
  }
  applyRouteDOM(r);
  if (scene3d) scene3d.goRoute(r, true);
});

// ============================================================
// A subtle, broken orbit (faint partial arc segments + a fainter secondary
// ring) with small illuminated node anchors at the menu positions. The nodes
// read before the ring; hovering a node brightens its arc segment (§4, §5).
// Generalized: `keys` places evenly-spaced nodes around the diamond so the
// same ring drives both the home menu and the projects hub.
function createOrbit(scene, { keys = HOME_KEYS, startDeg = 0, scaleMul = 1 } = {}) {
  const D2R = Math.PI / 180;
  const group = new THREE.Group();
  group.rotation.x = -1.02;                 // tilt so the menu orbits Veo in depth
  group.visible = true;
  scene.add(group);
  const R = 2.05;
  const N = keys.length;
  const step = 360 / N;
  const ANG = {};                           // radians, per key
  keys.forEach((k, i) => { ANG[k] = (startDeg + i * step) * D2R; });

  // broken primary orbit: a bright arc centered on each node + a faint
  // connector arc between neighbours (derived from the node layout).
  const segDefs = [];
  keys.forEach((k, i) => {
    const c = startDeg + i * step;
    segDefs.push({ c, len: Math.min(36, step * 0.52), base: 0.085, key: k });        // bright, at the node
    segDefs.push({ c: c + step / 2, len: Math.max(14, step * 0.34), base: 0.04 });    // faint connector
  });
  const segs = segDefs.map((d) => {
    const arc = d.len * D2R;
    const mat = new THREE.MeshBasicMaterial({ color: 0x4dd9cf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 6, 40, arc), mat);
    mesh.rotation.z = d.c * D2R - arc / 2;
    group.add(mesh);
    return { ...d, mat };
  });
  // extremely faint secondary orbit behind it
  const secMat = new THREE.MeshBasicMaterial({ color: 0x3fb8b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const sec = new THREE.Mesh(new THREE.TorusGeometry(R * 1.2, 0.004, 6, 80, Math.PI * 1.4), secMat);
  sec.rotation.z = 0.6;
  group.add(sec);

  const nodes = {};
  for (const k of keys) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ff0e8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), mat);
    mesh.position.set(Math.cos(ANG[k]) * R, Math.sin(ANG[k]) * R, 0);
    group.add(mesh);
    nodes[k] = { mesh, mat, hl: 0, hlTarget: 0, delay: 0 };
  }

  let revealed = false, revealT0 = 0, pulse = 0;

  function setViewport() { group.scale.setScalar(THREE.MathUtils.clamp(window.innerWidth / 1150, 0.6, 1) * scaleMul); }
  setViewport();

  return {
    group,
    reveal() { revealed = true; revealT0 = performance.now(); keys.forEach((k, i) => { nodes[k].delay = 120 + i * 150; }); },
    hide() { revealed = false; for (const k in nodes) nodes[k].hlTarget = 0; },
    highlight(k, on) { if (nodes[k]) nodes[k].hlTarget = on ? 1 : 0; },
    firePulse() { pulse = 0.4; },
    nodeWorld(k) { return nodes[k].mesh.getWorldPosition(new THREE.Vector3()); },
    setViewport,
    update(dt, now) {
      // node glow is drawn in the DOM (centered CSS halo); 3D nodes stay invisible
      // anchors used only for projection + driving segment brightness on hover.
      for (const k in nodes) nodes[k].hl = damp(nodes[k].hl, nodes[k].hlTarget, 6, dt);
      pulse *= Math.exp(-dt * 3);
      for (const s of segs) {
        const hl = s.key ? nodes[s.key].hl : 0;
        const target = revealed ? s.base + hl * 0.3 + pulse * (s.base > 0 ? 1 : 0) : 0;
        s.mat.opacity = damp(s.mat.opacity, target, 4, dt);
      }
      secMat.opacity = damp(secMat.opacity, revealed ? 0.022 : 0, 3, dt);
    },
  };
}

// ============================================================
function startExperience(initial) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  const camBase = new THREE.Vector3(0, 0.25, 6);
  camera.position.copy(camBase);
  camera.lookAt(0, 0, 0);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    document.body.classList.add('veo-no-webgl'); revealNav(); return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);

  const env = createEnvironment(scene, { reducedMotion: reduceMotion, renderer });
  const veo = new Veo({ reducedMotion: reduceMotion });
  scene.add(veo.group);
  const orbit = createOrbit(scene);
  // projects ring is laid out exactly like the home ring (centred, same scale)
  const projOrbit = createOrbit(scene, { keys: ['glass', 'stickers', 'personal', 'fleet'], startDeg: 0 });
  projOrbit.group.visible = false;

  // ---- post-processing: a restrained UnrealBloom so turquoise highlights,
  //      the key accent and drifting particles glow (premium finish). Only on
  //      showcase routes (home + hub), where the backdrop is opaque. ----
  const lowPower = window.innerWidth < 760 || reduceMotion;
  let composer = null, useComposer = false;
  try {
    if (!lowPower) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.72));
      composer.addPass(new OutputPass());
      composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      composer.setSize(window.innerWidth, window.innerHeight);
    }
  } catch { composer = null; }
  const setComposer = (on) => { useComposer = !!(on && composer); };

  const applyMood = () => { const m = computeMood(); env.setMood(m); applyMoodCSS(m); };
  applyMood();
  setInterval(applyMood, 60000);

  // ---------- dock world position ----------
  const raycaster = new THREE.Raycaster();
  const dockPlane = new THREE.Plane();
  const _v = new THREE.Vector3();
  function dockWorldPos() {
    const small = window.innerWidth < 640;
    const nx = small ? 0.5 : 0.84, ny = small ? -0.4 : -0.58;
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    dockPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0.8));
    raycaster.ray.intersectPlane(dockPlane, _v);
    return _v.clone();
  }

  // ---------- transitions ----------
  let docked = false, tween = null, introActive = false;
  const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  function tweenTo(toPos, toScale, state, onDone) {
    tween = { fromPos: veo.group.position.clone(), fromScale: veo.group.scale.x, toPos: toPos.clone(), toScale, t0: performance.now(), dur: reduceMotion ? 220 : 1100, onDone };
    veo.setState(state);
  }

  // Long "swim to another page" traversal: Veo swims off one side, the ring is
  // swapped while he's off-screen, then he swims in from the far side to the
  // centre - like paging to a new screen. `dir` = -1 swims left, +1 swims right.
  function travelSwim(dir, toPos, toScale, onArrive, onDone) {
    const off = 5.8;
    const exitPos = new THREE.Vector3(dir * off, 0.18, 0.2);
    const enterPos = new THREE.Vector3(-dir * off, 0.18, 0.2);
    veo.setState(State.SWIMMING);
    tween = {
      fromPos: veo.group.position.clone(), fromScale: veo.group.scale.x,
      toPos: exitPos, toScale, t0: performance.now(), dur: reduceMotion ? 180 : 640,
      onDone: () => {
        veo.group.position.copy(enterPos);     // reappear on the far side = the new page
        veo.group.scale.setScalar(toScale);
        if (onArrive) onArrive();               // the new ring blooms as he swims back in
        veo.setState(State.SWIMMING);
        tween = {
          fromPos: enterPos.clone(), fromScale: toScale,
          toPos: toPos.clone(), toScale, t0: performance.now(), dur: reduceMotion ? 200 : 900,
          onDone,
        };
      },
    };
  }

  function goRoute(route, animate) {
    introActive = false;
    if (skipBtn) skipBtn.classList.add('is-hidden');
    const isHome = route === 'home';
    const isHub = route === 'projects';          // projects is its own radial hub
    const isAtrium = isHome || isHub;

    // reset both clusters; the right one is revealed once Veo has settled
    hideNav(); hideProjNav(); orbit.hide(); projOrbit.hide();

    if (isAtrium) {
      env.setAmbient(1); env.setShowcase(true); setComposer(true);   // living ocean + bloom
      // the new ring blooms (centred, home-aligned) as Veo swims into the page
      const showRing = () => {
        orbit.group.visible = isHome;
        projOrbit.group.visible = isHub;
        if (isHome) { revealNav(); orbit.reveal(); }
        else { revealProjNav(); projOrbit.reveal(); }
      };
      if (animate) {                              // Veo swims right across to the next page
        const dir = isHub ? -1 : 1;               // to projects = swim left; back home = swim right
        travelSwim(dir, REST_POS, REST_SCALE, showRing, () => veo.setState(State.IDLE));
        if (isHome && docked && introSeen) setTimeout(() => speakFor('back', VEO_DIALOGUE.back), reduceMotion ? 300 : 1300);
        if (isHub) setTimeout(() => speakFor('hub', VEO_DIALOGUE.hub), reduceMotion ? 300 : 1500);
      } else {                                    // direct load / no animation
        veo.group.position.copy(REST_POS); veo.group.scale.setScalar(REST_SCALE);
        veo.setState(State.IDLE); showRing();
      }
      docked = false;
    } else {
      env.setAmbient(0); env.setShowcase(false); setComposer(false); // scene settles/crossfades out
      orbit.group.visible = false; projOrbit.group.visible = false;
      const dp = dockWorldPos();
      if (animate && !docked) {
        tweenTo(dp, DOCK_SCALE, State.DOCKING, () => { veo.setState(State.IDLE); });
      } else {
        veo.group.position.copy(dp); veo.group.scale.setScalar(DOCK_SCALE); veo.setState(State.IDLE);
      }
      docked = true;
    }
  }

  // ---------- intro ----------
  const skipIntro = reduceMotion || introSeen || forceSkip;
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  let greeted = false, navRevealed = false, introStart = null;
  let introSpoke1 = false, introSpoke2 = false;
  function finishIntro() {
    introActive = false;
    veo.group.position.copy(REST_POS); veo.group.scale.setScalar(REST_SCALE);
    veo.setState(State.IDLE);
    if (!navRevealed) { revealNav(); orbit.reveal(); navRevealed = true; }
    if (skipBtn) skipBtn.classList.add('is-hidden');
    try { sessionStorage.setItem('veoIntroSeen', '1'); } catch { /* ignore */ }
  }
  function updateIntro(elapsed) {
    if (!introActive) return;
    if (elapsed < 0.6) return;
    const p = Math.min(1, (elapsed - 0.6) / 1.2), e = easeOut(p);
    const x = THREE.MathUtils.lerp(START_POS.x, REST_POS.x, e) + Math.sin(p * Math.PI) * 0.6 * (1 - e);
    const y = THREE.MathUtils.lerp(START_POS.y, REST_POS.y, e) + Math.sin(elapsed * 6) * 0.04 * (1 - e);
    const z = THREE.MathUtils.lerp(START_POS.z, REST_POS.z, e);
    veo.group.position.set(x, y, z);
    veo.group.scale.setScalar(THREE.MathUtils.lerp(0.3, REST_SCALE, e));
    if (elapsed >= 1.8 && !greeted) { greeted = true; veo.greet(); }
    if (elapsed >= 2.0 && !introSpoke1) { introSpoke1 = true; showSpeech(VEO_DIALOGUE.intro[0], 2400); } // "Hi! I'm Veo."
    if (elapsed >= 2.6 && !navRevealed) { revealNav(); orbit.reveal(); navRevealed = true; }
    if (elapsed >= 3.7 && !introSpoke2) { introSpoke2 = true; showSpeech(VEO_DIALOGUE.intro[1], 3000); } // "I'll show you around."
    if (elapsed >= 3.9) finishIntro();
  }

  if (initial === 'home') {
    if (skipIntro) { goRoute('home', false); }
    else {
      introActive = true;
      env.setShowcase(true); setComposer(true);   // bloom + backdrop during the cinematic
      veo.group.position.copy(START_POS); veo.group.scale.setScalar(0.3);
      veo.setState(State.SWIMMING);
    }
  } else { goRoute(initial, false); }
  if (skipBtn) skipBtn.addEventListener('click', () => { if (introActive) finishIntro(); });

  // ---------- pointer interaction (§6) + camera parallax target ----------
  const ndc = new THREE.Vector2();
  const restPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const planeHit = new THREE.Vector3();
  const camPointer = new THREE.Vector2(0, 0);
  const camOffset = new THREE.Vector2(0, 0);
  let gesture = null;

  const setNDC = (ev) => {
    ndc.x = (ev.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  };
  const hitsVeo = () => { raycaster.setFromCamera(ndc, camera); return raycaster.intersectObjects(veo.hitTargets, false).length > 0; };
  const pointerWorld = () => { raycaster.setFromCamera(ndc, camera); raycaster.ray.intersectPlane(restPlane, planeHit); return planeHit; };
  const refLen = () => 0.22 * Math.min(window.innerWidth, window.innerHeight);

  window.addEventListener('pointermove', (ev) => {
    setNDC(ev);
    camPointer.set(ndc.x, ndc.y);
    if (!gesture) veo.setPointer(pointerWorld()); // passive mouse-follow (§2)
    if (gesture) {
      const dx = ev.clientX - gesture.lastX, dy = ev.clientY - gesture.lastY;
      gesture.path += Math.hypot(dx, dy);
      veo.dragBy(dx / window.innerWidth, dy / window.innerHeight); // drag rotates Veo
      const ang = Math.atan2(dy, dx);
      if (gesture.lastAng !== null) { let da = Math.abs(ang - gesture.lastAng); if (da > Math.PI) da = Math.PI * 2 - da; if (da > 1.9) gesture.jerk++; }
      gesture.lastAng = ang; gesture.lastX = ev.clientX; gesture.lastY = ev.clientY;
    }
  });
  window.addEventListener('pointerdown', (ev) => { setNDC(ev); if (!docked && hitsVeo()) { gesture = { t0: performance.now(), lastX: ev.clientX, lastY: ev.clientY, lastAng: null, path: 0, jerk: 0 }; veo.beginDrag(); } });
  window.addEventListener('pointerup', () => {
    if (!gesture) return;
    veo.endDrag();
    const dur = performance.now() - gesture.t0, norm = gesture.path / refLen();
    const smooth = THREE.MathUtils.clamp(1 - gesture.jerk * 0.18, 0.2, 1);
    if (dur >= 180 && norm >= 0.28) veo.pet(THREE.MathUtils.clamp(norm, 0.3, 1.2) * smooth);
    else if (dur < 260 && norm < 0.2) {
      if (currentRoute === 'projects') location.hash = '#/';   // on the hub, a tap on Veo returns home
      else veo.tap();
    }
    else if (norm >= 0.12) veo.pet(0.4 * smooth);
    gesture = null;
  });
  window.addEventListener('pointercancel', () => { gesture = null; });
  window.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget) veo.clearPointer(); });
  window.addEventListener('blur', () => veo.clearPointer());

  // ---------- nav: hover acknowledgement + selection choreography (§4) ----------
  // Shared by the home menu (internal routes) and the projects hub (external
  // project links). External items just open their link; internal items run the
  // dim-the-others selection choreography before the route changes.
  function wireNavCluster(el, items, orbitRef, { keyAttr, dialogue, external }) {
    items.forEach((item) => {
      const key = item.dataset[keyAttr];
      let hoverTimer = null;
      const locked = !external && LOCKED_ROUTES.has(key);
      const speechKey = external ? `proj-${key}` : (locked ? 'locked' : key);
      const focusOn = () => {
        if (!introActive && !docked) veo.setNav(orbitRef.nodeWorld(key)); // turn toward it now
        orbitRef.highlight(key, true);
        clearTimeout(hoverTimer);
        const line = locked ? VEO_DIALOGUE.locked : dialogue[key];
        hoverTimer = setTimeout(() => { if (line) speakFor(speechKey, line); }, 420); // comment after intent (§15)
      };
      const focusOff = () => { veo.clearNav(); orbitRef.highlight(key, false); clearTimeout(hoverTimer); };
      item.addEventListener('mouseenter', focusOn);
      item.addEventListener('mouseleave', focusOff);
      item.addEventListener('focus', focusOn);
      item.addEventListener('blur', focusOff);
      item.addEventListener('click', (ev) => {
        if (locked) { ev.preventDefault(); clearTimeout(hoverTimer); speakFor('locked', VEO_DIALOGUE.locked); return; }
        clearTimeout(hoverTimer);
        if (external) {                      // let the link open (new tab); just acknowledge
          orbitRef.highlight(key, true); orbitRef.firePulse(); veo.pet(0.12);
          return;
        }
        hideSpeech();
        el.classList.add('is-selecting');
        items.forEach((o) => o.classList.toggle('is-selected', o === item));
        orbitRef.highlight(key, true); orbitRef.firePulse();
        veo.setNav(orbitRef.nodeWorld(key)); // orient toward the selection before docking
      });
    });
  }
  wireNavCluster(navEl, navItems, orbit, { keyAttr: 'route', dialogue: VEO_DIALOGUE, external: false });
  wireNavCluster(projNavEl, projItems, projOrbit, { keyAttr: 'proj', dialogue: PROJ_DIALOGUE, external: false });

  // docked Veo notices the cursor over his hit area and offers to go back (§29)
  if (homeHit) homeHit.addEventListener('mouseenter', () => { veo.pet(0.15); speakFor('returnHome', VEO_DIALOGUE.returnHome); });

  // ---------- resize ----------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (composer) { composer.setSize(window.innerWidth, window.innerHeight); composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); }
    orbit.setViewport(); projOrbit.setViewport();
    if (docked && !tween) veo.group.position.copy(dockWorldPos());
  });

  // ---------- projected nav positions ----------
  const _p = new THREE.Vector3();
  const _wp = new THREE.Vector3();
  function projectCluster(items, orbitRef, keyAttr) {
    for (const item of items) {
      _p.copy(orbitRef.nodeWorld(item.dataset[keyAttr])).project(camera);
      item.style.left = `${(_p.x * 0.5 + 0.5) * window.innerWidth}px`;
      item.style.top = `${(-_p.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }
  function updateNavPositions() {
    if (navEl.classList.contains('is-revealed')) projectCluster(navItems, orbit, 'route');
    if (projNavEl.classList.contains('is-revealed')) projectCluster(projItems, projOrbit, 'proj');
  }

  // ---------- render loop ----------
  scene3d = { goRoute };
  let last = performance.now(), ready = false;
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    if (introStart === null) introStart = now;
    if (introActive) updateIntro((now - introStart) / 1000);

    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.dur), e = easeInOut(k);
      veo.group.position.lerpVectors(tween.fromPos, tween.toPos, e);
      veo.group.scale.setScalar(THREE.MathUtils.lerp(tween.fromScale, tween.toScale, e));
      veo.group.position.y += Math.sin(e * Math.PI) * 0.45;
      if (k >= 1) { const done = tween.onDone; tween = null; done && done(); }
    }

    // subtle camera life (§10): breathing + gentle pointer parallax
    if (!reduceMotion) {
      camOffset.x = damp(camOffset.x, camPointer.x * 0.32, 2.5, dt);
      camOffset.y = damp(camOffset.y, camPointer.y * 0.2, 2.5, dt);
      camera.position.set(
        camBase.x + camOffset.x + Math.sin(now * 0.00031) * 0.05,
        camBase.y + camOffset.y + Math.sin(now * 0.0004) * 0.035,
        camBase.z);
      camera.lookAt(0, 0, 0);
    }

    veo.update(dt, now);
    env.update(dt, now);
    orbit.update(dt, now);
    projOrbit.update(dt, now);
    updateNavPositions();
    // track Veo on screen for the speech bubble
    veo.group.getWorldPosition(_wp).project(camera);
    veoScreen.x = (_wp.x * 0.5 + 0.5) * window.innerWidth;
    veoScreen.y = (-_wp.y * 0.5 + 0.5) * window.innerHeight;
    positionSpeech();
    if (useComposer && composer) composer.render(); else renderer.render(scene, camera);
    if (!ready) { ready = true; stage.classList.add('is-ready'); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
