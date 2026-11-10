/* Actual installed Chrome with synthetic speech. No microphone or audible playback. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const results = [];
function fakeSpeech() {
  window.__voice = {
    recognizers: [],
    spoken: [],
    utterances: [],
    cancelCount: 0,
    nextError: null,
    delay: 30,
    localAvailability: "downloadable",
    availabilityDelay: 0,
    availabilityCalls: [],
    installCalls: 0,
    installOptions: [],
    installDelay: 0,
    installResult: true,
    installError: null,
    installedAvailability: "available",
  };
  class Recognition {
    constructor() {
      this.processLocally = false;
      this.quality = "command";
      this.phrases = [];
    }
    static async available(options) {
      __voice.availabilityCalls.push(options);
      await new Promise(resolve => setTimeout(resolve, __voice.availabilityDelay));
      return __voice.localAvailability;
    }
    static async install(options) {
      __voice.installCalls++;
      __voice.installOptions.push(options);
      await new Promise(resolve => setTimeout(resolve, __voice.installDelay));
      if (__voice.installError) throw Object.assign(new Error("Synthetic setup error"), { name: __voice.installError });
      __voice.localAvailability = __voice.installedAvailability;
      return __voice.installResult;
    }
    start() {
      this.live = true;
      window.__voice.recognizers.push(this);
      queueMicrotask(() => {
        this.onstart?.();
        if (window.__voice.nextError) {
          let error = window.__voice.nextError;
          window.__voice.nextError = null;
          this.onerror?.({ error });
          this.onend?.();
        }
      });
    }
    emit(text, final = true, others = []) {
      const r = [
        { transcript: text, confidence: 0.95 },
        ...others.map((transcript) => ({ transcript, confidence: 0.3 })),
      ];
      r.isFinal = final;
      this.onresult?.({ resultIndex: 0, results: [r] });
    }
    stop() {
      setTimeout(() => {
        this.live = false;
        this.onend?.();
      }, window.__voice.delay);
    }
    abort() {
      this.live = false;
      this.onend?.();
    }
  }
  window.SpeechRecognition = Recognition;
  window.webkitSpeechRecognition = Recognition;
  window.SpeechRecognitionPhrase = class {
    constructor(phrase, boost) { Object.assign(this, { phrase, boost }); }
  };
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  let v = 0;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices() {
        return [{ name: "Samantha", lang: "en-US", localService: true }];
      },
      cancel() {
        v++;
        window.__voice.cancelCount++;
      },
      speak(u) {
        const version = v;
        window.__voice.spoken.push(u.text);
        window.__voice.utterances.push(u);
        setTimeout(() => {
          if (v !== version) return;
          u.onstart?.();
          setTimeout(() => {
            if (v === version) u.onend?.();
          }, 600);
        }, 5);
      },
    },
  });
}
(async () => {
  let service, browser;
  try {
    if (process.env.UI_BASE_URL)
      throw Error(
        "Only isolated ephemeral server supported. Never target live data.",
      );
    const { createService } = await import("../src/server.js");
    service = createService();
    await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${service.server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    await context.addInitScript(fakeSpeech);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    async function state() {
      return page.evaluate(() =>
        fetch(
          "/api/sessions/" + localStorage.getItem("rental-studio-v2-session"),
        ).then((r) => r.json()),
      );
    }
    async function ready() {
      await page.waitForFunction(
        () =>
          document.getElementById("phase").textContent === "Ready when you are",
      );
    }
    async function fresh() {
      const old = (await state()).sessionId;
      await page.locator("#new").click();
      await page.waitForFunction(
        (id) => localStorage.getItem("rental-studio-v2-session") !== id,
        old,
      );
      await ready();
    }
    async function voice(text, alts = []) {
      const revision = (await state()).revision;
      await page.locator("#talk").focus();
      await page.keyboard.down("Space");
      await page.evaluate(
        ({ text, alts }) => __voice.recognizers.at(-1).emit(text, true, alts),
        { text, alts },
      );
      await page.keyboard.up("Space");
      for (let i = 0; i < 100; i++) {
        const s = await state();
        if (s.revision > revision) {
          await page.waitForTimeout(25);
          return s;
        }
        await page.waitForTimeout(50);
      }
      throw Error(
        "Voice turn was not submitted: " +
          (await page.locator("#error").textContent()),
      );
    }
    async function check(name, fn) {
      await fn();
      results.push({ name, passed: true });
      console.log("PASS " + name);
    }
    async function screenshot(name) {
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.id = "synthetic";
        el.textContent =
          "SYNTHETIC UI CHECK · No real microphone or acoustic measurement";
        el.style.cssText =
          "padding:12px;background:#2e303f;color:white;text-align:center;font:14px sans-serif";
        document.body.prepend(el);
      });
      await page.screenshot({
        path: path.join(root, "evidence", name),
        fullPage: true,
      });
      await page.locator("#synthetic").evaluate((e) => e.remove());
    }
    await ready();
    await check(
      "Fresh UI loads without script errors or microphone activation",
      async () => {
        assert.equal((await state()).bookings.length, 1);
        assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
        assert.equal(await page.evaluate(() => __voice.spoken.length), 0);
        assert.equal(await page.evaluate(() => __voice.availabilityCalls.length), 0);
        assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
        assert.equal(errors.length, 0);
      },
    );
    await check("Desktop has no horizontal overflow", async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      ),
    );
    await check("Microphone and core flow fit common desktop viewports", async () => {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        const talk = await page.locator("#talk").boundingBox();
        assert.ok(talk.y >= 0 && talk.y + talk.height <= viewport.height, JSON.stringify({ viewport, talk }));
        assert.equal(await page.locator("#another").isVisible(), false);
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
    });
    await screenshot("desktop.png");
    await check(
      "Natural spoken request produces complete review, not a booking",
      async () => {
        const s = await voice(
          "I need two number tripod B from November 14th to November 16th 2026",
        );
        assert.equal(s.status, "review", JSON.stringify(s));
        assert.equal(s.booking, null);
        assert.equal(s.draft.quantity, 2);
        assert.equal(await page.locator("#confirm").isVisible(), true);
      },
    );
    await screenshot("review.png");
    await check(
      "Pause while held never submits; press interrupts synthesis",
      async () => {
        const before = (await state()).revision,
          cancels = await page.evaluate(() => __voice.cancelCount);
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("Wait, make that one tripod"),
        );
        await page.waitForTimeout(500);
        assert.equal((await state()).revision, before);
        assert.ok((await page.evaluate(() => __voice.cancelCount)) > cancels);
        assert.equal(await page.locator("#confirm").isDisabled(), true);
        await page.keyboard.up("Space");
        await page.waitForFunction(() =>
          document.getElementById("draft").textContent.includes("Quantity: 1"),
        );
        assert.equal((await state()).draft.quantity, 1);
      },
    );
    await check(
      "One final spoken yes saves once; repetitions stay idempotent",
      async () => {
        let s = await voice("Yes please");
        const id = s.booking.id,
          count = s.bookings.length;
        assert.equal(s.booking.quantity, 1);
        s = await voice("confirm booking");
        assert.equal(s.booking.id, id);
        assert.equal(s.bookings.length, count);
        s = await voice("yes");
        assert.equal(s.bookings.length, count);
        assert.equal(await page.locator("#confirm").isVisible(), false);
      },
    );
    await screenshot("booked.png");
    await check(
      "Reload preserves reservation and new conversation preserves stock",
      async () => {
        const id = (await state()).booking.id,
          count = (await state()).bookings.length;
        await page.reload();
        await ready();
        assert.equal((await state()).booking.id, id);
        assert.equal(await page.locator("#another").isVisible(), true);
        const previous = await state();
        await page.locator("#another").click();
        await page.waitForFunction(id => localStorage.getItem("rental-studio-v2-session") !== id, previous.sessionId);
        await ready();
        assert.equal(await page.locator("#another").isVisible(), false);
        assert.deepEqual((await state()).bookings, previous.bookings);
        assert.equal((await state()).bookings.length, count);
        assert.equal(await page.locator("#events .event").count(), 0);
      },
    );
    await check(
      "Fresh conversation distinguishes totals and keeps saved reservations visible",
      async () => {
        const before = await state();
        assert.equal(
          await page.locator("#stock-heading").textContent(),
          "INVENTORY TOTALS",
        );
        assert.match(
          await page.locator("#stock").textContent(),
          /Tripod B3 total · dates needed/,
        );
        assert.doesNotMatch(
          await page.locator("#stock").textContent(),
          /available/,
        );
        assert.match(
          await page.locator("#stock-context").textContent(),
          /Totals are not remaining stock/,
        );
        assert.match(
          await page.locator("#events").textContent(),
          /Existing reservations are still saved/,
        );
        await page.locator("#saved-title").click();
        assert.equal(
          await page.locator("#saved-list li").count(),
          before.bookings.length,
        );
        for (const booking of before.bookings)
          assert.ok(
            (await page.locator("#saved-list").textContent()).includes(
              booking.id,
            ),
          );
        await page.locator("#saved-title").click();
        assert.deepEqual((await state()).bookings, before.bookings);
        assert.equal((await state()).revision, before.revision);
        const dated = await voice(
          "one tripod from November 14 to November 16 2026",
        );
        assert.equal(
          dated.inventory.find((i) => i.id === "tripod").remaining,
          2,
        );
        assert.equal(
          await page.locator("#stock-heading").textContent(),
          "AVAILABILITY FOR YOUR DATES",
        );
        assert.match(
          await page.locator("#stock").textContent(),
          /Tripod B2 available \/ 3 total/,
        );
        assert.match(
          await page.locator("#stock-context").textContent(),
          /2026-11-14 through 2026-11-16/,
        );
        assert.deepEqual(dated.bookings, before.bookings);
        await fresh();
      },
    );
    await check("Corrected dates alone are what gets saved", async () => {
      await voice("one camera from October 20 to 22, 2026");
      await voice("Actually October 23 to 25, 2026");
      let s = await voice("Go ahead and book it");
      assert.equal(s.booking.start, "2026-10-23");
      assert.equal(s.booking.end, "2026-10-25");
    });
    await check("Seeded shortage cannot confirm", async () => {
      await fresh();
      let s = await voice("two cameras from October 10 to 12, 2026");
      assert.equal(s.status, "unavailable");
      const count = s.bookings.length;
      s = await voice("yes");
      assert.equal(s.status, "unavailable");
      assert.equal(s.bookings.length, count);
      assert.equal(s.booking, null);
    });
    await check(
      "Missing quantity retains dates and asks just quantity",
      async () => {
        await fresh();
        let s = await voice(
          "Reserve tripod B from December 14 to December 16 2026",
        );
        assert.equal(s.draft.start, "2026-12-14");
        assert.equal(s.draft.quantity, null);
        assert.match(s.reply, /How many/);
        s = await voice("I need two please");
        assert.equal(s.status, "review", JSON.stringify(s));
      },
    );
    await check(
      "Unrecognized count preserves quantity question; number one reaches a review",
      async () => {
        await fresh();
        await voice("Reserve tripod B from December 14 to December 16 2026");
        let s = await voice("Ron");
        assert.equal(s.draft.quantity, null);
        assert.match(s.reply, /How many Tripod B/);
        s = await voice("number one", ["number 1", "number run"]);
        assert.equal(s.status, "review");
        assert.equal(s.draft.quantity, 1);
        assert.equal(s.draft.start, "2026-12-14");
        assert.equal(s.booking, null);
        assert.equal(await page.locator("#confirm").isVisible(), true);
      },
    );
    await check(
      "Zero-stock request and voice confirmation offer dates, never fewer units",
      async () => {
        await fresh();
        await voice("one microphone from February 1 to February 2 2028");
        const booked = await voice("confirm booking");
        const count = booked.bookings.length;
        await fresh();
        let s = await voice(
          "one microphone from February 1 to February 2 2028",
        );
        assert.equal(s.status, "unavailable");
        assert.equal(await page.locator("#confirm").isVisible(), false);
        assert.match(s.reply, /different dates/);
        assert.doesNotMatch(s.reply, /fewer/);
        s = await voice("confirm booking");
        assert.equal(s.status, "unavailable");
        assert.equal(s.booking, null);
        assert.equal(s.bookings.length, count);
        assert.match(s.reply, /can’t book/);
        assert.match(s.reply, /different dates/);
        assert.doesNotMatch(s.reply, /fewer/);
        assert.match(
          await page.locator("#stock").textContent(),
          /Microphone C0 available \/ 1 total/,
        );
      },
    );
    await check(
      "Noisy lower ASR hypothesis does not obstruct valid primary",
      async () => {
        await fresh();
        const s = await voice(
          "I need two number tripod B from December 14 to December 16 2026",
          [
            "I need two numbers tripod be from December 14 to December 16 2026",
            "I need to tree pot December 14 December 16 2026",
          ],
        );
        assert.equal(s.status, "review", JSON.stringify(s));
      },
    );
    await check(
      "Ambiguous primary asks item meaning and retains dates",
      async () => {
        await fresh();
        let s = await voice(
          "Reserve tree pot December 14 to December 16 2026",
          ["Reserve tripod December 14 to December 16 2026"],
        );
        assert.equal(s.status, "collecting");
        assert.match(s.reply, /Did you mean Tripod B/);
        assert.equal(s.draft.start, "2026-12-14");
        s = await voice("yes");
        assert.equal(s.status, "collecting");
        assert.equal(s.booking, null);
        assert.match(s.reply, /How many/);
      },
    );
    await check(
      "Actual Palmetto alternatives recover by asking, never by replacing or booking",
      async () => {
        await fresh();
        const count = (await state()).bookings.length;
        let s = await voice("Palmetto", ["Camaro", "camera", "Palmetto of"]);
        assert.match(s.reply, /Did you mean Camera A/);
        assert.equal(s.draft.itemId, null);
        assert.equal(s.booking, null);
        assert.match(
          await page.locator("#live").textContent(),
          /Heard: Palmetto/,
        );
        assert.equal(await page.locator("#confirm").isVisible(), false);
        s = await voice("yes");
        assert.equal(s.draft.itemId, "camera");
        assert.equal(s.draft.quantity, null);
        assert.equal(s.status, "collecting");
        assert.equal(s.booking, null);
        s = await voice("yes");
        assert.equal(s.booking, null);
        assert.equal(s.bookings.length, count);
      },
    );
    await check("Escape discards held speech without posting", async () => {
      const rev = (await state()).revision;
      await page.locator("#talk").focus();
      await page.keyboard.down("Space");
      await page.evaluate(() => __voice.recognizers.at(-1).emit("yes"));
      await page.keyboard.press("Escape");
      await page.keyboard.up("Space");
      await page.waitForTimeout(100);
      assert.equal((await state()).revision, rev);
    });
    await check("Interim-only recognition is never sent", async () => {
      const rev = (await state()).revision;
      await page.locator("#talk").focus();
      await page.keyboard.down("Space");
      await page.evaluate(() =>
        __voice.recognizers.at(-1).emit("confirm booking", false),
      );
      await page.keyboard.up("Space");
      await page.waitForTimeout(400);
      assert.equal((await state()).revision, rev);
      assert.match(
        await page.locator("#error").textContent(),
        /speech|incomplete/i,
      );
    });
    await check(
      "Microphone denial is visible and submits nothing",
      async () => {
        const rev = (await state()).revision;
        await page.evaluate(() => {
          __voice.nextError = "not-allowed";
        });
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.waitForTimeout(50);
        await page.keyboard.up("Space");
        assert.equal((await state()).revision, rev);
        assert.match(await page.locator("#error").textContent(), /denied/);
      },
    );
    await check(
      "Finalizing disables confirmation and does not start competing mic",
      async () => {
        await fresh();
        await voice("one camera from January 4 to 6 2028");
        await page.evaluate(() => (__voice.delay = 250));
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("make that two"),
        );
        await page.keyboard.up("Space");
        assert.equal(await page.locator("#confirm").isDisabled(), true);
        const count = await page.evaluate(() => __voice.recognizers.length);
        await page.keyboard.down("Space");
        await page.keyboard.up("Space");
        assert.equal(
          await page.evaluate(() => __voice.recognizers.length),
          count,
        );
        await page.waitForTimeout(650);
        assert.equal((await state()).draft.quantity, 2);
        await page.evaluate(() => (__voice.delay = 30));
      },
    );
    await check(
      "Evidence drawer records before and after without reset or microphone",
      async () => {
        await page.locator("#evidence").click();
        assert.equal(await page.locator("#cases h4").count(), 5);
        const count = (await state()).bookings.length,
          rec = await page.evaluate(() => __voice.recognizers.length);
        await page
          .locator("#cases")
          .getByText("Capture before", { exact: true })
          .first()
          .click();
        await page.waitForTimeout(30);
        await page
          .locator("#cases")
          .getByText("Capture after", { exact: true })
          .first()
          .click();
        await page.waitForTimeout(30);
        assert.equal((await state()).bookings.length, count);
        assert.equal(
          await page.evaluate(() => __voice.recognizers.length),
          rec,
        );
        assert.match(await page.locator("#case-count").textContent(), /1 of 5/);
        await page.locator("#close").click();
      },
    );
    await check(
      "Mobile layout has no overflow and voice control remains visible",
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.equal(await page.locator("#talk").isVisible(), true);
        await screenshot("mobile.png");
      },
    );
    await check(
      "Expanded reservation history fits mobile without changing state",
      async () => {
        const before = await state();
        await page.locator("#saved-title").click();
        assert.equal(await page.locator("#saved-list").isVisible(), true);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual((await state()).bookings, before.bookings);
        await page.locator("#saved-title").click();
      },
    );

    await page.setViewportSize({ width: 1440, height: 1100 });
    await check(
      "Chrome shrinking result list removes stale interim before finalization",
      async () => {
        await fresh();
        const revision = (await state()).revision;
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() => {
          const final = Object.assign([{ transcript: "two tripod B" }], {
              isFinal: true,
            }),
            interim = Object.assign([{ transcript: "B" }], { isFinal: false });
          __voice.recognizers
            .at(-1)
            .onresult({ resultIndex: 0, results: [final, interim] });
        });
        await page.keyboard.up("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("two tripod B", true),
        );
        await page.waitForTimeout(400);
        const s = await state();
        assert.equal(s.revision, revision + 1);
        assert.equal(s.draft.itemId, "tripod");
        assert.equal(s.draft.quantity, 2);
        assert.equal(s.draft.start, null);
        assert.equal(s.booking, null);
        assert.equal(await page.locator("#error").textContent(), "");
      },
    );
    await check(
      "Final arriving after old2.5-second cutoff is awaited, never provisional",
      async () => {
        await fresh();
        const revision = (await state()).revision;
        await page.evaluate(() => (__voice.delay = 3000));
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("two tripod B", false),
        );
        await page.keyboard.up("Space");
        await page.waitForTimeout(2600);
        assert.equal((await state()).revision, revision);
        assert.match(
          await page.locator("#phase").textContent(),
          /Finishing|Waiting/,
        );
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("two tripod B", true),
        );
        await page.waitForTimeout(800);
        const s = await state();
        assert.equal(s.revision, revision + 1);
        assert.equal(s.draft.quantity, 2);
        assert.equal(s.booking, null);
        await page.evaluate(() => (__voice.delay = 30));
      },
    );
    await check(
      "Queued final after end wins during settling, not an old partial result",
      async () => {
        await fresh();
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("one camera", false),
        );
        await page.keyboard.up("Space");
        await page.waitForTimeout(80);
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("one camera", true),
        );
        await page.waitForTimeout(350);
        const s = await state();
        assert.equal(s.draft.itemId, "camera");
        assert.equal(s.draft.quantity, 1);
        assert.equal(s.booking, null);
      },
    );
    await check(
      "Genuine trailing interim correction cannot turn final yes into a booking",
      async () => {
        await fresh();
        await voice("one camera from January 4 to 6 2028");
        const revision = (await state()).revision;
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() => {
          __voice.recognizers.at(-1).onresult({
            resultIndex: 0,
            results: [
              Object.assign([{ transcript: "yes" }], { isFinal: true }),
              Object.assign([{ transcript: "but wait make that" }], {
                isFinal: false,
              }),
            ],
          });
        });
        await page.keyboard.up("Space");
        await page.waitForTimeout(400);
        assert.equal((await state()).revision, revision);
        assert.equal((await state()).booking, null);
        assert.match(
          await page.locator("#error").textContent(),
          /Nothing was sent or booked/,
        );
        assert.match(await page.locator("#live").textContent(), /^Not sent:/);
      },
    );
    await check(
      "Three equipment types render explicit counts and shared dates in one review",
      async () => {
        await fresh();
        const s = await voice(
          "one camera and two tripods and one microphone from March 10 to March 12 2030",
        );
        assert.equal(s.status, "review", JSON.stringify(s));
        assert.equal(s.draft.items.length, 3);
        assert.equal(s.booking, null);
        const text = await page.locator("#draft").textContent();
        for (const name of ["Camera A", "Tripod B", "Microphone C"])
          assert.ok(text.includes(name), text);
        assert.match(text, /Quantity: 2/);
        assert.match(text, /Shared start date2030-03-10/);
        assert.match(text, /Shared end date2030-03-12/);
        assert.equal(await page.locator("#confirm").count(), 1);
        assert.equal(await page.locator("#line-availability li").count(), 3);
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.evaluate(() => window.scrollTo(0, 0));
        for (const selector of ["#talk", "#confirm"]) {
          const box = await page.locator(selector).boundingBox();
          assert.ok(box.y >= 0 && box.y + box.height <= 720, JSON.stringify({ selector, box }));
        }
        await screenshot("compact-multi-item-review.png");
        await page.setViewportSize({ width: 1440, height: 1100 });
      },
    );
    let multiBooking;
    await check(
      "One final confirmation saves one reservation containing all three lines",
      async () => {
        const before = await state();
        await page.locator("#confirm").click();
        await page.waitForFunction(
          () => document.getElementById("status").textContent === "BOOKED",
        );
        const s = await state();
        assert.equal(s.bookings.length, before.bookings.length + 1);
        assert.equal(s.booking.items.length, 3);
        multiBooking = s.booking;
        assert.equal(s.booking.start, "2030-03-10");
        assert.equal(s.booking.end, "2030-03-12");
        assert.ok(
          (await page.locator("#draft").textContent()).includes(s.booking.id),
        );
        for (const line of s.booking.items) {
          const item = s.inventory.find((i) => i.id === line.itemId);
          assert.equal(item.remaining, item.stock - line.quantity);
        }
      },
    );
    await check(
      "Multi-item reservation survives reload and new conversation with complete history",
      async () => {
        await page.reload();
        await ready();
        assert.deepEqual((await state()).booking, multiBooking);
        await fresh();
        assert.ok(
          (await state()).bookings.some((b) => b.id === multiBooking.id),
        );
        await page.locator("#saved-title").click();
        const entry = page
          .locator("#saved-list li")
          .filter({ hasText: multiBooking.id });
        assert.equal(await entry.count(), 1);
        for (const name of ["Camera A", "Tripod B", "Microphone C"])
          assert.ok((await entry.textContent()).includes(name));
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.locator("#saved-title").click();
        await page.setViewportSize({ width: 1440, height: 1100 });
      },
    );
    await check(
      "One shortage blocks every line without partial reservation",
      async () => {
        const before = (await state()).bookings.length;
        let s = await voice(
          "one camera and one tripod and one microphone from March 10 to March 12 2030",
        );
        assert.equal(s.status, "unavailable", JSON.stringify(s));
        assert.equal(s.draft.items.length, 3);
        assert.equal(await page.locator("#confirm").isVisible(), false);
        assert.ok(
          (await page.locator("#line-availability .line-shortage").count()) > 0,
        );
        assert.match(
          await page.locator("#line-availability").textContent(),
          /Microphone C/,
        );
        s = await voice("confirm booking");
        assert.equal(s.booking, null);
        assert.equal(s.bookings.length, before);
      },
    );
    await check(
      "Named line correction preserves other equipment and shared dates",
      async () => {
        await fresh();
        await voice(
          "one camera and two tripods and one microphone from April 10 to April 12 2030",
        );
        const s = await voice("Change the tripods to one");
        assert.equal(s.status, "review", JSON.stringify(s));
        assert.equal(s.draft.items.length, 3);
        for (const id of ["camera", "tripod", "microphone"])
          assert.equal(s.draft.items.find((i) => i.itemId === id).quantity, 1);
        assert.equal(s.draft.start, "2030-04-10");
        assert.equal(s.draft.end, "2030-04-12");
        assert.equal(s.booking, null);
      },
    );
    await check(
      "Multi-item interruption and two-second held pause retain one correction boundary",
      async () => {
        await fresh();
        await voice(
          "one camera and two tripods and one microphone from May 10 to May 12 2031",
        );
        const before = await state();
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() => {
          __voice.oldUtterance = __voice.utterances.at(-1);
          __voice.recognizers.at(-1).emit("Change the tripods to one");
        });
        const cancels = await page.evaluate(() => __voice.cancelCount);
        await page.evaluate(() => {
          __voice.oldUtterance.onstart?.();
          __voice.oldUtterance.onend?.();
          __voice.oldUtterance.onerror?.();
        });
        await page.waitForTimeout(2000);
        assert.equal((await state()).revision, before.revision);
        assert.equal((await state()).bookings.length, before.bookings.length);
        assert.equal(await page.evaluate(() => __voice.cancelCount), cancels);
        assert.match(await page.locator("#phase").textContent(), /Listening/);
        assert.equal(await page.locator("#confirm").isDisabled(), true);
        await page.keyboard.up("Space");
        await page.waitForTimeout(450);
        const s = await state();
        assert.equal(s.revision, before.revision + 1);
        assert.equal(s.draft.items.length, 3);
        assert.equal(
          s.draft.items.find((i) => i.itemId === "tripod").quantity,
          1,
        );
        assert.equal(s.booking, null);
      },
    );
    await check(
      "Late cancelled speech callbacks cannot cancel newer speech or revive speaking state",
      async () => {
        await page.evaluate(() => {
          __voice.stale = __voice.oldUtterance;
          __voice.cancelsBefore = __voice.cancelCount;
          __voice.stale.onstart?.();
          __voice.stale.onend?.();
        });
        assert.equal(
          await page.evaluate(() => __voice.cancelCount),
          await page.evaluate(() => __voice.cancelsBefore),
        );
        await page.locator("#stop").click();
        await page.evaluate(() => {
          const u = __voice.utterances.at(-1);
          u.onstart?.();
          u.onend?.();
        });
        assert.equal(
          await page.locator("#phase").textContent(),
          "Ready when you are",
        );
      },
    );
    await check(
      "Escape and new conversation discard held multi-item corrections and stale callbacks",
      async () => {
        const before = await state();
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() => {
          __voice.staleRecognition = __voice.recognizers.at(-1);
          __voice.staleRecognition.emit("Change the camera to two");
        });
        await page.keyboard.press("Escape");
        await page.keyboard.up("Space");
        await page.evaluate(() => {
          __voice.staleRecognition.emit("confirm booking");
          __voice.staleRecognition.onend?.();
        });
        await page.waitForTimeout(400);
        assert.equal((await state()).revision, before.revision);
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() => {
          __voice.staleRecognition = __voice.recognizers.at(-1);
          __voice.staleRecognition.emit("confirm booking");
          document.getElementById("new").click();
        });
        await page.keyboard.up("Space");
        await ready();
        await page.evaluate(() => {
          __voice.staleRecognition.emit("confirm booking");
          __voice.staleRecognition.onend?.();
          __voice.utterances.at(-1).onstart?.();
        });
        await page.waitForTimeout(400);
        const s = await state();
        assert.notEqual(s.sessionId, before.sessionId);
        assert.equal(s.events.length, 0);
        assert.equal(s.bookings.length, before.bookings.length);
        assert.equal(
          await page.locator("#phase").textContent(),
          "Ready when you are",
        );
      },
    );
    await check(
      "Lost confirmation response recovers exact request without duplicate booking",
      async () => {
        await fresh();
        await voice("one camera and one tripod from June 10 to June 12 2032");
        const before = await state();
        let original, retried;
        await page.route("**/api/turn", async (route) => {
          original = route.request().postDataJSON();
          await route.fetch();
          await route.abort("failed");
        });
        await page.locator("#confirm").click();
        await page.locator("#retry").waitFor({ state: "visible" });
        assert.match(
          await page.locator("#error").textContent(),
          /may already have been saved/,
        );
        assert.equal(await page.locator("#new").isDisabled(), true);
        await page.keyboard.press("Escape");
        assert.match(
          await page.locator("#phase").textContent(),
          /Response missing/,
        );
        assert.equal(
          (await state()).bookings.length,
          before.bookings.length + 1,
        );
        await page.unroute("**/api/turn");
        await page.route("**/api/turn", async (route) => {
          retried = route.request().postDataJSON();
          await route.continue();
        });
        await page.locator("#retry").click();
        await page.waitForFunction(
          () => document.getElementById("status").textContent === "BOOKED",
        );
        assert.deepEqual(retried, original);
        assert.equal(
          (await state()).bookings.length,
          before.bookings.length + 1,
        );
        await page.unroute("**/api/turn");
      },
    );
    await check(
      "Hung request has bounded recovery and Escape never claims cancellation",
      async () => {
        await fresh();
        await voice("one tripod from July 10 to July 12 2032");
        const before = await state();
        await page.evaluate(() => {
          window.__originalFetch = window.fetch;
          window.__hungPayload = null;
          window.fetch = (url, options) => {
            if (url === "/api/turn") {
              window.__hungPayload = JSON.parse(options.body);
              return new Promise(() => {});
            }
            return window.__originalFetch(url, options);
          };
        });
        await page.locator("#confirm").click();
        await page.keyboard.press("Escape");
        assert.match(
          await page.locator("#phase").textContent(),
          /outcome not yet known/,
        );
        assert.equal(await page.locator("#new").isDisabled(), true);
        await page
          .locator("#retry")
          .waitFor({ state: "visible", timeout: 15000 });
        assert.match(
          await page.locator("#error").textContent(),
          /not cancelled/,
        );
        assert.equal((await state()).bookings.length, before.bookings.length);
        const original = await page.evaluate(() => __hungPayload);
        await page.evaluate(() => (window.fetch = window.__originalFetch));
        let retried;
        await page.route("**/api/turn", async (route) => {
          retried = route.request().postDataJSON();
          await route.continue();
        });
        await page.locator("#retry").click();
        await page.waitForFunction(
          () => document.getElementById("status").textContent === "BOOKED",
        );
        assert.deepEqual(retried, original);
        assert.equal(
          (await state()).bookings.length,
          before.bookings.length + 1,
        );
        await page.unroute("**/api/turn");
      },
    );
    await check(
      "Pre-execution overlong transcript rejection permits a fresh valid turn",
      async () => {
        await fresh();
        const before = await state();
        await page.locator("#talk").focus();
        await page.keyboard.down("Space");
        await page.evaluate(() =>
          __voice.recognizers.at(-1).emit("one camera ".repeat(210)),
        );
        await page.keyboard.up("Space");
        await page.waitForFunction(() =>
          document
            .getElementById("error")
            .textContent.includes("rejected before saving"),
        );
        assert.equal(await page.locator("#retry").isVisible(), false);
        assert.equal(await page.locator("#talk").isDisabled(), false);
        assert.equal(await page.locator("#new").isDisabled(), false);
        const rejected = await state();
        assert.equal(rejected.revision, before.revision);
        assert.deepEqual(rejected.bookings, before.bookings);
        assert.deepEqual(rejected.draft, before.draft);
        const valid = await voice(
          "one camera from August 10 to August 12 2032",
        );
        assert.equal(valid.status, "review");
        assert.equal(valid.revision, before.revision + 1);
        assert.equal(valid.booking, null);
        assert.deepEqual(valid.bookings, before.bookings);
      },
    );
    await check(
      "Noisy multi-item correction never drops unknown Camera A or permits partial confirmation",
      async () => {
        await fresh();
        const before = await state();
        for (const text of [
          "phone camera a to tripod B and 1 microphone C from December 17th to December 19th 2026",
          "change a tripods to V",
          "change the tripods to Von",
          "yes tripod B 1",
          "yes",
        ]) {
          const s = await voice(text);
          assert.equal(s.status, "collecting", JSON.stringify(s));
          const pending = service.desk.session(s.sessionId).pending;
          const retained =
            pending?.retainedItems || pending?.patch?.items || s.draft.items;
          assert.equal(retained.length, 3, text);
          assert.equal(
            retained.find((item) => item.itemId === "camera")?.quantity,
            null,
            text,
          );
          assert.equal(s.booking, null);
          assert.equal(s.bookings.length, before.bookings.length);
          assert.equal(await page.locator("#confirm").isVisible(), false);
          if (s.draft.items.some((item) => item.itemId === "camera"))
            assert.match(
              await page.locator("#draft").textContent(),
              /Camera AQuantity not selected/,
            );
        }
        const review = await voice("one Camera A");
        assert.equal(review.status, "review", JSON.stringify(review));
        assert.equal(review.draft.items.length, 3);
        for (const id of ["camera", "tripod", "microphone"])
          assert.equal(
            review.draft.items.find((item) => item.itemId === id).quantity,
            1,
          );
        assert.equal(review.draft.start, "2026-12-17");
        assert.equal(review.draft.end, "2026-12-19");
        const booked = await voice("yes");
        assert.equal(booked.status, "booked");
        assert.equal(booked.booking.items.length, 3);
        assert.equal(booked.bookings.length, before.bookings.length + 1);
      },
    );
    await check(
      "ASR equipment clarification retains unresolved camera from the full order",
      async () => {
        await fresh();
        const before = await state();
        await voice(
          "phone camera a to tripod B and 1 microphone C from December 17th to December 19th 2026",
        );
        const s = await voice("tree pot", ["tripod B"]);
        let pending = service.desk.session(s.sessionId).pending;
        let retained =
          pending?.retainedItems || pending?.patch?.items || s.draft.items;
        assert.equal(retained.length, 3, JSON.stringify(s));
        assert.equal(
          retained.find((item) => item.itemId === "camera")?.quantity,
          null,
        );
        assert.equal(s.booking, null);
        assert.equal(s.bookings.length, before.bookings.length);
        assert.equal(await page.locator("#confirm").isVisible(), false);
        for (const detour of ["How does this work?", "review booking"]) {
          const detoured = await voice(detour);
          pending = service.desk.session(detoured.sessionId).pending;
          retained =
            pending?.retainedItems ||
            pending?.patch?.items ||
            detoured.draft.items;
          assert.equal(retained.length, 3, detour);
          assert.equal(
            retained.find((item) => item.itemId === "camera")?.quantity,
            null,
            detour,
          );
          assert.equal(detoured.booking, null);
          assert.equal(detoured.bookings.length, before.bookings.length);
          assert.equal(await page.locator("#confirm").isVisible(), false);
        }
        const confirmedMeaning = await voice("yes");
        pending = service.desk.session(s.sessionId).pending;
        retained =
          pending?.retainedItems ||
          pending?.patch?.items ||
          confirmedMeaning.draft.items;
        assert.equal(retained.length, 3, JSON.stringify(confirmedMeaning));
        assert.equal(
          retained.find((item) => item.itemId === "camera")?.quantity,
          null,
        );
        assert.equal(confirmedMeaning.booking, null);
        assert.equal(await page.locator("#confirm").isVisible(), false);
      },
    );
    await check("Local readiness check changes no mode, starts no speech and installs nothing", async () => {
      const before = await state();
      const starts = await page.evaluate(() => __voice.recognizers.length);
      await page.locator(".recognition-options summary").click();
      await page.locator("#check-local").click();
      await page.waitForFunction(() => document.getElementById("local-readiness").textContent.includes("Local setup needed"));
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      assert.equal(await page.locator("#talk").isDisabled(), false);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts);
      assert.equal(await page.evaluate(() => __voice.installCalls), 0);
      assert.deepEqual(await state(), before);
      assert.deepEqual(await page.evaluate(() => __voice.availabilityCalls.at(-1)), {
        langs: ["en-US"], processLocally: true, quality: "command",
      });
    });
    await check("Unready local-only mode blocks pointer and keyboard without remote fallback", async () => {
      const before = await state();
      const starts = await page.evaluate(() => __voice.recognizers.length);
      await page.locator("#recognition-mode").selectOption("local");
      await page.waitForFunction(() => document.getElementById("recognition-help").textContent.includes("Local setup needed"));
      assert.equal(await page.locator("#talk").isDisabled(), true);
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.down("Space"); await page.keyboard.up("Space");
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts);
      assert.deepEqual(await state(), before);
      await page.locator("#recognition-mode").selectOption("browser");
      assert.equal(await page.locator("#talk").isDisabled(), false);
    });
    await check("Slow readiness result never switches an explicit browser selection or starts speech", async () => {
      const starts = await page.evaluate(() => __voice.recognizers.length);
      await page.evaluate(() => { __voice.availabilityDelay = 150; __voice.localAvailability = "available"; });
      await page.locator("#recognition-mode").selectOption("local");
      await page.locator("#recognition-mode").selectOption("browser");
      await page.waitForFunction(() => document.getElementById("local-readiness").textContent.includes("ready"));
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts);
      await page.evaluate(() => { __voice.availabilityDelay = 0; });
    });
    await check("Available local-only mode locks settings through listening, finalization and uncertain retry", async () => {
      await fresh();
      await page.locator("#recognition-mode").selectOption("local");
      await page.waitForFunction(() => !document.getElementById("equipment-hints").disabled);
      assert.equal(await page.locator("#equipment-hints").isChecked(), false);
      await page.locator("#equipment-hints").check();
      const before = await state();
      const requests = [];
      let firstDone, releaseResponse;
      const first = new Promise(resolve => { firstDone = resolve; });
      const responseGate = new Promise(resolve => { releaseResponse = resolve; });
      await page.route("**/api/turn", async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          await route.fetch();
          firstDone();
          await responseGate;
          await route.abort();
        } else await route.continue();
      });
      await page.locator("#talk").focus();
      await page.keyboard.down("Space");
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      assert.equal(await page.locator("#equipment-hints").isDisabled(), true);
      assert.equal(await page.locator("#check-local").isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => {
        const r = __voice.recognizers.at(-1);
        r.emit("one Camera A from December 20 to December 22 2026");
        return { local: r.processLocally, quality: r.quality, phrases: r.phrases };
      }), { local: true, quality: "command", phrases: [
        { phrase: "Camera A", boost: 3 }, { phrase: "Tripod B", boost: 3 }, { phrase: "Microphone C", boost: 3 },
      ] });
      await page.keyboard.up("Space");
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      await first;
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      releaseResponse();
      await page.locator("#retry").waitFor({ state: "visible" });
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      await page.evaluate(() => {
        const select = document.getElementById("recognition-mode");
        select.value = "browser"; select.dispatchEvent(new Event("change"));
      });
      assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
      await page.locator("#retry").click();
      await page.waitForFunction(() => !document.getElementById("recognition-mode").disabled);
      await page.unroute("**/api/turn");
      assert.deepEqual(requests[0], requests[1]);
      const after = await state();
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.bookings.length, before.bookings.length);
      assert.equal(after.status, "review");
    });
    await check("Readiness resolving during browser listening cannot change its engine", async () => {
      await page.locator("#recognition-mode").selectOption("browser");
      await page.evaluate(() => { __voice.availabilityDelay = 180; });
      await page.locator("#check-local").click();
      await page.locator("#talk").focus(); await page.keyboard.down("Space");
      const starts = await page.evaluate(() => __voice.recognizers.length);
      await page.waitForTimeout(250);
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts);
      assert.equal(await page.evaluate(() => __voice.recognizers.at(-1).processLocally), false);
      await page.keyboard.press("Escape"); await page.keyboard.up("Space");
      await page.evaluate(() => { __voice.availabilityDelay = 0; });
      await page.locator("#recognition-mode").selectOption("local");
      await page.waitForFunction(() => !document.getElementById("talk").disabled);
    });
    await check("Evidence retains per-turn local mode and hints on the exact retry", async () => {
      await page.locator("#evidence").click();
      const download = page.waitForEvent("download");
      await page.locator("#export").click();
      const exported = JSON.parse(fs.readFileSync(await (await download).path(), "utf8"));
      assert.equal(exported.recognitionSettings.selectedMode, "local");
      assert.match(exported.recognitionSettings.accuracyComparison, /Not measured/);
      const turns = exported.log.filter(e => e.type === "turn-request").slice(-2);
      assert.equal(turns.length, 2);
      assert.deepEqual(turns[0].request, turns[1].request);
      assert.deepEqual(turns[0].recognition, turns[1].recognition);
      assert.equal(turns[0].recognition.localOnly, true);
      assert.equal(turns[0].recognition.quality, "command");
      assert.equal(turns[0].recognition.phrases.length, 3);
      await page.locator("#close").click();
    });
    await check("Stale local availability fails closed without changing selected mode", async () => {
      const before = await state();
      const starts = await page.evaluate(() => { __voice.nextError = "language-not-supported"; return __voice.recognizers.length; });
      await page.locator("#talk").focus(); await page.keyboard.down("Space"); await page.keyboard.up("Space");
      await page.waitForFunction(() => document.getElementById("error").textContent.includes("no remote recognizer"));
      assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
      assert.equal(await page.locator("#talk").isDisabled(), true);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts + 1);
      assert.equal(await page.evaluate(() => __voice.recognizers.at(-1).processLocally), true);
      assert.deepEqual(await state(), before);
    });
    await check("Rejected local hints require deliberate opt-out, not an automatic fallback", async () => {
      const before = await state();
      await page.locator("#check-local").click();
      await page.waitForFunction(() => !document.getElementById("talk").disabled);
      const starts = await page.evaluate(() => { __voice.nextError = "phrases-not-supported"; return __voice.recognizers.length; });
      await page.locator("#talk").focus(); await page.keyboard.down("Space"); await page.keyboard.up("Space");
      await page.waitForFunction(() => document.getElementById("error").textContent.includes("rejected equipment hints"));
      assert.equal(await page.locator("#equipment-hints").isChecked(), true);
      assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
      assert.equal(await page.evaluate(() => __voice.recognizers.length), starts + 1);
      assert.deepEqual(await state(), before);
      await page.locator("#equipment-hints").uncheck();
      await page.locator("#recognition-mode").selectOption("browser");
      await page.locator("#talk").focus(); await page.keyboard.down("Space");
      assert.equal(await page.evaluate(() => __voice.recognizers.at(-1).processLocally), false);
      assert.deepEqual(await page.evaluate(() => __voice.recognizers.at(-1).phrases), []);
      await page.keyboard.press("Escape"); await page.keyboard.up("Space");
      assert.equal(await page.evaluate(() => __voice.installCalls), 0);
    });
    await check("Expanded recognition settings fit mobile without horizontal overflow", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await check("Reload preserves explicit local-only selection and requires fresh readiness", async () => {
      await page.locator("#recognition-mode").selectOption("local");
      await page.waitForFunction(() => !document.getElementById("talk").disabled);
      const before = await state();
      await page.reload(); await ready();
      assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
      assert.equal(await page.locator("#talk").isDisabled(), true);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
      assert.equal(await page.evaluate(() => __voice.availabilityCalls.length), 0);
      assert.deepEqual(await state(), before);
      await page.locator(".recognition-options summary").click();
      await page.locator("#check-local").click();
      await page.waitForFunction(() => document.getElementById("recognition-help").textContent.includes("Local setup needed"));
      assert.equal(await page.locator("#talk").isDisabled(), true);
      await page.locator("#recognition-mode").selectOption("browser");
      await page.reload(); await ready();
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      assert.equal(await page.locator("#talk").isDisabled(), false);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
      assert.deepEqual(await state(), before);
    });
    await check("Local setup requires a deliberate click and never changes mode or starts speech", async () => {
      const before = await state();
      await page.locator(".recognition-options summary").click();
      await page.locator("#check-local").click();
      await page.locator("#setup-local").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => __voice.installCalls), 0);
      await page.evaluate(() => { __voice.installDelay = 300; });
      await page.locator("#setup-local").click();
      assert.equal(await page.locator("#recognition-mode").isDisabled(), true);
      assert.equal(await page.locator("#talk").isDisabled(), true);
      assert.equal(await page.locator("#check-local").isDisabled(), true);
      assert.equal(await page.locator("#new").isDisabled(), true);
      await page.evaluate(() => {
        const select = document.getElementById("recognition-mode");
        select.value = "local"; select.dispatchEvent(new Event("change"));
        document.activeElement.blur();
      });
      await page.keyboard.down("Space"); await page.keyboard.up("Space");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      await page.waitForFunction(() => document.getElementById("setup-status").textContent.includes("fresh check reports local English ready"));
      assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
      assert.equal(await page.evaluate(() => __voice.installCalls), 1);
      assert.deepEqual(await page.evaluate(() => __voice.installOptions[0]), {
        langs: ["en-US"], processLocally: true, quality: "command",
      });
      assert.equal(await page.locator("#recognition-mode").inputValue(), "browser");
      assert.deepEqual(await state(), before);
    });
    await check("Setup denial, false result and success without readiness never retry or fall back", async () => {
      const before = await state();
      for (const scenario of [
        { error: "NotAllowedError", result: true, readiness: "downloadable", text: "NotAllowedError" },
        { error: null, result: false, readiness: "downloadable", text: "reported setup did not complete" },
        { error: null, result: true, readiness: "downloading", text: "readiness check returned downloading" },
      ]) {
        await page.evaluate(s => {
          __voice.localAvailability = "downloadable"; __voice.installDelay = 0;
          __voice.installError = s.error; __voice.installResult = s.result;
          __voice.installedAvailability = s.readiness;
        }, scenario);
        await page.locator("#recognition-mode").selectOption("local");
        await page.locator("#check-local").click();
        await page.locator("#setup-local").waitFor({ state: "visible" });
        const count = await page.evaluate(() => __voice.installCalls);
        await page.locator("#setup-local").click();
        await page.waitForFunction(text => document.getElementById("setup-status").textContent.includes(text), scenario.text);
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => __voice.installCalls), count + 1);
        assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
        assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
        assert.equal(await page.locator("#talk").isDisabled(), true);
        assert.deepEqual(await state(), before);
      }
      await page.locator("#recognition-mode").selectOption("browser");
    });
    await check("Corrupt preference blocks speech and a failed preference write is visible", async () => {
      await page.evaluate(() => localStorage.setItem("rental-studio-v2-recognition-mode", "unexpected"));
      await page.reload(); await ready();
      assert.equal(await page.locator("#recognition-mode").inputValue(), "unselected");
      assert.equal(await page.locator("#talk").isDisabled(), true);
      await page.keyboard.down("Space"); await page.keyboard.up("Space");
      assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
      await page.locator(".recognition-options summary").click();
      await page.locator("#recognition-mode").selectOption("browser");
      await page.evaluate(() => {
        window.__originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === "rental-studio-v2-recognition-mode") throw new Error("Synthetic storage failure");
          return window.__originalSetItem.call(this, key, value);
        };
      });
      await page.locator("#recognition-mode").selectOption("local");
      assert.match(await page.locator("#error").textContent(), /could not be saved/);
      assert.equal(await page.locator("#recognition-mode").inputValue(), "local");
      assert.equal(await page.locator("#talk").isDisabled(), true);
      await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
    });
    await check("Unreadable stored mode cannot silently select a remote-capable recognizer", async () => {
      await page.addInitScript(() => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function(key) {
          if (key === "rental-studio-v2-recognition-mode") throw new Error("Synthetic storage read failure");
          return original.call(this, key);
        };
      });
      await page.reload(); await ready();
      assert.equal(await page.locator("#recognition-mode").inputValue(), "unselected");
      assert.equal(await page.locator("#talk").isDisabled(), true);
      assert.equal(await page.evaluate(() => __voice.recognizers.length), 0);
      assert.equal(await page.evaluate(() => __voice.installCalls), 0);
    });
    await check("No page JavaScript errors throughout", async () =>
      assert.deepEqual(errors, []),
    );
    fs.writeFileSync(
      path.join(root, "evidence", "browser-results.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          kind: "actual-installed-Chrome-with-synthetic-speech",
          browser: await browser.version(),
          count: results.length,
          results,
          acousticEvidence: false,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(`ALL ${results.length} CHECKS PASSED`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (service) {
      service.server.closeAllConnections();
      await new Promise((r) => service.server.close(r));
      service.desk.close();
    }
  }
})();
