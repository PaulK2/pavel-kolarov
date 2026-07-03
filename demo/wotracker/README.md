# Order Tracker Web (MVP)

This is a vanilla HTML/CSS/JS starter that mirrors your Python (customtkinter) app tabs as pages.

## Run locally
Because of browser security, open it via a local server (not double-click):

### Option A (Python)
```bash
cd order-tracker-web
python -m http.server 8000
```
Open: http://localhost:8000/users.html

### Option B (Node)
```bash
npx serve .
```

## Data
- Data is stored per-user in the browser via localStorage (`ot:<username>`).
- You can import/export a user's JSON from the **Users** page.
- You can generate/load a share key from the **Settings** page (preview mode disables saving).

## Next upgrade (backend)
To make it multi-user across devices, implement a REST API:
- GET/PUT /api/users/{username}
- POST /api/users/{username}/export, /import
- Use auth if needed

Then swap localStorage calls for fetch() calls.
