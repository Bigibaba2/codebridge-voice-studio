# Recording run sheet

Use the fresh local review instance at http://localhost:3011, started with PORT=3011 npm start from this copy. Its database is independent of any other instance. Do not start a recorder without deliberate user permission. This is a reproducibility run sheet, not a pending-work list. The five cases and repeat continuation were recorded separately; see test-results.md for observed outcomes. No recording is included in this source package.

The synthetic catalog owns Camera A × 2, Tripod B × 3 and Microphone C × 1. Check the fresh database starts with one synthetic Camera A seed reservation on October 10–12, 2026. Preflight may create a conversation only, with no reservation. Starting a new conversation does not reset stock. Historical dates below are intentional fixtures supported by this demo.

Before a full take, verify a short local capture includes intelligible microphone and assistant audio; no booking is needed for this trial. Keep private windows, notifications and conversations out of the capture area. Use New conversation between cases. Keep retries and failed attempts in the uncut evidence.

1. Normal: “One camera from October 13 to 15, 2026.” After the review, “Confirm booking.” Expect one new camera reservation, quantity 1.
2. Correction: “One camera from October 20 to 22, 2026.” Then “Change the dates to October 23 through October 25, 2026.” Confirm only the corrected review. Expect one new reservation for October 23–25, none for the original dates.
3. Shortage: “Two cameras from October 10 to 12, 2026.” After refusal, say “Confirm booking.” Expect no reservation because the seed leaves only one available camera.
4. Interruption: “Two tripods from November 1 to 3, 2026.” While the app speaks, hold the microphone, say “Change the tripods to one,” keep holding through a brief pause, then release. App speech should stop on press and stay silent during the hold. Confirm the corrected review. Expect one new tripod reservation, quantity 1.
5. Repeated confirmation: “One microphone from November 5 to 6, 2026.” Confirm, then say “Confirm booking” twice in separate turns. Expect one new microphone reservation and the same saved reservation ID after both repeats.

A successful single run adds four reservations to the seed, leaving five total. If actual recognition or database state differs, stop and inspect; do not force the expected count or erase failed takes. UI evidence captures are database snapshots, not audio verification. Review exports locally before any sharing.

For acoustic measurement, annotate actual recordings at the last audible user phoneme and first audible assistant phoneme. Report raw boundaries, sample count, median and nearest-rank p95. Browser callbacks and local HTTP timings cannot establish acoustic latency. Recording, repository publication and Codebridge submission need separately approved targets and materials.
