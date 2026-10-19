# Project Veo 3.0 - Phase 1 (homepage + Veo)

Interactive 3D homepage redesign. Built as a **no-build static** experience
(Three.js via an ES-module importmap from a CDN) so GitHub Pages deployment
stays trivial. Lives in `/veo/` during development; production (`index.html`
etc.) is untouched on `main`.

## Preview locally

ES modules need HTTP (not `file://`):

```bash
python -m http.server 8777        # from the repo root
# then open http://127.0.0.1:8777/veo/
```

- `?skip` - jump straight to the rested composition (skips the intro). Dev aid.

## What Phase 1 delivers (spec §1 - §8, homepage scope)

- **Veo** - a stylized fish built procedurally in `veo.js`: parametric body
  undulated per-frame, forked caudal fin, dorsal/ventral/pectoral fins, eyes.
- **Animation states** as eased parameter targets (IDLE, SWIMMING, GREETING,
  CURIOUS, HAPPY, VERY_HAPPY, ANNOYED, RECOVERING). Everything blends - no hard
  cuts. DOCKING/UNDOCKING are stubbed for Phase 2.
- **Emotion model** (happiness / irritation / curiosity, 0 - 100) driving
  reactions to **petting** (slow drag over Veo) and **tapping** (quick clicks;
  repeated taps build irritation → ANNOYED, then recovers).
- **Radial navigation** - four items (Projects, Portfolio, Experience, Contact)
  revealed around Veo. Real `<a>` links, so navigation works without WebGL.
- **Cinematic startup** (`app.js`): scene fade-in → Veo swims in on a curved
  path → greeting → nav materializes. Skip-intro control; intro not repeated in
  the same session (`sessionStorage`); reduced-motion and direct-load respected.
- **Graceful fallbacks** - no-WebGL shows branding + a usable nav column;
  reduced motion dampens movement; the renderer never leaves the page unusable.

## Deferred to later phases

- **Phase 2:** persistent dock companion + clock, single-canvas handoff between
  home and content pages, in-place (SPA-style) routing transitions (spec §7 - §8).
- **Phase 3:** restructured Projects page + detail routes, Portfolio, Experience,
  Contact pages (spec §9+). *Note: the source spec was truncated at §9.6 - the
  Portfolio/Experience/Contact sections and any tech/perf requirements are not
  yet available.*
- Promotion of `/veo/` to the site root (replacing the current `index.html`)
  once the full experience is approved.

## Files

| File | Role |
|------|------|
| `index.html`     | Shell: importmap, branding, radial nav, skip, fallbacks |
| `style.css`      | Atrium palette (spec §3.3), nav layout, fallbacks |
| `app.js`         | Orchestrator: startup timeline, pointer gestures, nav, resize |
| `veo.js`         | `Veo` character: geometry, state machine, emotion model |
| `environment.js` | Underwater atrium: lights, fog, particles, bubbles, forms |
