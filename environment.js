import * as THREE from 'three';

/* ============================================================
   Deep underwater world (polish spec §2 - §8).
   Layered for depth: a hazy seabed with soft contour, desaturated
   coral silhouettes and rocks receding into fog, faint top-down
   light shafts, and soft particles (dust, bubbles, near bokeh).
   Cinematic 3-point lighting with a weak fill (darker underside)
   and slow moving light variation. Deep navy / dark teal / muted
   cyan only - not a bright aquarium.

   Everything decorative lives in `group` so the orchestrator can
   hide it on content routes. Lights are on the scene so Veo stays
   lit while docked. Geometry counts scale down on small screens.
   ============================================================ */

const OCEAN_DEEP = 0x081522;
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

function softDot() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// vertical gradient canvas -> texture (used for the backdrop + IBL environment)
function gradientTexture(stops, w = 16, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// cinematic screen-space backdrop: deep ocean with a soft central light bloom
function backdropTexture() {
  const s = 1024, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 0, s);
  lin.addColorStop(0, '#0a1d2b');
  lin.addColorStop(0.5, '#071521');
  lin.addColorStop(1, '#03080f');
  g.fillStyle = lin; g.fillRect(0, 0, s, s);
  const rad = g.createRadialGradient(s * 0.5, s * 0.4, 0, s * 0.5, s * 0.4, s * 0.6);
  rad.addColorStop(0, 'rgba(77,217,207,0.13)');
  rad.addColorStop(0.5, 'rgba(60,170,180,0.04)');
  rad.addColorStop(1, 'rgba(77,217,207,0)');
  g.fillStyle = rad; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createEnvironment(scene, { reducedMotion = false, renderer = null } = {}) {
  const lowPower = window.innerWidth < 760 || reducedMotion;
  scene.fog = new THREE.FogExp2(OCEAN_DEEP, 0.052);

  // ---- image-based lighting: subtle teal IBL so Veo's PBR material gets
  //      believable, directional reflections (premium sheen) ----
  const backdrop = backdropTexture();
  if (renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envSrc = gradientTexture([
        [0.0, '#dff6f1'], [0.28, '#8fd8d2'], [0.55, '#2f6f74'], [1.0, '#071722'],
      ]);
      envSrc.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = pmrem.fromEquirectangular(envSrc).texture;
      envSrc.dispose(); pmrem.dispose();
    } catch { /* IBL is a nicety; ignore if unsupported */ }
  }
  // Showcase routes (home + projects hub) use an opaque cinematic backdrop so
  // bloom reads richly; content routes clear it for the transparent floating Veo.
  function setShowcase(on) { scene.background = on ? backdrop : null; }

  // ---- cinematic 3-point lighting (§6) ----
  const hemi = new THREE.HemisphereLight(0x2c5a6b, 0x04101a, 0.45); // weak fill -> darker underside
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xe6f6f0, 2.4);            // soft key, upper/front
  key.position.set(1.2, 6, 3.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4dd9cf, 2.0);            // turquoise rim
  rim.position.set(-4.5, 1.0, -3.5);
  scene.add(rim);
  const accent = new THREE.PointLight(0x5fe3da, 5, 18, 2);
  accent.position.set(1.5, 2.0, 3.5);
  scene.add(accent);
  const base = { hemi: 0.45, key: 2.4, rim: 2.0, accent: 4.2 };
  let moodAccentMul = 1, moodParticleMul = 1;

  const group = new THREE.Group();
  scene.add(group);

  // ---- hazy seabed with soft contour (§7) ----
  const seabedGeo = new THREE.PlaneGeometry(90, 60, lowPower ? 12 : 28, lowPower ? 8 : 18);
  const sp = seabedGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i);
    const h = Math.sin(x * 0.18) * 0.6 + Math.cos(y * 0.22 + 1.3) * 0.5 + Math.sin((x + y) * 0.1) * 0.4;
    sp.setZ(i, h);
  }
  seabedGeo.computeVertexNormals();
  const seabed = new THREE.Mesh(seabedGeo, new THREE.MeshStandardMaterial({
    color: 0x071a27, emissive: 0x06161f, emissiveIntensity: 0.3, roughness: 1, metalness: 0, envMapIntensity: 0.15,
  }));
  seabed.rotation.x = -Math.PI / 2 + 0.12;
  seabed.position.set(0, -3.6, -6);
  group.add(seabed);

  // ---- desaturated coral silhouettes + rocks (§2, §3) ----
  const coralMat = new THREE.MeshStandardMaterial({ color: 0x123a3d, emissive: 0x0c2a2e, emissiveIntensity: 0.35, roughness: 0.95, metalness: 0.1, envMapIntensity: 0.15 });
  const branchGeo = new THREE.CapsuleGeometry(0.06, 1, 4, 8);
  function makeCoral() {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(branchGeo, coralMat);
      const hgt = 0.7 + Math.random() * 1.6;
      b.scale.set(0.6 + Math.random() * 0.8, hgt, 0.6 + Math.random() * 0.8);
      b.position.set((Math.random() - 0.5) * 0.9, hgt * 0.5, (Math.random() - 0.5) * 0.6);
      b.rotation.z = (Math.random() - 0.5) * 0.7;
      b.rotation.x = (Math.random() - 0.5) * 0.4;
      g.add(b);
    }
    return g;
  }
  const coralSpots = lowPower
    ? [[-7, -11, 1.4], [7.5, -12, 1.6], [0, -16, 2.0]]
    : [[-7, -9, 1.1], [8, -10, 1.3], [-11, -13, 1.6], [11, -14, 1.7], [-4, -16, 1.9], [4, -17, 2.0], [0, -20, 2.4]];
  for (const [x, z, s] of coralSpots) {
    const c = makeCoral();
    c.position.set(x, -3.4, z);
    c.scale.setScalar(s);
    group.add(c);
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0a2230, emissive: 0x081a24, emissiveIntensity: 0.3, roughness: 1, metalness: 0.05, flatShading: true, envMapIntensity: 0.15 });
  for (const [x, z, s] of [[-5, -8, 1.1], [6, -9, 1.3], [-9, -12, 1.8], [2, -14, 1.6]]) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    rock.position.set(x, -3.8, z);
    rock.scale.y = 0.55;
    rock.rotation.y = Math.random() * Math.PI;
    group.add(rock);
  }

  // ---- faint top-down light shafts (§6) ----
  const shafts = [];
  const shaftMat = () => new THREE.MeshBasicMaterial({ color: 0x45cfc4, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  for (const [x, z, r, rot] of [[0.5, -2, 5, 0.1], [-5, -6, 3.5, -0.2], [6, -8, 4, 0.25]]) {
    const sh = new THREE.Mesh(new THREE.ConeGeometry(r, 16, 24, 1, true), shaftMat());
    sh.position.set(x, 7, z); sh.rotation.z = rot;
    group.add(sh); shafts.push(sh);
  }

  // ---- particles: dust + near bokeh + bubbles (§8) ----
  const dot = softDot();
  function makePoints(count, spread, size, opacity, color, zBias, speed) {
    const pos = new Float32Array(count * 3), spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread.x;
      pos[i * 3 + 1] = (Math.random() - 0.5) * spread.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread.z + zBias;
      spd[i] = speed * (0.5 + Math.random());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: dot, color, size, transparent: true, opacity, depthWrite: false,
      sizeAttenuation: true, blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Points(geo, mat));
    return { geo, spd, spread, count, mat, baseOpacity: opacity };
  }
  const dust = makePoints(lowPower ? 180 : 400, { x: 22, y: 15, z: 22 }, 0.075, 0.4, 0xa6ded8, -4, 0.22);
  const near = lowPower ? null : makePoints(16, { x: 14, y: 9, z: 4 }, 0.55, 0.1, 0xbfeae6, 4.6, 0.12);

  const BCOUNT = lowPower ? 22 : 46;
  const bPos = new Float32Array(BCOUNT * 3), bSpd = new Float32Array(BCOUNT);
  const resetBubble = (i) => {
    bPos[i * 3] = (Math.random() - 0.5) * 12;
    bPos[i * 3 + 1] = -7 - Math.random() * 3;
    bPos[i * 3 + 2] = (Math.random() - 0.5) * 9 - 1;
    bSpd[i] = 0.45 + Math.random() * 1.0;
  };
  for (let i = 0; i < BCOUNT; i++) resetBubble(i);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  const bubblesMat = new THREE.PointsMaterial({
    map: dot, color: 0xb6e9e8, size: 0.12, transparent: true, opacity: 0.28,
    depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(bGeo, bubblesMat));
  const bubbleBase = 0.28;

  // Materials faded together during home<->inner transitions. The canvas stays
  // mounted; we crossfade the animated ocean out as inner content fades in (§9-§13).
  const fadeables = [];
  const reg = (mat, baseOp) => { mat.transparent = true; mat.opacity = baseOp; fadeables.push({ mat, baseOp }); };
  reg(seabed.material, 1); reg(coralMat, 1); reg(rockMat, 1);
  reg(dust.mat, dust.baseOpacity); if (near) reg(near.mat, near.baseOpacity); reg(bubblesMat, bubbleBase);
  let ambient = 1, ambientTarget = 1;

  function driftPoints(p, dt, now) {
    if (!p) return;
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < p.count; i++) {
      a[i * 3 + 1] += p.spd[i] * dt;
      a[i * 3] += Math.sin(now * 0.0003 + i) * dt * 0.04;
      if (a[i * 3 + 1] > p.spread.y / 2) a[i * 3 + 1] = -p.spread.y / 2;
    }
    p.geo.attributes.position.needsUpdate = true;
  }

  function update(dt, now) {
    // crossfade: ease ambient and apply to all fadeable materials + visibility
    ambient = damp(ambient, ambientTarget, 3.4, dt);
    for (const f of fadeables) f.mat.opacity = f.baseOp * ambient;
    group.visible = ambient > 0.015 || ambientTarget > 0.015;
    if (reducedMotion) return;

    const a = ambient; // motion also slows as the scene settles (§11)
    driftPoints(dust, dt * a, now);
    driftPoints(near, dt * 0.4 * a, now);
    const ba = bGeo.attributes.position.array;
    for (let i = 0; i < BCOUNT; i++) {
      ba[i * 3 + 1] += bSpd[i] * dt * a;
      ba[i * 3] += Math.sin(now * 0.001 + i) * dt * 0.12 * a;
      if (ba[i * 3 + 1] > 7) resetBubble(i);
    }
    bGeo.attributes.position.needsUpdate = true;
    key.position.x = 1.2 + Math.sin(now * 0.0002) * 1.2 * a;
    accent.intensity = (base.accent + Math.sin(now * 0.0007) * 1.3 * a) * moodAccentMul;
    for (let i = 0; i < shafts.length; i++) {
      shafts[i].material.opacity = (0.03 + (Math.sin(now * 0.0004 + i) * 0.5 + 0.5) * 0.03) * a;
    }
  }
  function setAmbient(t) { ambientTarget = Math.max(0, Math.min(1, t)); }

  // time-of-day mood (§7): modulate brightness, fog and particles - subtle
  function setMood(m) {
    hemi.intensity = base.hemi * m.hemiMul;
    key.intensity = base.key * m.keyMul;
    rim.intensity = base.rim * m.rimMul;
    moodAccentMul = m.accentMul;
    moodParticleMul = m.particleMul;
    scene.fog.density = m.fogDensity;
    scene.fog.color.setHex(m.fogColor);
    // particle opacity is driven by the ambient crossfade, not mood, to avoid conflicts
  }

  return { update, accent, group, setMood, setAmbient, setShowcase };
}
