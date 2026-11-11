# Rental Studio

A voice-first equipment reservation demo with local and temporary hosted review modes. Independent project, not an official Codebridge product.

## Review materials

[Open the temporary reviewer demo](https://codebridge-temporary-reviewer-demo.onrender.com) in desktop Chrome. It uses isolated synthetic stock per browser; bookings expire after 30 minutes at most and can disappear earlier on sleep or restart. The free host can sleep after 15 idle minutes; allow about one minute for wake-up (not measured here). See [hosting and verification limits](docs/FREE-REVIEWER-MODE.md).

[Watch the 1:41.77 walkthrough](https://drive.google.com/file/d/1ooTmOCz-yiKsuqYj_Ci3_Z6yoDexLbGy/view?usp=drivesdk). The [six original test clips](docs/recordings.md), [before/after state evidence](docs/recorded-test-evidence.json), [test results](docs/test-results.md) and [public assignment source](https://github.com/Bigibaba2/codebridge-voice-studio) are available separately.

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

The app does not record audio. Finalized recognized transcripts and reservation events are stored in the local database in local mode, or temporarily in isolated server memory in hosted reviewer mode. Browser-default speech recognition may send microphone audio to the browser provider. Consent and a supported secure context (localhost or HTTPS) are required. Do not use private speech in a demonstration intended for sharing.

Recognition support, accuracy and speech synthesis depend on browser, OS and network. On-device mode is experimental and requires a verified readiness check; it cannot silently fall back to remote recognition. Optional model setup is an explicit user action. No model is bundled. Unsupported or interrupted recognition requests a retry rather than guessing a booking.

## Architecture

- Browser UI and explicit voice lifecycle in public/.
- Bounded, deterministic English parsing in src/order-interpret.js and src/interpret.js. No LLM or transcription service in the application backend.
- Authoritative conversation state, revision checks, idempotency and atomic stock reservations in src/desk.js using SQLite.
- Same-origin HTTP API and static serving in src/server.js. This local demo is not a hardened multi-user production service.

## Review scope

See [reviewer-guide.md](docs/reviewer-guide.md) for limitations and costs, and [test-results.md](docs/test-results.md) for reviewed evidence. Five recorded checks plus a repeat-confirmation continuation are complete; a separate user-approved walkthrough is 101.77 seconds. The assignment source is public, seven selected video links are verified, and the temporary reviewer service is live. A user-run hosted voice smoke test completed one booking after equipment and quantity clarification, verified through the Chrome UI and session export. It was not flawless first-utterance recognition, and hosted acoustic latency remains unmeasured. Five user-listened first responses in the local recordings were approximately 1–2 seconds, with a descriptive median of about 2 seconds. These coarse estimates are not independently verified phoneme-level measurements or a representative latency benchmark. Videos remain separate from this source package, which excludes private databases, raw live transcripts, recording bytes and unrelated repository content. These materials do not establish final assignment submission.

To reproduce a fresh sanitized LOCAL copy into a new directory:

```sh
node scripts/package-review.js ../rental-studio-review-copy
```

The copier uses an explicit allowlist and refuses existing destinations. REVIEW-MANIFEST.json records SHA-256 hashes, exclusions and scan scope. Automated checks reduce accidental disclosure but are not a guarantee that source text contains no personal information. Review before any publication. No license grant is provided (UNLICENSED).

## Optional temporary reviewer mode

The [live hosted simulation](https://codebridge-temporary-reviewer-demo.onrender.com) runs with REVIEWER_MODE=1, giving each browser an isolated in-memory catalog with finite retention and abuse limits. No existing local database is opened. These demo bookings disappear on expiry, sleep or restart. The deployed service uses Render Free; no paid resources were provisioned. Free quotas are workspace-wide and availability is conditional, not guaranteed. See [FREE-REVIEWER-MODE.md](docs/FREE-REVIEWER-MODE.md) for deployment and billing limits. CLI startup refuses a non-loopback host without reviewer mode.
