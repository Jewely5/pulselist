# PulseList

An offline-first task manager with live countdowns and urgency visualization.

## Features
- Live countdown timers
- Urgency color signals
- Multiple views (Grid, Today, Timeline, Archive)
- Offline-first with optional cloud sync
- Firebase authentication
- Google Calendar integration

## Tech Stack
- Vanilla JavaScript
- Firebase (Auth + Firestore)
- HTML5, CSS3
- localStorage for offline persistence

## Getting Started
1. Clone the repo
2. Open index.html in a modern browser
3. No build step required; it runs directly

## Architecture Notes
- Offline-first design: uses localStorage by default
- Firestore sync is optional; app never fails if unreachable
- Centralized app state with modular rendering functions
- Dual-persistence strategy for cross-device sync

## Future Improvements
- Module bundler (esbuild) to split large JS file
- Undo/redo system
- Data export (JSON/CSV)
- More granular error handling

## Live Demo
[pulselist.kamfolio.com](https://pulselist.kamfolio.com)

## License
MIT
