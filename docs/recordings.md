# Recorded review materials

[Public assignment source](https://github.com/Bigibaba2/codebridge-voice-studio) · [Live temporary reviewer demo](https://codebridge-temporary-reviewer-demo.onrender.com). The hosted demo uses isolated synthetic stock and temporary bookings; allow for Free-host wake-up. See [hosting limits and verification](FREE-REVIEWER-MODE.md).

- [Introduction walkthrough, 1 minute 41.77 seconds](https://drive.google.com/file/d/1ooTmOCz-yiKsuqYj_Ci3_Z6yoDexLbGy/view?usp=drivesdk)

- [Test 1: Normal booking](https://drive.google.com/file/d/1iCT2iUMzlPAJrdMeUPtd9e-BfjzvYNS0/view?usp=drivesdk)
- [Test 2: Corrected dates](https://drive.google.com/file/d/1ZNhIu64QzmQO0Eao5KIV7ENdAi4JydKX/view?usp=drivesdk)
- [Test 3: Insufficient stock](https://drive.google.com/file/d/1y3t-i-2is8ik04-Mj_6jsExOXUX-ly0v/view?usp=drivesdk)
- [Test 4: Interruption, quantity correction and retry](https://drive.google.com/file/d/12K9bt7WSIy6mrgJ_VeJMXUL31TYWSWMo/view?usp=drivesdk)
- [Test 5: Initial booking and repeated request](https://drive.google.com/file/d/1ZJ0i5Nn0yuuarDAuV_fnit3g-FV-oeHh/view?usp=drivesdk)
- [Test 5 continuation: Explicit repeated confirmations](https://drive.google.com/file/d/1ybbzlIRm9LqNLSeUTeXY-VU5OzctxRY8/view?usp=drivesdk)

## Before and after state

See [sanitized recorded-test evidence](recorded-test-evidence.json) for the captured reservation dates, quantities, remaining stock and row counts before and after every case. Session IDs, timestamps and raw speech are omitted; reservation references are replaced by stable case labels. [Test results](test-results.md) explain the outcomes and limitations.

## Recording integrity and limitations

The six original test clips are separate and uncut, including recognition retries and the short repeat-confirmation continuation. The introduction combines its original demonstration with a user-approved replacement closing at 1:16.8. It uses a straight cut, no speed changes and no synthesized narration. The introduction is not a replacement for the full case recordings.

All seven Drive files were verified as anyone-with-link Viewer, non-discoverable by the sharing setting. Anonymous access and downloaded-file hashes were checked against the local originals. Links can be forwarded by anyone who has them; the repository links intentionally make these selected assignment recordings accessible to reviewers. No computer-backup folder or unrelated file is shared by this index.

The user reviewed audible playback. Technical review checked decoded audio signal, sampled video frames and recorded database states, not an independent word-by-word listening pass. The user also supplied coarse first-response listening estimates for five local cases: about 2, 2, 1, 1–2 and 2 seconds, with a descriptive median of about 2 seconds. See the [clip-relative timing table](test-results.md#coarse-local-response-time-observations). Rounding and boundary-placement uncertainty are unknown; exact, independently verified phoneme-level latency remains unmeasured. The interruption case shows control/visual behavior and a successful correction, with an ASR retry retained; no independently measured audible cutoff time is claimed.

The original recorded tests exercised local mode, not the live hosted origin. Hosted reviewer mode has additional local synthetic isolation tests and temporary storage semantics, documented with current deployment verification in [FREE-REVIEWER-MODE.md](FREE-REVIEWER-MODE.md). A later user-run hosted voice smoke test completed one camera-plus-tripod booking after equipment and quantity clarification, supported by the Chrome UI and session export. No new hosted clip was captured, and it is not part of these seven recordings. Independent acoustic playback and acoustic latency for that hosted run remain unverified; the local listening estimates do not establish hosted performance. See [test results](test-results.md). These links do not establish final assignment submission.
