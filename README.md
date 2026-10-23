# pavelkolarov.net

The source for my personal site — an interactive 3D portfolio you explore with **Veo**, a little fish who swims you between pages.

🌐 **Live:** [pavelkolarov.net](https://pavelkolarov.net)

---

## Hi, I'm Pavel 👋

I'm an engineer who turns complex technical problems into clear, structured solutions — working across **software**, **enterprise infrastructure** and **technical operations**. I like owning a problem end to end: investigating it, documenting it, and seeing it through with the right people.

Alongside that, I build and ship independent products of my own. This site is both my portfolio and one of those products.

- 💼 **Experience:** Technical Delivery Specialist · Compute Hardware Operations · Systems Engineering
- 🧰 **Toolbox:** C / C++, JavaScript, HTML / CSS, Git · enterprise server hardware, diagnostics, Active Directory, networking · Jira, Confluence, ServiceNow, SAP
- 🗣️ **Languages:** Bulgarian (native), English (C1), German (C1), Russian (B2)
- 📫 **Reach me:** [LinkedIn](https://www.linkedin.com/in/pavelkolarov/) · [GitHub](https://github.com/PaulK2)

Grab my full CV from the **Experience** page on the site.

## Things I've built

| Project | What it is |
|---------|------------|
| [Stickers Studio](https://stickers.studio) | A design & customization venture — custom vinyl graphics and large-format wall art, from artwork to the cutter. |
| [Glass Trading](https://glass.trading) | A physical collectible network where every glass coin carries its own **individual encrypted registration key** and **location-based activation**. |
| [Delivery 2015](https://2015.delivery) | Delivery-operations software I built for a client — **in daily real-world use** managing food deliveries and a car park. |
| **This site** | An interactive 3D experience built from scratch (see below). |

## About this site

A hand-built, **no-build static** experience — no bundler, no framework, no server.

- **Veo** is a procedural 3D fish built in [Three.js](https://threejs.org/) (no modelling tools) with a small emotion model: pet him, tap him, drag to spin him around.
- **Radial navigation** — the menu orbits Veo. Pick a section and he swims you there; on the Projects screen he swims to a second ring where every node is one of my projects.
- One **persistent transparent canvas** carries Veo between the hero and a docked companion, with hash-based routing, a cinematic intro, time-of-day lighting, bloom, and a reflective underwater world.
- **Accessible & resilient:** every menu item is a real link, so it works without WebGL; reduced-motion and direct-loading of any route are respected.

### Run it locally

ES modules need HTTP (not `file://`):

```bash
python -m http.server 8777    # from the repo root
# open http://127.0.0.1:8777/
```

Add `?skip` to jump past the intro. The previous version of the site is archived at [`/old`](https://pavelkolarov.net/old).

### How it's put together

| File | Role |
|------|------|
| `index.html`     | Page shell: importmap, branding, the two radial menus, project detail pages, fallbacks |
| `style.css`      | Ocean palette, premium nav coins, detail pages, cinematic grade |
| `app.js`         | Orchestrator: routing, swim transitions, pointer gestures, post-processing |
| `veo.js`         | `Veo` — procedural geometry, animation states, emotion model |
| `environment.js` | The underwater world: lighting, fog, particles, reflections, backdrop |

---

© Pavel Kolarov. Code is free to read and learn from; the Veo character, the brand logos and the written content are mine — please don't repackage them as your own.
