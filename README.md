# PulseList

An offline-first task manager built around time remaining rather than due dates.
Every task shows a live countdown, and colour shifts from green through amber to red
as the deadline approaches — so what needs attention in the next hour is obvious at a
glance, without reading a single date.

**Live:** [pulselist.kamfolio.com](https://pulselist.kamfolio.com)

## Why it works this way

Most task apps show you a list of due dates. That tells you *when* something is due
but not *how urgent it is right now* — you end up doing the arithmetic yourself, for
every task, every time you look at the list. PulseList does that arithmetic
continuously and encodes the answer as colour and a ticking clock.

## Features

- Live countdown timers, updating without a page refresh
- Urgency colour signals that shift as deadlines approach
- Multiple views: Today dashboard, full grid, timeline, archive
- Offline-first — works with no connection, syncs when one returns
- Firebase Auth with Google Sign-In (optional; the app works signed out)
- Google Calendar export
- Optional Notion sync via a Cloudflare Worker proxy (`notion-worker.js`)

## Tech stack

Vanilla JavaScript, HTML5, CSS3 — no framework, no build step. Firebase
Authentication and Cloud Firestore for cloud sync, `localStorage` for offline
persistence.

## Files

| File | Purpose |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | Landing page shared by PulseList and Anchor |
| `pulselist-app.html` / `.js` / `.css` | The application itself |
| `pulselist-auth.html` / `.js` / `.css` | Sign-in and sign-up |
| `pulselist-details.html` | Marketing / feature detail page |
| `pulselist-goodbye.html` | Post-account-deletion page |
| `pulselist.html` | Redirect to the app |
| `firebase-config.js` | Firebase project config (see note below) |
| `firestore.rules` | Firestore security rules |
| `notion-worker.js` | Cloudflare Worker proxying the Notion API |

## Running locally

No build step and no dependencies:

```bash
python -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000.

Firebase Auth requires the serving domain to be listed under
**Authentication → Settings → Authorized domains** in the Firebase Console.
`localhost` is authorized by default.

## A note on the Firebase key

`firebase-config.js` is committed, and that's intentional. Firebase web API keys are
not secrets — they identify the project to Firebase's servers and are visible in any
browser's network tab regardless of what you do. Access is controlled by
[`firestore.rules`](firestore.rules), which restricts every read and write to the
authenticated owner of the document and additionally requires the user's email to
appear in an invite allowlist that cannot be enumerated.

## Related

Anchor, the personal finance companion app, lives at
[github.com/Jewely5/anchor](https://github.com/Jewely5/anchor). Both apps are served
from the same host, so links between them in this repo point at absolute URLs.
