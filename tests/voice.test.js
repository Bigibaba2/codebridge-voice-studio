import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../public/voice-controller.js';
const wait = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
const result = (text, final = true, alternatives = []) => Object.assign(
  [text, ...alternatives].map(transcript => ({ transcript, confidence: .9 })),
  { isFinal: final }
);
class FakeRecognition {
  start() { FakeRecognition.current = this; }
  stop() {}
  abort() { this.onend?.(); }
  emit(results, resultIndex = 0) { this.onresult({ results, resultIndex }); }
}
function setup(options = {}) {
  const finals = [], errors = [], diagnostics = [];
  const controller = new VoiceController({
    Recognition: FakeRecognition,
    onFinal: (...args) => finals.push(args),
    onError: error => errors.push(error),
    onEvent: event => diagnostics.push(event),
    timeoutMs: 80, settleMs: 5, ...options
  });
  controller.start();
  return { controller, recognition: FakeRecognition.current, finals, errors, diagnostics };
}
test('production finalization deadline is 15 seconds', () => {
  const controller = new VoiceController({ Recognition: FakeRecognition });
  assert.equal(controller.timeoutMs, 15000);
});
test('authoritative result shrink removes stale trailing interim and submits once', async () => {
  const { controller, recognition, finals } = setup();
  recognition.emit([result('two tripod B'), result('B', false)]);
  controller.release();
  recognition.emit([result('two tripod B')]);
  recognition.onend(); await wait(); recognition.onend(); await wait();
  assert.equal(finals.length, 1);
  assert.equal(finals[0][0], 'two tripod B');
});
test('release waits for delayed final instead of submitting interim', async () => {
  const { controller, recognition, finals } = setup({ timeoutMs: 3000 });
  recognition.emit([result('two tripod B', false)]); controller.release();
  await wait(2550); assert.equal(finals.length, 0);
  recognition.emit([result('two tripod B')]); recognition.onend(); await wait();
  assert.equal(finals.length, 1);
});
test('queued final arriving after end within settle interval is accepted', async () => {
  const { controller, recognition, finals } = setup({ settleMs: 30 });
  recognition.emit([result('two tripod B', false)]); controller.release();
  recognition.onend(); await wait(5);
  recognition.emit([result('two tripod B')]); await wait(45);
  assert.equal(finals.length, 1);
});
test('deadline without end discards even final speech and ignores late callbacks', async () => {
  const { controller, recognition, finals, errors } = setup({ timeoutMs: 20 });
  recognition.emit([result('yes')]); controller.release(); await wait(40);
  recognition.onend(); recognition.emit([result('yes')]); await wait();
  assert.equal(finals.length, 0); assert.ok(errors.length);
});
test('unexpected early end aborts entire held turn', async () => {
  const { controller, recognition, finals, errors } = setup();
  recognition.emit([result('yes')]); recognition.onend(); controller.release(); await wait();
  assert.equal(finals.length, 0); assert.ok(errors.length);
});
test('genuine trailing interim correction never submits finalized yes', async () => {
  const { controller, recognition, finals } = setup();
  recognition.emit([result('yes'), result('but wait make that', false)]);
  controller.release(); recognition.onend(); await wait();
  assert.equal(finals.length, 0);
});
test('interim-only confirmation is never submitted', async () => {
  const { controller, recognition, finals } = setup();
  recognition.emit([result('yes', false)]); controller.release(); recognition.onend(); await wait();
  assert.equal(finals.length, 0);
});
test('abort and new generation ignore old results and end callbacks', async () => {
  const { controller, recognition, finals } = setup();
  recognition.emit([result('yes')]); controller.release(); controller.abort(); controller.start();
  const current = FakeRecognition.current;
  recognition.emit([result('confirm booking')]); recognition.onend();
  current.emit([result('one camera')]); controller.release(); current.onend(); await wait();
  assert.deepEqual(finals.map(turn => turn[0]), ['one camera']);
});
test('alternatives cover all segments, repeated indexes do not duplicate', async () => {
  const { controller, recognition, finals } = setup();
  recognition.emit([result('one camera', true, ['two cameras'])]);
  recognition.emit([result('one camera', true, ['two cameras']), result('in December', true, ['in November'])]);
  controller.release(); recognition.onend(); await wait();
  assert.equal(finals[0][0], 'one camera in December');
  assert.deepEqual(finals[0][1].map(a => a.transcript), ['two cameras in November']);
});
test('empty or unsupported recognition payload cannot create a turn', async () => {
  const { controller, recognition, finals } = setup();
  // Empty result lists are valid during browser shutdown; malformed entries must fail closed.
  for (const results of [[], [Object.assign([], { isFinal: true })]]) {
    assert.doesNotThrow(() => recognition.emit(results));
  }
  controller.release(); recognition.onend(); await wait();
  assert.equal(finals.length, 0);
});
