# Test results and review evidence

This summary contains only synthetic equipment-reservation demo outcomes. Raw recordings, live events, database files, booking identifiers and private source paths are excluded. Recorded-case findings are summarized from the local technical recording review, not a fresh independent listening pass.

Expected inputs and outcomes are specified in recording-run-sheet.md. Sanitized before/after inventory and reservation states are in [recorded-test-evidence.json](recorded-test-evidence.json). It retains dates, quantities and row counts, replacing reservation IDs with stable test labels and omitting sessions, timestamps and raw speech. The table below reports actual outcomes, including failures and retries.

## Recorded checks

| Case | Observed outcome | Evidence and qualification |
| --- | --- | --- |
| Normal reservation | One camera saved for October 13–15, 2026; total reservations 1 → 2 including the seed. | Inspected video frames and saved before/after snapshots. |
| Date correction | Only October 23–25 saved; no booking for superseded October 20–22; total 2 → 3. | Inspected original review, correction and saved-review frames, with snapshots. |
| Shortage | Two cameras requested where one was free; confirmation refused; total stayed 3. | Inspected video and snapshots; seed preserved. |
| Press-to-talk correction | Two tripods changed to one for November 1–3; total 3 → 4. | UI/control sequence and corrected booking verified. ASR misrecognition caused retries before success. Exact audible cutoff was not independently measured. |
| Repeated confirmation | One microphone booking for November 5–6; total 4 → 5 once and stayed 5 through continuation. | Same saved booking persisted. Narrow automated phrase checker initially failed; explicit review of both confirmation requests and snapshots verified no duplicate. |

The six original clips decode with video and nonzero audio signal. Decoded channels are identical, not isolated speaker tracks. Signal analysis does not prove word-by-word intelligibility. The user reported correct audio and interruption behavior. Original evidence retains retries.

## Walkthrough

A separate 101.77-second final walkthrough was technically checked and approved by the user after playback. It uses a straight cut to the complete replacement closing, without speed changes or synthesized narration. Original recordings were unchanged. The walkthrough is a concise presentation, not the complete uncut test evidence. Video delivery remains separate from source publication.

## Automated checks on this source

Executed on this exact submission copy using Node.js 24.7.0. Tests use synthetic speech/inputs and isolated memory or temporary databases, never the live application database.

| Check | Result | Scope |
| --- | --- | --- |
| npm test | 201 passed, 0 failed | Node unit and integration regressions. |
| npm run check | Passed; 201 tests passed again | JavaScript syntax and regression checks. |
| npm run evidence | 18 scenarios passed | Synthetic transcripts, not microphone recognition. |
| Isolated HTTP/SQLite benchmark | 100 booking iterations passed | Local request/transaction timing only; not acoustic latency. |
| npm run test:browser | 55/55 passed on the updated source | Fresh headless Chrome contexts and synthetic speech; existing Playwright installation used, no microphone. |
| npm run test:reviewer-browser | Passed | Two isolated contexts, cookie flags, synthetic booking, reload and expiry recovery, empty hosted diagnostics and cold-start gating. |

Raw newly generated synthetic traces and timing output are retained separately, not included in this source package. The recorded checks exercised the local mode before optional reviewer hosting was added. Booking/parser behavior is unchanged; the added temporary reviewer isolation and recovery paths have synthetic HTTP/browser coverage, not a new live microphone test.

## Hosted verification

The [temporary reviewer demo](https://codebridge-temporary-reviewer-demo.onrender.com) is live on Render. The Render API confirmed deployed public source commit `8f228389e29be24d14a52dafaf8908447c3ed46f`; this was not inferred from the application version. Auto-deploy is disabled, so subsequent documentation-only commits may differ from the running commit without runtime changes or a redeploy. `/api/config` reports version `2.1.0` and `temporary-reviewer-demo`. Native Chrome loaded the initial synthetic seed and visible temporary-booking notice.

**15 independent hosted synthetic checks passed**, using 24 HTTP requests and two fresh owners:

- Valid HTTPS certificate and HTTP-to-HTTPS 301 redirect; expected configuration.
- Secure, HttpOnly, SameSite=Strict cookie; no credentials in JSON. Separate catalogs and cross-owner read, write, replay and conflict isolation.
- Three-item review and explicit atomic confirmation; replay/repeated-confirmation idempotency; shortage blocks partial booking; a correction preserves the other values.
- Temporary notice and CSP, nosniff, no-referrer and no-store headers.

HSTS was absent. This was not a full security audit. No real microphone test, actual hosted expiry/restart/cold-start measurement or resource-exhaustion test was performed. Local recorded and automated results above are distinct from these hosted checks.

## Measurement boundaries

No independent acoustic phoneme-boundary latency, word-error rate, end-to-end speech benchmark, comprehensive retry rate or time-saved study is supplied. The app uses deterministic parsing and no backend LLM or separately metered model API. Browser speech can use the browser provider. Under browser-recognition, no-LLM and no-intermediary assumptions, separately metered application API fees are $0. Full-stack economic cost has not been fully measured. Separately, the deployed service uses Render Free with no paid resources provisioned. Workspace-wide Free quotas and the provider's documented suspension rules apply; see [hosting details](FREE-REVIEWER-MODE.md). This is not a free-credit estimate or an all-in per-conversation cost.

## Security and portability

Default local mode has shared unauthenticated state and must remain loopback-only. Optional reviewer mode uses isolated in-memory catalogs and secure bearer cookies, finite quotas and expiry; it is not production account authentication or durable storage. See FREE-REVIEWER-MODE.md. The deployed service uses reviewer mode. Deploy status, configuration and initial UI are verified as described above; hosted microphone behavior and measured cold-start duration are not. Browser microphone features require localhost or HTTPS and user permission. The runtime needs Node.js 22.13+ with built-in SQLite and a compatible desktop browser. The optional browser harness needs Playwright 1.62.1 and installed Chrome; set CHROMIUM_PATH outside the default macOS location. No runtime dependencies or API keys are required. The package is UNLICENSED; it does not grant reuse rights.
