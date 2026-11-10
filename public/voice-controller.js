/**
 * Browser recognition is asynchronous. Release requests stop; it is not a final
 * transcript. Only the authoritative result list after the recognizer ends may
 * leave this controller. Provisional speech never grants booking permission.
 */
export const EQUIPMENT_PHRASES = Object.freeze(['Camera A', 'Tripod B', 'Microphone C']);

// Capability inspection only: never call start() or install() here. A browser
// may mask an existing pack as "downloadable" until this origin completes setup.
export async function inspectLocalRecognition(Recognition, Phrase, timeoutMs = 5000) {
  let timer;
  try {
    if (typeof Recognition !== 'function' || typeof Recognition.available !== 'function')
      return { status: 'unsupported', phraseSupport: false };
    const recognition = new Recognition();
    if (!('processLocally' in recognition))
      return { status: 'unsupported', phraseSupport: false };
    recognition.processLocally = true;
    if (recognition.processLocally !== true)
      return { status: 'unsupported', phraseSupport: false };
    const qualitySupported = 'quality' in recognition;
    if (qualitySupported) {
      recognition.quality = 'command';
      if (recognition.quality !== 'command')
        return { status: 'unsupported', phraseSupport: false };
    }
    const phraseSupport = 'phrases' in recognition && typeof Phrase === 'function';
    const status = await Promise.race([
      Recognition.available({ langs: ['en-US'], processLocally: true,
        ...(qualitySupported ? { quality: 'command' } : {}) }),
      new Promise(resolve => { timer = setTimeout(() => resolve('check-timeout'), timeoutMs); }),
    ]);
    return {
      status: ['available', 'downloadable', 'downloading', 'unavailable', 'check-timeout'].includes(status)
        ? status : 'unknown',
      phraseSupport,
      quality: qualitySupported ? 'command' : 'browser-default',
    };
  } catch {
    return { status: 'check-failed', phraseSupport: false };
  } finally {
    clearTimeout(timer);
  }
}

export class VoiceController {
  constructor({
    Recognition,
    Phrase,
    onState = () => {},
    onTranscript = () => {},
    onFinal = () => {},
    onError = () => {},
    onEvent = () => {},
    stopAudio = () => {},
    timeoutMs = 15000,
    settleMs = 250,
    waitingNoticeMs = 3000,
  }) {
    Object.assign(this, {
      Recognition, Phrase, onState, onTranscript, onFinal, onError, onEvent,
      stopAudio, timeoutMs, settleMs, waitingNoticeMs,
    });
    this.generation = 0;
    this.active = false;
  }

  event(type, data = {}) {
    this.onEvent({
      type,
      elapsedMs: Math.round(performance.now() - (this.startedAt || performance.now())),
      recognition: this.configuration ? structuredClone(this.configuration) : null,
      ...data,
    });
  }

