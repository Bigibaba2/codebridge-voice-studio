# Test results and review evidence

This summary contains only synthetic equipment-reservation demo outcomes. Raw recordings, live events, database files, booking identifiers and private source paths are excluded. Recorded-case findings are summarized from the local technical recording review, not a fresh independent listening pass.

Expected inputs and outcomes are specified in recording-run-sheet.md. The table below reports actual outcomes, including failures and retries.

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
| npm test | 193 passed, 0 failed | Node unit and integration regressions. |
| npm run check | Passed; 193 tests passed again | JavaScript syntax and regression checks. |
| npm run evidence | 18 scenarios passed | Synthetic transcripts, not microphone recognition. |
| Isolated HTTP/SQLite benchmark | 100 booking iterations passed | Local request/transaction timing only; not acoustic latency. |
| npm run test:browser | Blocked on this copy: Playwright module unavailable | No dependency installation attempted. Earlier 55 synthetic Chrome checks were reported passed, but are not represented as rerun results. |

Raw newly generated synthetic traces and timing output are retained separately, not included in this source package. Source behavior is unchanged from the prior sanitized review copy; documentation and the local packaging script were updated.

## Measurement boundaries

No independent acoustic phoneme-boundary latency, word-error rate, end-to-end speech benchmark, comprehensive retry rate or time-saved study is supplied. The app uses deterministic parsing and no backend LLM or separately metered model API. Browser speech can use the browser provider. Full-stack economic cost has not been fully measured; hosting cost is unknown until a provider is selected.

## Security and portability

No authentication or multi-user authorization is implemented. Keep the default loopback binding; do not expose this demo publicly without a separate deployment/security review. Browser microphone features require localhost or HTTPS and user permission. The runtime needs Node.js 22.13+ with built-in SQLite and a compatible desktop browser. The optional browser harness needs Playwright 1.62.1 and installed Chrome; set CHROMIUM_PATH outside the default macOS location. No runtime dependencies or API keys are required. The package is UNLICENSED; it does not grant reuse rights.
