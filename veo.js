import * as THREE from 'three';

/* ============================================================
   Veo - premium stylized procedural fish
   Rounded, slightly compact body with a subtle arch and a soft
   belly curve; flowing translucent fins; embedded expressive
   eyes and a believable mouth. Satin/pearlescent PBR material
   with a faint vertical gradient - lit by the environment, not
   self-glowing. Living idle motion (tail, fins, bob, glances,
   eye darts) with randomized timing (spec §1, §13).

   Public API is unchanged: Veo, State, .group, .update(dt,now),
   .pet(), .tap(), .lookToward(), .clearLook(), .greet(),
   .setState(), .hitTargets.
   ============================================================ */

export const State = {
  IDLE: 'IDLE', SWIMMING: 'SWIMMING', GREETING: 'GREETING', CURIOUS: 'CURIOUS',
  HAPPY: 'HAPPY', VERY_HAPPY: 'VERY_HAPPY', ANNOYED: 'ANNOYED', RECOVERING: 'RECOVERING',
  DOCKING: 'DOCKING', UNDOCKING: 'UNDOCKING',
};

// Target posture/motion per state. Emissive is kept low - the scene lights Veo.
const STATE_PARAMS = {
  IDLE:       { swimAmp: 0.05,  swimSpeed: 2.0, finSpread: 0.42, tilt: 0.0,   yawBias: 0.0, emissive: 0.10, bob: 0.035 },
  SWIMMING:   { swimAmp: 0.16,  swimSpeed: 6.0, finSpread: 0.30, tilt: 0.0,   yawBias: 0.0, emissive: 0.10, bob: 0.02 },
  GREETING:   { swimAmp: 0.07,  swimSpeed: 2.8, finSpread: 0.58, tilt: 0.05,  yawBias: 0.0, emissive: 0.16, bob: 0.035 },
  CURIOUS:    { swimAmp: 0.06,  swimSpeed: 2.5, finSpread: 0.46, tilt: 0.02,  yawBias: 0.0, emissive: 0.12, bob: 0.035 },
  HAPPY:      { swimAmp: 0.09,  swimSpeed: 3.3, finSpread: 0.72, tilt: 0.06,  yawBias: 0.0, emissive: 0.20, bob: 0.05 },
  VERY_HAPPY: { swimAmp: 0.13,  swimSpeed: 4.1, finSpread: 0.88, tilt: 0.05,  yawBias: 0.0, emissive: 0.26, bob: 0.06 },
  ANNOYED:    { swimAmp: 0.12,  swimSpeed: 4.4, finSpread: 0.20, tilt: -0.05, yawBias: 0.9, emissive: 0.07, bob: 0.02 },
  RECOVERING: { swimAmp: 0.06,  swimSpeed: 2.4, finSpread: 0.40, tilt: 0.0,   yawBias: 0.0, emissive: 0.11, bob: 0.035 },
  DOCKING:    { swimAmp: 0.15,  swimSpeed: 5.8, finSpread: 0.30, tilt: 0.0,   yawBias: 0.0, emissive: 0.10, bob: 0.02 },
  UNDOCKING:  { swimAmp: 0.15,  swimSpeed: 5.8, finSpread: 0.30, tilt: 0.0,   yawBias: 0.0, emissive: 0.10, bob: 0.02 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// scratch objects reused each frame
const _tmpV = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _qTarget = new THREE.Quaternion();
const _qExtra = new THREE.Quaternion();
const _eulA = new THREE.Euler(0, 0, 0, 'YXZ');
const _eulB = new THREE.Euler(0, 0, 0, 'XYZ');

// Veo's local forward axis is +Z (head). Pitch is limited; yaw is free (full 360).
const PITCH_LIMIT = 0.5;

export class Veo {
  constructor({ reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    this.bodyPivot = new THREE.Group();
    this.group.add(this.bodyPivot);

    this.emotion = { happiness: 0, irritation: 0, curiosity: 0 };
    this._tapTimes = [];
    this._lastInteraction = 0;
    this._scriptedUntil = 0;

    this.state = State.IDLE;
    this.params = { ...STATE_PARAMS.IDLE };
    this._phase = 0;
    // look targets: passive mouse-follow (soft) and nav-item focus (strong)
    this._pointerTarget = new THREE.Vector3(0, 0, 6);
    this._pointerActive = false;
    this._navTarget = new THREE.Vector3(0, 0, 6);
    this._navActive = false;
    this._eyeAimX = 0; this._eyeAimY = 0;
    // whole-body orientation driven by a quaternion that slerps toward a
    // world-space target (§2-§5). Veo turns his whole body, not just his gaze.
    this._idleBaseYaw = -0.55; // resting 3/4 profile; turns toward the pointer when engaged
    this._coreQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this._idleBaseYaw, 0, 'YXZ'));
    this._curYaw = this._idleBaseYaw; this._curPitch = 0; this._prevYaw = this._idleBaseYaw;
    this._lastAngleToTarget = 0;
    this._flapUntil = 0; this._flapStrength = 0; // tail flap when turning (§6)
    this._extraRoll = 0;
    this._bankRoll = 0;
    // manual drag-to-inspect orientation (with inertia + return to idle)
    this._manual = { active: false, yaw: this._idleBaseYaw, pitch: 0, velYaw: 0, velPitch: 0, lastInput: -1e9 };

    // idle behaviour state
    this._idleYaw = 0; this._idlePitch = 0;
    this._idleEye = new THREE.Vector2(0, 0);
    this._idleDrift = new THREE.Vector3(0, 0, 0);
    this._nextIdle = 0;

    this._build();
  }

  _build() {
    this._buildBody();
    this._buildFins();
    this._buildFace();
    this._buildMouth();
  }

  // compact, elegant silhouette: belly peaks ~0.6, rounded head, soft tail
  _radiusProfile(t) {
    const peak = 0.60;
    if (t <= peak) {
      return 0.46 * (0.06 + 0.94 * Math.pow(Math.sin((t / peak) * Math.PI * 0.5), 0.78));
    }
    const tt = (t - peak) / (1 - peak);
    const smooth = tt * tt * (3 - 2 * tt);
    return 0.46 * (1.0 - 0.64 * smooth);
  }

  _buildBody() {
    const RINGS = 52, SEG = 26;
    const zTail = -1.2, zHead = 1.05;
    const widthScale = 0.70, heightScale = 1.22;

    const positions = [], colors = [], uParam = [], indices = [];
    const cDeep = new THREE.Color(0x2fb2a8);   // belly / deeper turquoise
    const cMid  = new THREE.Color(0x4dd9cf);    // Veo turquoise
    const cTop  = new THREE.Color(0xc4f1ec);    // lighter back highlight
    const tmp = new THREE.Color();

    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS;
      const z = zTail + (zHead - zTail) * t;
      const r = this._radiusProfile(t);
      const centerY = -0.16 * Math.sin(Math.min(1, t) * Math.PI); // soft belly curve
      for (let j = 0; j < SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const x = Math.cos(a) * r * widthScale;
        const y = Math.sin(a) * r * heightScale + centerY;
        positions.push(x, y, z);
        uParam.push(t);
        // vertical gradient: deep belly -> mid -> light back
        const g = clamp((y + 0.5) / 1.0, 0, 1);
        if (g < 0.5) tmp.copy(cDeep).lerp(cMid, g * 2);
        else tmp.copy(cMid).lerp(cTop, (g - 0.5) * 2);
        colors.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = i * SEG + j, b = i * SEG + ((j + 1) % SEG);
        const c = (i + 1) * SEG + j, d = (i + 1) * SEG + ((j + 1) % SEG);
        indices.push(a, c, d, a, d, b);
      }
    }
    const tailTip = positions.length / 3;
    positions.push(0, -0.16, zTail - 0.03); uParam.push(0); colors.push(cDeep.r, cDeep.g, cDeep.b);
    const headTip = positions.length / 3;
    positions.push(0, -0.06, zHead + 0.2); uParam.push(1); colors.push(cMid.r, cMid.g, cMid.b);
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      indices.push(tailTip, j2, j);
      indices.push(headTip, RINGS * SEG + j, RINGS * SEG + j2);
    }

    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(uParam), 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    this._basePositions = Float32Array.from(posArr);
    this._uParam = Float32Array.from(uParam);
    this._bodyGeo = geo;

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, color: 0xffffff,
      roughness: 0.34, metalness: 0.0,
      clearcoat: 1.0, clearcoatRoughness: 0.28,
      sheen: 0.85, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xbdf1ea),
      iridescence: 0.5, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 440],
      envMapIntensity: 0.9,
      emissive: new THREE.Color(0x0a3330), emissiveIntensity: 0.1,
    });
    this.bodyMesh = new THREE.Mesh(geo, this.bodyMat);
    this.bodyMesh.name = 'veo-body';
    this.bodyPivot.add(this.bodyMesh);
  }

  _finMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x9fe6df, roughness: 0.32, metalness: 0.0,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      clearcoat: 0.5, clearcoatRoughness: 0.4,
      iridescence: 0.6, iridescenceIOR: 1.25,
      envMapIntensity: 1.1,
      sheen: 0.6, sheenColor: new THREE.Color(0xbff0eb),
      emissive: new THREE.Color(0x0f3f3b), emissiveIntensity: 0.14,
    });
  }

  // a smooth fin from a 2D Shape (XY), kept thin; rotated into place by caller
  _shapeFin(shape, mat) {
    const geo = new THREE.ShapeGeometry(shape, 24);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  _buildFins() {
    const mat = this._finMaterial();

    // Caudal (tail): smooth forked lobes. Local +x = backward, y = vertical.
    const tail = new THREE.Shape();
    tail.moveTo(0, 0.12);
    tail.bezierCurveTo(0.35, 0.28, 0.6, 0.5, 0.82, 0.6);
    tail.bezierCurveTo(0.6, 0.3, 0.55, 0.12, 0.5, 0.0);
    tail.bezierCurveTo(0.55, -0.12, 0.6, -0.3, 0.82, -0.6);
    tail.bezierCurveTo(0.6, -0.5, 0.35, -0.28, 0, -0.12);
    tail.closePath();
    const caudalMesh = this._shapeFin(tail, mat);
    caudalMesh.rotation.y = Math.PI / 2;      // local +x -> world -Z (behind)
    this.caudal = new THREE.Group();
    this.caudal.position.set(0, -0.02, -1.2);
    this.caudal.add(caudalMesh);
    this.bodyPivot.add(this.caudal);

    // Dorsal sail (top). Local x = along body length, y = up.
    const dorsal = new THREE.Shape();
    dorsal.moveTo(-0.5, 0);
    dorsal.bezierCurveTo(-0.3, 0.34, 0.0, 0.46, 0.16, 0.4);
    dorsal.bezierCurveTo(0.28, 0.24, 0.34, 0.08, 0.42, 0);
    dorsal.closePath();
    const dorsalMesh = this._shapeFin(dorsal, mat);
    dorsalMesh.rotation.y = Math.PI / 2;
    dorsalMesh.position.set(0, 0.34, -0.1);
    this.bodyPivot.add(dorsalMesh);

    // Pelvic/anal hint (bottom).
    const pelvic = new THREE.Shape();
    pelvic.moveTo(0, 0);
    pelvic.bezierCurveTo(0.1, -0.22, 0.26, -0.28, 0.34, -0.2);
    pelvic.bezierCurveTo(0.22, -0.12, 0.12, -0.05, 0, 0);
    pelvic.closePath();
    const pelvicMesh = this._shapeFin(pelvic, mat);
    pelvicMesh.rotation.y = Math.PI / 2;
    pelvicMesh.position.set(0, -0.34, -0.2);
    this.bodyPivot.add(pelvicMesh);

    // Pectoral fins (leaf-shaped) - one each side near the head, can flap.
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0.04);
    leaf.bezierCurveTo(0.22, 0.02, 0.4, -0.08, 0.46, -0.16);
    leaf.bezierCurveTo(0.3, -0.12, 0.12, -0.06, 0, -0.04);
    leaf.closePath();
    this.pecLeft = new THREE.Group();
    this.pecRight = new THREE.Group();
    const pecL = this._shapeFin(leaf, mat);
    const pecR = this._shapeFin(leaf, mat.clone());
    this.pecLeft.add(pecL);
    this.pecRight.add(pecR);
    this.pecLeft.position.set(0.26, -0.08, 0.34);
    this.pecRight.position.set(-0.26, -0.08, 0.34);
    this.pecRight.scale.x = -1;
    this.bodyPivot.add(this.pecLeft, this.pecRight);
  }

  _buildFace() {
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0xf4fbfb, roughness: 0.18, metalness: 0.0, clearcoat: 0.8 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x06171d, roughness: 0.25, emissive: 0x05242b, emissiveIntensity: 0.3 });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeGeo = new THREE.SphereGeometry(0.088, 24, 18);
    const pupilGeo = new THREE.SphereGeometry(0.045, 18, 14);
    const glintGeo = new THREE.SphereGeometry(0.014, 8, 8);

    this.eyes = new THREE.Group();
    this.pupils = [];
    for (const sx of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * 0.185, 0.14, 0.64);  // set into the head, not protruding
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(sx * 0.205, 0.145, 0.705);
      pupil.userData.base = pupil.position.clone();
      const glint = new THREE.Mesh(glintGeo, glintMat);
      glint.position.set(sx * 0.02, 0.025, 0.04);
      pupil.add(glint);
      this.pupils.push(pupil);
      this.eyes.add(eye, pupil);
    }
    this.bodyPivot.add(this.eyes);
  }

  _buildMouth() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x113438, roughness: 0.6, metalness: 0.0 });
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mat);
    mouth.scale.set(1.0, 0.28, 0.5);
    mouth.position.set(0, -0.12, 1.02);
    this.bodyPivot.add(mouth);
  }

  // -------------------------------------------------- interactions (§6)
  pet(strength = 1) {
    this._lastInteraction = performance.now();
    this.emotion.happiness = clamp(this.emotion.happiness + 14 * strength, 0, 100);
    this.emotion.irritation = clamp(this.emotion.irritation - 6 * strength, 0, 100);
    this.emotion.curiosity = clamp(this.emotion.curiosity + 4, 0, 100);
  }
  tap() {
    const now = performance.now();
    this._lastInteraction = now;
    this._tapTimes.push(now);
    this._tapTimes = this._tapTimes.filter((t) => now - t < 4200);
    const r3 = this._tapTimes.filter((t) => now - t < 3000).length;
    const r4 = this._tapTimes.length;
    if (r4 >= 5) this.emotion.irritation = clamp(this.emotion.irritation + 26, 0, 100);
    else if (r3 >= 3) this.emotion.irritation = clamp(this.emotion.irritation + 14, 0, 100);
    else this.emotion.irritation = clamp(this.emotion.irritation + 4, 0, 100);
    this._startle = now;
  }
  // passive mouse-follow target (soft) - eyes lead, body follows subtly
  setPointer(worldPoint) { this._pointerTarget.copy(worldPoint); this._pointerActive = true; }
  clearPointer() { this._pointerActive = false; }
  // navigation focus target (strong) - Veo clearly turns toward the item
  setNav(worldPoint) {
    if (worldPoint) { this._navTarget.copy(worldPoint); this._navActive = true; this.emotion.curiosity = clamp(this.emotion.curiosity + 2, 0, 100); }
    else { this._navActive = false; }
  }
  clearNav() { this._navActive = false; }
  lookToward(worldPoint) { this.setNav(worldPoint); } // back-compat
  clearLook() { this._navActive = false; }
  greet() { this._scriptedUntil = performance.now() + 900; this.state = State.GREETING; this._greetStart = performance.now(); }
  setState(s) { if (STATE_PARAMS[s]) this.state = s; }

  // --- drag-to-inspect (§1): smooth manual rotation with inertia ---
  beginDrag() {
    const m = this._manual;
    m.active = true; m.yaw = this._curYaw; m.pitch = this._curPitch;
    m.velYaw = 0; m.velPitch = 0; m.lastInput = performance.now();
    this._lastInteraction = m.lastInput;
  }
  dragBy(dx, dy) {
    const m = this._manual; if (!m.active) return;
    const k = 2.6;
    m.yaw += dx * k;                                 // horizontal drag -> yaw
    m.pitch = clamp(m.pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT); // vertical -> pitch (clamped)
    m.velYaw = dx * k * 0.6; m.velPitch = -dy * k * 0.6;
    m.lastInput = performance.now(); this._lastInteraction = m.lastInput;
  }
  endDrag() { const m = this._manual; m.active = false; m.lastInput = performance.now(); }

  _resolveState(now) {
    if (now < this._scriptedUntil) return;
    const e = this.emotion;
    let next;
    if (e.irritation > 55) next = State.ANNOYED;
    else if (e.happiness > 75) next = State.VERY_HAPPY;
    else if (e.happiness > 35) next = State.HAPPY;
    else if (e.irritation > 20 || e.happiness > 12) next = State.RECOVERING;
    else if (this._navActive && e.curiosity > 4) next = State.CURIOUS;
    else next = State.IDLE;
    if (next === State.VERY_HAPPY && this.state !== State.VERY_HAPPY && !this._rollActive) {
      this._rollActive = true; this._rollStart = now; this._scriptedUntil = now + 1100;
    }
    this.state = next;
  }

  // randomized idle life (§13): glances, eye darts, tiny repositioning
  _idle(now, dt) {
    const interacting = this._pointerActive || this._navActive || this._manual.active || now - this._lastInteraction < 1200;
    if (!interacting && now > this._nextIdle && (this.state === State.IDLE || this.state === State.RECOVERING)) {
      const roll = Math.random();
      if (roll < 0.45) { this._idleYaw = rand(-0.28, 0.28); this._idlePitch = rand(-0.06, 0.1); }
      else if (roll < 0.75) { this._idleEye.set(rand(-1, 1), rand(-0.6, 0.6)); }
      else { this._idleDrift.set(rand(-0.06, 0.06), rand(-0.05, 0.05), rand(-0.05, 0.03)); }
      this._nextIdle = now + rand(2200, 5200);
    }
    if (!interacting && Math.random() < dt * 0.25) this._idleEye.set(rand(-1, 1), rand(-0.6, 0.6)); // occasional dart
  }

  update(dt, now) {
    dt = Math.min(dt, 0.05);
    const idleFor = now - this._lastInteraction;
    const decay = idleFor > 500 ? dt : dt * 0.25;
    this.emotion.happiness = Math.max(0, this.emotion.happiness - 6 * decay);
    this.emotion.irritation = Math.max(0, this.emotion.irritation - 9 * decay);
    this.emotion.curiosity = Math.max(0, this.emotion.curiosity - 7 * decay);

    this._resolveState(now);
    this._idle(now, dt);

    const tgt = STATE_PARAMS[this.state] || STATE_PARAMS.IDLE;
    for (const k of Object.keys(this.params)) this.params[k] = damp(this.params[k], tgt[k], 5, dt);

    this._animateBody(dt, now);
    this._animateFins(dt, now);
    this._animateOrientation(dt, now);
    this._animateEyes(dt);
  }

  _animateBody(dt, now) {
    const p = this.params;
    this._phase += dt * p.swimSpeed;
    let twitch = 0;
    if (this._startle) {
      const k = (now - this._startle) / 320;
      if (k < 1) twitch = Math.sin(k * Math.PI) * 0.14 * Math.sin(now * 0.08);
      else this._startle = 0;
    }
    const pos = this._bodyGeo.attributes.position.array;
    const base = this._basePositions, u = this._uParam;
    const amp = this.reducedMotion ? p.swimAmp * 0.25 : p.swimAmp;
    for (let i = 0; i < u.length; i++) {
      const tailWeight = Math.pow(1 - u[i], 1.5);
      const wave = Math.sin(this._phase + (1 - u[i]) * 3.4);
      pos[i * 3] = base[i * 3] + amp * tailWeight * wave + twitch * tailWeight;
    }
    this._bodyGeo.attributes.position.needsUpdate = true;
    this._bodyGeo.computeVertexNormals();

    // idle drift (local to bodyPivot so it doesn't fight group placement) + bob
    this._idleDrift.multiplyScalar(1 - dt * 0.6);
    const bob = this.reducedMotion ? 0 : Math.sin(now * 0.0015) * p.bob;
    this.bodyPivot.position.set(
      damp(this.bodyPivot.position.x, this._idleDrift.x, 3, dt),
      damp(this.bodyPivot.position.y, bob + this._idleDrift.y, 3, dt),
      damp(this.bodyPivot.position.z, this._idleDrift.z, 3, dt),
    );
  }

  _animateFins(dt, now) {
    const p = this.params;
    let flap = 0;
    if (now < this._flapUntil) {
      const k = (this._flapUntil - now) / 440;         // 1 -> 0 over the flap
      flap = Math.sin((1 - k) * Math.PI) * this._flapStrength * 1.1;
    }
    this.caudal.rotation.y = Math.sin(this._phase - 0.9) * (0.5 + p.swimAmp * 2) * 0.6 + flap;
    const pecFlap = Math.sin(now * 0.004) * 0.14;
    const spread = 0.4 + p.finSpread * 0.8;
    this.pecLeft.rotation.z = -spread - pecFlap;
    this.pecRight.rotation.z = spread + pecFlap;
    this.pecLeft.rotation.y = 0.4 + pecFlap;
    this.pecRight.rotation.y = -0.4 - pecFlap;
  }

  _animateOrientation(dt, now) {
    const p = this.params;
    const m = this._manual;
    const since = now - m.lastInput;
    let manualEngaged = m.active || since < 1600 || (Math.abs(m.velYaw) + Math.abs(m.velPitch)) > 0.0015;
    if (this._navActive && !m.active) manualEngaged = false; // nav focus redirects after a drag

    // ---- resolve a world-space attention target -> desired yaw/pitch ----
    let targetYaw, targetPitch;
    if (manualEngaged) {
      if (!m.active) {
        m.yaw += m.velYaw * dt * 60;
        m.pitch = clamp(m.pitch + m.velPitch * dt * 60, -PITCH_LIMIT, PITCH_LIMIT);
        const decay = Math.pow(0.86, dt * 60);
        m.velYaw *= decay; m.velPitch *= decay;
        if (since > 1600) { m.yaw = damp(m.yaw, this._idleBaseYaw, 1.6, dt); m.pitch = damp(m.pitch, 0, 1.6, dt); }
      }
      targetYaw = m.yaw; targetPitch = clamp(m.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    } else {
      // priority: nav focus > mouse-follow > idle   (§9, §31)
      let tp = null;
      if (this._navActive) tp = this._navTarget;
      else if (this._pointerActive) tp = this._pointerTarget;
      if (tp) {
        this.group.getWorldPosition(_tmpV);
        _tmpDir.copy(tp).sub(_tmpV);
        const horiz = Math.hypot(_tmpDir.x, _tmpDir.z) || 1e-4;
        targetYaw = Math.atan2(_tmpDir.x, _tmpDir.z);                 // full 360 yaw
        targetPitch = clamp(Math.atan2(_tmpDir.y, horiz), -PITCH_LIMIT, PITCH_LIMIT);
      } else {
        targetYaw = this._idleBaseYaw + this._idleYaw * 0.6;
        targetPitch = this._idlePitch;
      }
    }
    targetPitch += p.tilt;

    // ---- tail flap when the turn is substantial (flap accompanies the turn) (§6) ----
    const angleToTarget = Math.abs(wrapAngle(targetYaw - this._curYaw));
    if (angleToTarget - this._lastAngleToTarget > 0.3) {
      this._flapUntil = now + 440;
      this._flapStrength = clamp(angleToTarget / Math.PI, 0.25, 1);
    }
    this._lastAngleToTarget = angleToTarget;

    // ---- slerp whole-body orientation toward the target (shortest path) ----
    _qTarget.setFromEuler(_eulA.set(-targetPitch, targetYaw, 0, 'YXZ'));
    const lambda = manualEngaged ? 11 : 4.5 + this._flapStrength * 3;
    this._coreQuat.slerp(_qTarget, 1 - Math.exp(-lambda * dt));
    _eulA.setFromQuaternion(this._coreQuat, 'YXZ');
    this._curYaw = _eulA.y; this._curPitch = -_eulA.x;

    // ---- eyes do the final precise focus (residual after the body turns) (§7) ----
    this._eyeAimX = clamp(wrapAngle(targetYaw - this._curYaw) / 0.5, -1, 1);
    this._eyeAimY = clamp((targetPitch - this._curPitch) / 0.4, -1, 1);

    // ---- banking into the turn + scripted nod / joyful roll ----
    const yawRate = wrapAngle(this._curYaw - this._prevYaw) / Math.max(dt, 0.001);
    this._prevYaw = this._curYaw;
    this._bankRoll = damp(this._bankRoll, clamp(-yawRate * 0.12, -0.5, 0.5), 6, dt);

    let nod = 0;
    if (this._greetStart) {
      const k = (now - this._greetStart) / 850;
      if (k < 1) nod = Math.sin(k * Math.PI * 2) * 0.16; else this._greetStart = 0;
    }
    if (this._rollActive) {
      const k = (now - this._rollStart) / 1050;
      if (k < 1) this._extraRoll = Math.sin(k * Math.PI) * Math.PI * 2;
      else { this._extraRoll = 0; this._rollActive = false; }
    }
    _qExtra.setFromEuler(_eulB.set(nod, 0, this._bankRoll + this._extraRoll, 'XYZ'));
    this.bodyPivot.quaternion.copy(this._coreQuat).multiply(_qExtra);
    this.bodyMat.emissiveIntensity = damp(this.bodyMat.emissiveIntensity, p.emissive, 4, dt);
  }

  _animateEyes(dt) {
    // pupils track the aim target directly, so the eyes lead the body
    const lookX = clamp(this._eyeAimX, -1, 1);
    const lookY = clamp(this._eyeAimY, -1, 1);
    for (const pupil of this.pupils) {
      const b = pupil.userData.base;
      pupil.position.x = damp(pupil.position.x, b.x + lookX * 0.024, 7, dt);
      pupil.position.y = damp(pupil.position.y, b.y + lookY * 0.02, 7, dt);
    }
  }

  get hitTargets() { return [this.bodyMesh]; }
}
