import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController, inspectLocalRecognition, EQUIPMENT_PHRASES } from '../public/voice-controller.js';

function fixture({ status = 'available', quality = true } = {}) {
  const calls = { start: [], availability: [], install: 0 };
  class Recognition {
    constructor() {
      this.processLocally = false;
      this.phrases = [];
      if (quality) this.quality = 'command';
    }
    static available(options) { calls.availability.push(options); return Promise.resolve(status); }
    static install() { calls.install++; throw new Error('Installation is forbidden in these checks'); }
    start() { calls.start.push(this); }
    stop() {}
    abort() { this.onend?.(); }
  }
  class Phrase {
    constructor(phrase, boost) { Object.assign(this, { phrase, boost }); }
  }
  return { Recognition, Phrase, calls };
}

test('local capability check is read-only, with exact local language and quality options', async () => {
  const { Recognition, Phrase, calls } = fixture();
  assert.deepEqual(await inspectLocalRecognition(Recognition, Phrase), {
    status: 'available', phraseSupport: true, quality: 'command',
  });
  assert.deepEqual(calls.availability, [{ langs: ['en-US'], processLocally: true, quality: 'command' }]);
  assert.deepEqual(calls.start, []);
  assert.equal(calls.install, 0);
});

for (const status of ['downloadable', 'downloading', 'unavailable']) {
  test(`local ${status} cannot start recognition or trigger setup`, async () => {
    const { Recognition, Phrase, calls } = fixture({ status });
    const capability = await inspectLocalRecognition(Recognition, Phrase);
    const errors = [];
    const controller = new VoiceController({ Recognition, Phrase, onError: e => errors.push(e) });
    controller.start({ mode: 'local', localAvailable: capability.status === 'available' });
    assert.equal(capability.status, status);
    assert.deepEqual(errors, ['local-not-ready']);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.install, 0);
  });
}

test('capability check fails closed for absent APIs and spoofed local property', async () => {
  assert.equal((await inspectLocalRecognition()).status, 'unsupported');
  class MissingLocal { static async available() { throw new Error('Should not be called'); } }
  assert.equal((await inspectLocalRecognition(MissingLocal)).status, 'unsupported');
  class IgnoredLocal extends MissingLocal {
    get processLocally() { return false; }
    set processLocally(value) {}
  }
  assert.equal((await inspectLocalRecognition(IgnoredLocal)).status, 'unsupported');
});

test('rejected, unrecognized and stalled capability responses remain unusable', async () => {
  const { Recognition, Phrase, calls } = fixture({ status: 'new-status' });
  assert.equal((await inspectLocalRecognition(Recognition, Phrase)).status, 'unknown');
  Recognition.available = async () => { throw new Error('Policy denied'); };
  assert.equal((await inspectLocalRecognition(Recognition, Phrase)).status, 'check-failed');
  Recognition.available = () => new Promise(() => {});
  assert.equal((await inspectLocalRecognition(Recognition, Phrase, 5)).status, 'check-timeout');
  assert.equal(calls.start.length, 0);
  assert.equal(calls.install, 0);
});

test('older local API without quality or phrases is detected honestly', async () => {
  const { Recognition, calls } = fixture({ quality: false });
  assert.deepEqual(await inspectLocalRecognition(Recognition), {
    status: 'available', phraseSupport: false, quality: 'browser-default',
  });
  assert.deepEqual(calls.availability, [{ langs: ['en-US'], processLocally: true }]);
});

test('browser-default mode leaves local, quality, and phrase settings untouched', () => {
  const { Recognition, Phrase, calls } = fixture();
  const controller = new VoiceController({ Recognition, Phrase });
  controller.start({ mode: 'browser', phraseHints: true });
  const [recognition] = calls.start;
  assert.equal(recognition.processLocally, false);
  assert.equal(recognition.quality, 'command');
  assert.deepEqual(recognition.phrases, []);
  assert.deepEqual(calls.availability, []);
  controller.abort();
});

test('local mode applies local-only and equipment phrases before start, with per-turn attribution', async () => {
  const { Recognition, Phrase, calls } = fixture();
  const finals = [], events = [];
  const controller = new VoiceController({ Recognition, Phrase, settleMs: 1,
    onFinal: (...args) => finals.push(args), onEvent: e => events.push(e) });
  controller.start({ mode: 'local', localAvailable: true, phraseHints: true });
  const [recognition] = calls.start;
  assert.equal(recognition.processLocally, true);
  assert.equal(recognition.quality, 'command');
  assert.deepEqual(recognition.phrases.map(p => p.phrase), [...EQUIPMENT_PHRASES]);
  assert.ok(recognition.phrases.every(p => p.boost === 3));
  recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'one Camera A', confidence: .9 }], { isFinal: true })] });
  controller.release(); recognition.onend();
  await new Promise(r => setTimeout(r, 15));
  assert.equal(finals.length, 1);
  assert.equal(finals[0][0], 'one Camera A');
  assert.deepEqual(finals[0][2], { mode: 'local', language: 'en-US', localOnly: true,
    quality: 'command', phrases: EQUIPMENT_PHRASES.map(phrase => ({ phrase, boost: 3 })) });
  assert.deepEqual(events.find(e => e.type === 'start-request').recognition.phrases, []);
  assert.equal(events.find(e => e.type === 'configured').recognition.phrases.length, 3);
  assert.equal(calls.install, 0);
});

test('local runtime error cannot silently start a remote recognizer', () => {
  const { Recognition, Phrase, calls } = fixture();
  const errors = [];
  const controller = new VoiceController({ Recognition, Phrase, onError: e => errors.push(e) });
  controller.start({ mode: 'local', localAvailable: true });
  calls.start[0].onerror({ error: 'language-not-supported' });
  assert.deepEqual(errors, ['language-not-supported']);
  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0].processLocally, true);
  assert.equal(controller.active, false);
});

test('local mode does not trust a cached capability when properties are absent', () => {
  const calls = [], errors = [];
  class Recognition { start() { calls.push(this); } abort() {} }
  const controller = new VoiceController({ Recognition, onError: e => errors.push(e) });
  controller.start({ mode: 'local', localAvailable: true });
  assert.equal(calls.length, 0);
  assert.deepEqual(errors, ['local-not-supported']);
});

test('hint support failure discards the local attempt without cloud fallback', () => {
  const { Recognition, calls } = fixture();
  const errors = [];
  const controller = new VoiceController({ Recognition, onError: e => errors.push(e) });
  controller.start({ mode: 'local', localAvailable: true, phraseHints: true });
  assert.equal(calls.start.length, 0);
  assert.deepEqual(errors, ['phrases-not-supported']);
});

test('local hints are opt-in and subsequent browser turns are reversible', () => {
  const { Recognition, Phrase, calls } = fixture();
  const controller = new VoiceController({ Recognition, Phrase });
  controller.start({ mode: 'local', localAvailable: true });
  assert.deepEqual(calls.start[0].phrases, []);
  controller.abort();
  controller.start();
  assert.equal(calls.start[1].processLocally, false);
  assert.equal(controller.configuration.mode, 'browser');
  controller.abort();
});

test('a browser that ignores phrase assignment cannot claim hints were applied', () => {
  const { Recognition: Base, Phrase, calls } = fixture();
  class Recognition extends Base {
    get phrases() { return []; }
    set phrases(value) {}
  }
  const errors = [];
  const controller = new VoiceController({ Recognition, Phrase, onError: e => errors.push(e) });
  controller.start({ mode: 'local', localAvailable: true, phraseHints: true });
  assert.equal(calls.start.length, 0);
  assert.deepEqual(errors, ['phrases-not-supported']);
});
