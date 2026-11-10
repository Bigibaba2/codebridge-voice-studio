/* Headless synthetic-only QA. Never targets a running app or real profile. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
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

(async()=>{
 let service,browser;
 try{
  if(process.env.UI_BASE_URL)throw Error('External or live targets are forbidden.');
  const {createService}=await import('../src/server.js');
  let now=Date.now();
  service=createService({reviewerMode:true,reviewerOptions:{now:()=>now}});
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${service.server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const a=await browser.newContext(),b=await browser.newContext();
  for(const context of [a,b])await context.addInitScript(fakeSpeech);
  const page=await a.newPage(),other=await b.newPage(),errors=[];
  for(const p of [page,other])p.on('pageerror',e=>errors.push(e.message));
  const ready=async p=>p.waitForFunction(()=>document.getElementById('talk').disabled===false);
  await page.goto(base);await ready(page);await other.goto(base);await ready(other);
  assert.equal(await page.locator('#temporary-notice').isVisible(),true);
  assert.match(await page.locator('#temporary-notice').innerText(),/separate simulated catalog/);
  assert.match(await page.locator('#privacy').innerText(),/demo workspace/);
  const cookie=(await a.cookies()).find(c=>c.name==='__Host-codebridge-reviewer');
  assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');
  assert.ok(!(await page.evaluate(()=>document.cookie)).includes(cookie.value));
  const state=async p=>p.evaluate(()=>fetch('/api/sessions/'+localStorage.getItem('rental-studio-v2-session')).then(r=>r.json()));
  const press=async()=>{await page.bringToFront();await page.locator('#talk').scrollIntoViewIfNeeded();const box=await page.locator('#talk').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForFunction(()=>window.__voice.recognizers.at(-1)?.live);};
  const speak=async(text)=>{
   const old=(await state(page)).revision;
   await press();
   await page.evaluate(text=>window.__voice.recognizers.at(-1).emit(text,true),text);
   await page.mouse.up();
   await page.waitForFunction(async old=>{const s=await fetch('/api/sessions/'+localStorage.getItem('rental-studio-v2-session')).then(r=>r.json());return s.revision>old;},old);
   await ready(page);
  };
  await speak('one microphone November 5 through November 6 2026');
  await page.locator('#confirm').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='BOOKED');
  const booked=await state(page);assert.ok(booked.booking);
  const unseen=await state(other);assert.equal(unseen.bookings.length,1);
  const cross=await other.evaluate(async id=>{const r=await fetch('/api/sessions/'+id);return {status:r.status,data:await r.json()};},booked.sessionId);assert.equal(cross.status,404);assert.equal(cross.data.state,undefined);
  await page.reload();await ready(page);assert.equal((await state(page)).booking.id,booked.booking.id);
  // Export is user-triggered; hosted diagnostic log contains no raw ASR capture.
  await page.locator('#evidence').click();const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
  const stream=await download.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk;assert.deepEqual(JSON.parse(raw).log,[]);await page.locator('#close').click();
  now+=30*60*1000;
  await page.reload();await ready(page);
  assert.match(await page.locator('#error').innerText(),/not restored/);assert.equal((await state(page)).bookings.length,1);assert.notEqual((await state(page)).sessionId,booked.sessionId);
  // Expiry during an active turn clears stale UI and permits explicit recovery.
  now+=30*60*1000;
  await press();
  await page.evaluate(()=>window.__voice.recognizers.at(-1).emit('one camera',true));
  await page.mouse.up();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='EXPIRED');
  assert.equal(await page.locator('#confirm').isVisible(),false);assert.equal(await page.locator('#talk').isDisabled(),true);assert.equal(await page.locator('#retry').isVisible(),false);assert.match(await page.locator('#reply').innerText(),/not restored/);
  await page.locator('#new').click();await ready(page);assert.equal((await state(page)).revision,0);
  const failed=await browser.newContext();await failed.addInitScript(fakeSpeech);
  const failedPage=await failed.newPage();let sessionRequests=0;
  failedPage.on('request',r=>{if(r.url().endsWith('/api/sessions'))sessionRequests++;});
  await failedPage.route('**/api/config',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic cold start"}'}));
  await failedPage.goto(base);await failedPage.waitForFunction(()=>document.getElementById('error').textContent.includes('Server unavailable'));
  await failedPage.locator('#new').click();assert.equal(sessionRequests,0);
  assert.match(await failedPage.locator('#error').innerText(),/Configuration unavailable/);
  assert.deepEqual(errors,[]);
  console.log('PASS: 2 fresh browser contexts, HttpOnly/Secure cookie, visible temporary notice, synthetic booking, cross-owner isolation, reload persistence within lifetime, empty diagnostic export, expiry reload warning, expired-turn UI clearing, explicit new-conversation recovery; cold-start configuration gate, no page errors. No microphone/audio/acoustic evidence.');
 }finally{
  await browser?.close();
  if(service){service.server.closeAllConnections();await new Promise(r=>service.server.close(r));service.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
