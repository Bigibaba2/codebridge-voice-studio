# Rental Studio

A local voice-first equipment reservation demo for review. Independent project, not an official Codebridge product.

## Run

Use Node.js 22.13 or later with built-in node:sqlite. There are no npm runtime dependencies or API keys. No installation step is required.

```sh
npm start
```

Open http://localhost:3010 in desktop Chrome. The default server binds to loopback. The first run creates a new data/studio.sqlite with synthetic catalog and seed reservation data. For an isolated rehearsal, use DB_PATH=data/rehearsal.sqlite PORT=3011 npm start. Starting a new conversation does not reset inventory.

Hold **Hold to talk** (or hold Space while focused), speak equipment, explicit quantities and one shared date range, then release. Review all details before saying “yes” or “book it”, or selecting Confirm booking. Corrections invalidate the prior review. Press-to-talk interrupts app speech; Escape discards an unfinished turn. This is not hands-free acoustic barge-in.

Try: “One camera and two tripods from December 1 to December 3, 2027.” Then “Change the tripods to one.” Review and confirm only when correct. Dates are inclusive. Availability is checked again transactionally at confirmation.

## Verify

```sh
npm test
npm run check
npm run evidence
```

Tests and scenarios use artificial inputs. The evidence command generates new synthetic transcript checks and local HTTP/SQLite timings in evidence/. It does not test microphone recognition, audio playback, or acoustic latency. Generated outputs are ignored by Git and excluded by the packaging script. Optional synthetic browser QA: run npm install --include=dev to install Playwright 1.62.1, provide a locally installed Google Chrome (or set CHROMIUM_PATH to its executable), then run npm run test:browser. This optional check injects synthetic speech and does not test real microphone audio. The harness defaults to macOS Google Chrome; other platforms must set CHROMIUM_PATH. No dependency or browser is installed by the packaging command.

## Privacy and browser limits

The app does not record audio. Finalized recognized transcripts and reservation events are stored in the local database. Browser-default speech recognition may send microphone audio to the browser provider. Consent and a supported secure context (localhost or HTTPS) are required. Do not use private speech in a demonstration intended for sharing.

Recognition support, accuracy and speech synthesis depend on browser, OS and network. On-device mode is experimental and requires a verified readiness check; it cannot silently fall back to remote recognition. Optional model setup is an explicit user action. No model is bundled. Unsupported or interrupted recognition requests a retry rather than guessing a booking.

## Architecture

- Browser UI and explicit voice lifecycle in public/.
- Bounded, deterministic English parsing in src/order-interpret.js and src/interpret.js. No LLM or transcription service in the application backend.
- Authoritative conversation state, revision checks, idempotency and atomic stock reservations in src/desk.js using SQLite.
- Same-origin HTTP API and static serving in src/server.js. This local demo is not a hardened multi-user production service.

## Review scope

See docs/reviewer-guide.md for limitations and costs, and docs/test-results.md for reviewed evidence. Five recorded checks plus a repeat-confirmation continuation are complete; a separate user-approved walkthrough is 101.77 seconds. Videos are intentionally separate from this source package. This package includes no private database, raw live transcripts, recording, existing Git history, published demo URL or submission proof. A private GitHub repository has been created separately; this packaging step does not establish a successful source push. Video upload and deployment remain separate.

To reproduce a fresh sanitized LOCAL copy into a new directory:

```sh
node scripts/package-review.js ../rental-studio-review-copy
```

The copier uses an explicit allowlist and refuses existing destinations. REVIEW-MANIFEST.json records SHA-256 hashes, exclusions and scan scope. Automated checks reduce accidental disclosure but are not a guarantee that source text contains no personal information. Review before any publication. No license grant is provided (UNLICENSED).

## Optional temporary reviewer mode

For a separately approved hosted simulation, see [FREE-REVIEWER-MODE.md](docs/FREE-REVIEWER-MODE.md). REVIEWER_MODE=1 gives each browser an isolated in-memory catalog with finite retention and abuse limits. No existing local database is opened. These demo bookings disappear on expiry, sleep or restart. The supplied Render configuration proposes only a free service; no deployment or zero-billing guarantee is implied. CLI startup refuses a non-loopback host without reviewer mode.