  start({ mode = 'browser', localAvailable = false, phraseHints = false } = {}) {
    this.abort();
    this.stopAudio();
    const token = ++this.generation;
    this.startedAt = performance.now();
    this.active = this.held = true;
    this.done = this.ended = false;
    this.results = new Map();
    this.configuration = {
      mode, language: 'en-US', localOnly: mode === 'local',
      quality: 'browser-default', phrases: [],
    };
    this.event('start-request');
    this.onState('listening');
    try {
      if (!['browser', 'local'].includes(mode)) return this.fail(token, 'unsupported-mode');
      if (mode === 'local' && !localAvailable) return this.fail(token, 'local-not-ready');
      const recognition = (this.recognition = new this.Recognition());
      if (mode === 'local') {
        if (!('processLocally' in recognition)) return this.fail(token, 'local-not-supported');
        recognition.processLocally = true;
        if (recognition.processLocally !== true) return this.fail(token, 'local-not-supported');
        if ('quality' in recognition) {
          recognition.quality = 'command';
          if (recognition.quality !== 'command') return this.fail(token, 'local-not-supported');
          this.configuration.quality = 'command';
        }
        if (phraseHints) {
          if (!('phrases' in recognition) || typeof this.Phrase !== 'function')
            return this.fail(token, 'phrases-not-supported');
          try {
            recognition.phrases = EQUIPMENT_PHRASES.map(phrase => new this.Phrase(phrase, 3));
            const applied = Array.from(recognition.phrases || []);
            if (applied.length !== EQUIPMENT_PHRASES.length ||
                applied.some((value, index) => value.phrase !== EQUIPMENT_PHRASES[index] || value.boost !== 3))
              return this.fail(token, 'phrases-not-supported');
            this.configuration.phrases = EQUIPMENT_PHRASES.map(phrase => ({ phrase, boost: 3 }));
          } catch {
            return this.fail(token, 'phrases-not-supported');
          }
        }
      }
      Object.assign(recognition, {
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 4,
      });
      this.event('configured');
      for (const name of ['start', 'audiostart', 'audioend', 'speechstart', 'speechend']) {
        recognition['on' + name] = () => {
          if (token === this.generation && !this.done) this.event(name);
        };
      }
      recognition.onresult = (event) => {
        if (token !== this.generation || this.done) return;
        // SpeechRecognitionEvent.results is the COMPLETE current list. Interim
        // entries can disappear when Chrome replaces them with a final result.
        // Keeping the old tail creates phantom unfinished speech and false errors.
        const previousLength = this.results.size;
        const current = new Map();
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          current.set(index, {
            final: result.isFinal === true,
            choices: Array.from(result).map((choice) => ({
              transcript: String(choice.transcript || ''),
              confidence: choice.confidence,
            })),
          });
        }
        this.results = current;
        const entries = [...current.values()];
        const finalCount = entries.filter((r) => r.final).length;
        const interimCount = entries.length - finalCount;
        this.event('result', {
          resultIndex: event.resultIndex,
          resultCount: entries.length,
          finalCount,
          interimCount,
          removedEntries: Math.max(0, previousLength - entries.length),
          afterRelease: !this.held,
          afterEnd: this.ended,
        });
        this.onTranscript(
          entries.map((r) => r.choices[0]?.transcript || '').join(' ').trim(),
          { provisional: interimCount > 0, finalCount, interimCount },
        );
        // A result queued just after onend updates the authoritative list and
        // gets the same short settling window instead of racing finalization.
        if (this.ended && !this.held) this.scheduleFinish(token);
      };
      recognition.onend = () => {
        if (token !== this.generation || this.done) return;
        this.ended = true;
        this.event('end', { held: this.held });
        if (this.held) {
          this.fail(token, 'recognition-ended-before-release');
          return;
        }
        this.scheduleFinish(token);
      };
      recognition.onerror = (event) => {
        if (token !== this.generation || this.done) return;
        this.event('recognition-error', { error: event.error });
        if (event.error === 'no-speech') return;
        this.fail(token, event.error || 'recognition-error');
      };
      recognition.start();
    } catch {
      this.fail(token, 'start-failed');
    }
  }

  release() {
    if (!this.held || this.done) return;
    this.held = false;
    this.onState('finalizing');
    this.event('stop-request', { deadlineMs: this.timeoutMs });
    const token = this.generation;
    this.deadlineTimer = setTimeout(() => {
      if (token !== this.generation || this.done) return;
      this.event('finalization-deadline');
      // A deadline is a failure boundary, never evidence the full turn ended.
      this.fail(token, 'finalization-timeout');
    }, this.timeoutMs);
    this.waitingTimer = setTimeout(() => {
      if (token === this.generation && !this.done) this.event('waiting-for-final');
    }, this.waitingNoticeMs);
    if (this.ended) return this.scheduleFinish(token);
    try {
      this.recognition.stop();
    } catch {
      this.fail(token, 'stop-failed');
    }
  }

  scheduleFinish(token) {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.finish(token), this.settleMs);
  }

  finish(token) {
    if (token !== this.generation || this.done || this.held || !this.ended) return;
    const entries = [...this.results.values()];
    const incomplete = entries.some((result) =>
      !result.final && result.choices.some((choice) => choice.transcript.trim()),
    );
    if (incomplete) return this.fail(token, 'incomplete-speech');
    const results = entries.filter((r) => r.final);
    const transcript = results.map((r) => r.choices[0]?.transcript || '').join(' ').trim();
    if (!transcript) return this.fail(token, 'no-final-speech');
    const alternatives = [];
    for (let rank = 1; rank < 4; rank++) {
      const choices = results.map((r) => r.choices[rank] || r.choices[0]);
      const candidate = choices.map((c) => c?.transcript || '').join(' ').trim();
      if (candidate && candidate !== transcript && !alternatives.some((a) => a.transcript === candidate)) {
        alternatives.push({
          transcript: candidate,
          confidence: Math.min(...choices.map((c) => c?.confidence || 0)),
        });
      }
    }
    this.event('finalized', { segmentCount: results.length, alternatives: alternatives.length });
    this.cleanup();
    this.onState('idle');
    this.onFinal(transcript, alternatives, structuredClone(this.configuration));
  }

  fail(token, error) {
    if (token !== this.generation || this.done) return;
    this.event('discarded', { error });
    this.cleanup();
    this.onState('idle');
    this.onError(error);
  }

  cleanup() {
    // Mark done BEFORE abort: implementations may synchronously dispatch onend.
    this.done = true;
    this.active = this.held = false;
    for (const timer of [this.deadlineTimer, this.settleTimer, this.waitingTimer]) clearTimeout(timer);
    const recognition = this.recognition;
    this.recognition = null;
    try { recognition?.abort(); } catch { /* Already ended; no live result can be reused. */ }
  }

  abort() {
    this.generation++;
    this.cleanup();
  }
}
