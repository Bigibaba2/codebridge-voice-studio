# Reviewer guide

## What to inspect

[Open the temporary reviewer demo](https://codebridge-temporary-reviewer-demo.onrender.com) in desktop Chrome, or run the [public assignment source](https://github.com/Bigibaba2/codebridge-voice-studio) locally. The Free host can sleep after 15 idle minutes and take about one minute to wake; that duration is provider guidance, not a measurement here. Hosted bookings use isolated synthetic stock and expire within 30 minutes, or earlier if the service sleeps or restarts.

Follow one reservation from equipment and date collection through a complete review to explicit confirmation. Try a quantity correction, unavailable stock, an interrupted turn, and repeated confirmation. Verify that corrections invalidate the previous review and repeated confirmation does not create a second booking. For independent local runs use a new database path instead of deleting or resetting a populated database. Hosted tabs in one browser profile share a workspace; separate browser profiles have independent synthetic stock.

## Limitations and lessons

Speech recognition can omit equipment, mishear quantities or end unexpectedly. Recognition hints are optional and do not guarantee accuracy. Unresolved finalization is discarded. Missing or ambiguous values are clarified, not silently inferred. A clear review and transactional stock check are more important than a fluent response. Synthetic regressions do not prove real-browser recognition quality.

The parser supports bounded English equipment/date phrases, not general conversation or every locale. Default local mode is a shared demonstration without authentication. Temporary reviewer mode isolates each browser workspace; it does not provide production account authentication or durable bookings. The hosted service is live and its initial Chrome UI and reviewer configuration were verified. Hosted microphone behavior has not been tested; see [hosting verification](FREE-REVIEWER-MODE.md) for the precise scope. Historical seed data and future synthetic scenario dates are fixtures, not real customer bookings.

## Original work and reused components

Project-specific work consists of the equipment/date parser, reservation state machine, revision and idempotency controls, inventory transactions, browser voice lifecycle, UI, regression tests and review tooling. Reused platform components are Node HTTP/SQLite and browser Web Speech/standard DOM APIs, with Playwright for optional synthetic browser tests. No bespoke recognition model was trained.

## Development and AI-output review

Development used OpenAI Codex tooling. The exact development model is unavailable here and is not invented. Browser/OS speech model identifiers are not exposed by this application. Actual focused development hours were not tracked, so no focused-hours requirement is claimed met.

A concrete review pattern is testing suggested parser changes against unsupported equipment and stale corrections: an unknown item must not silently become a known catalog item, and a later short answer must not revive superseded fields. Automated regression tests exercise these failure modes; they do not establish real recognition accuracy.

## Reused components and costs

Uses Node.js HTTP and built-in SQLite, browser Web Speech recognition/synthesis and standard browser APIs. No application runtime package, paid backend model API, API credential or custom trained speech model is required. Tests use Node's built-in test runner. Optional Chrome local recognition resources are browser-managed downloads. Browser-provider usage, network access, hosting, recording tools and optional external services may have their own limits or costs; no third-party price guarantee is made. Under existing-hardware, browser-recognition, no-LLM and no-intermediary assumptions, the application incurs $0 separately metered application API fees. This is not a claim of zero economic cost or zero browser-provider cost. Hosting is separate: this demo uses Render Free, with no paid resources provisioned. Monthly Free allowances apply workspace-wide; reaching applicable limits can suspend service or builds under the provider's no-payment-method rules. This is conditional Free hosting, not a free-credit calculation or an unlimited zero-billing guarantee. See [hosting limits](FREE-REVIEWER-MODE.md). Recognition retries can add browser-provider processing, network traffic and user time; those costs have not been metered. No all-in per-conversation price is established.

## Recording and submission status

Five genuine recorded checks covering normal booking, date correction, shortage, press-to-talk interruption/correction and repeated confirmation have been completed with synthetic reservation fixtures. Six original evidence clips include the repeat-confirmation continuation. A separate final walkthrough is 101.77 seconds (under three minutes); the user approved its playback and closing cut. See test-results.md for outcomes and evidence limits. The video bytes are not part of this source package; verified public file links are in [recordings.md](recordings.md).

The interruption case includes a recognition error and retries before the corrected booking succeeds. The repeat-confirmation case initially failed a narrow phrase-matching checker; a separate review of the actual recognized requests and before/after reservation snapshots established that repetition did not create another reservation. Neither issue is hidden or represented as a flawless automated pass.

Acoustic last-user-phoneme to first-assistant-phoneme latency has not been measured. Independent listening verification was unavailable in the technical review; decoded audio signal, inspected video frames and saved synthetic-demo snapshots support only the claims explicitly made in test-results.md. User listening approval is reported separately from technical verification. Useful saved time, comprehensive recognition retry rates and focused development hours were not measured. Full-stack cost has not been fully measured. Local HTTP timings exclude recognition, synthesis, user pauses and speaker output.

The reviewed assignment source is public at https://github.com/Bigibaba2/codebridge-voice-studio, the seven selected video links are verified, and the [temporary reviewer demo](https://codebridge-temporary-reviewer-demo.onrender.com) is live. Runtime databases, raw events, private transcripts, private local paths, credentials and unrelated recordings/repository content are excluded from these published materials. The packaging tool only creates a local copy; it does not upload files or submit the assignment. Final submission is not established by these links. The application remains a demonstration, not a production-ready public service.
