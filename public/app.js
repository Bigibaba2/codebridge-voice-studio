import { VoiceController, inspectLocalRecognition } from "./voice-controller.js";
const $ = (id) => document.getElementById(id),
  key = "rental-studio-v2-session",
  recognitionPreferenceKey = "rental-studio-v2-recognition-mode";
let hostedReviewer = false, configReady = false;
let state,
  held = false,
  busy = false,
  generation = 0,
  audioGeneration = 0,
  pending = null,
  pendingRecognition = null,
  voice = true,
  releaseAt = null;
const log = [];
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const Phrase = window.SpeechRecognitionPhrase;
function savedRecognitionMode() {
  try {
    const saved = localStorage.getItem(recognitionPreferenceKey);
    return saved === null ? "browser" : ["browser", "local"].includes(saved) ? saved : "unselected";
  } catch { return "unselected"; }
}
let recognitionMode = savedRecognitionMode(),
  phraseHints = false,
  setupInProgress = false,
  setupStatus = "",
  capabilityGeneration = 0,
  localCapability = { status: "unchecked", phraseSupport: false };
function recognitionLocked() {
  return busy || Boolean(pending) || held || finalizing || setupInProgress;
}
function renderRecognition() {
  const local = recognitionMode === "local";
  const locked = recognitionLocked();
  $("recognition-mode").value = recognitionMode;
  $("recognition-mode").disabled = locked;
  $("check-local").disabled = locked || localCapability.status === "checking";
  $("setup-local").hidden = localCapability.status !== "downloadable" && !setupInProgress;
  $("setup-local").disabled = locked || typeof Recognition?.install !== "function" ||
    localCapability.status !== "downloadable" || localCapability.quality !== "command";
  $("setup-note").hidden = $("setup-local").hidden;
  $("setup-status").textContent = setupStatus;
  $("equipment-hints").checked = phraseHints;
  $("equipment-hints").disabled = locked || !local ||
    localCapability.status !== "available" || !localCapability.phraseSupport;
  $("hint-option").hidden = !local;
  const localLanguage = localCapability.quality === "command"
    ? "English (US), command tier" : "English (US)";
  const readiness = {
        unchecked: "Check local support before speaking. No audio is captured by this check.",
        checking: "Checking on-device English (US) support. No microphone or download is started.",
        available: `This browser reports on-device ${localLanguage} ready. ${localCapability.phraseSupport ? "Hints are optional." : "Equipment hints are not supported here."} Accuracy improvement is not established.`,
        downloadable: `Local setup needed for ${localLanguage}. Choose Setup local English, or keep using Browser default.`,
        downloading: "This browser reports local setup in progress. Wait and check again. Local speech remains blocked until ready.",
        unavailable: "On-device English (US) is unavailable in this browser. Select Browser default to use the existing recognizer.",
        unsupported: "This browser cannot verify on-device-only recognition. Select Browser default to use the existing recognizer.",
        "check-timeout": "The local support check timed out. Check again, or select Browser default. No microphone was started.",
        "check-failed": "Local support could not be checked. Browser permissions or policy may block it. Check again, or select Browser default.",
        unknown: "This browser returned an unknown local status. Nothing will start in local mode. Check again, or select Browser default.",
      }[localCapability.status];
  $("recognition-help").textContent = local
    ? readiness
    : recognitionMode === "unselected"
      ? "The saved recognition choice could not be read. Choose a mode before speaking."
      : "On-device only is experimental. Accuracy improvement is not established.";
  $("local-readiness").textContent = !local && localCapability.status !== "unchecked" ? readiness : "";
  $("privacy").textContent = recognitionMode === "unselected"
    ? "Recognition is blocked until you choose a mode. This app does not store audio."
    : local
    ? "On-device-only recognition is selected. There is no automatic remote fallback. Transcripts are saved in this demo workspace; this app does not store audio."
    : "Your browser’s speech provider may receive audio. Transcripts are saved in this demo workspace. This app does not store audio.";
}
async function checkLocalRecognition() {
  if (recognitionLocked() || localCapability.status === "checking") return;
  const token = ++capabilityGeneration;
  localCapability = { status: "checking", phraseSupport: false };
  render();
  const result = await inspectLocalRecognition(Recognition, Phrase);
  if (token !== capabilityGeneration) return;
  localCapability = result;
  record("local-capability-check", result);
  render();
}
async function setupLocalRecognition() {
  if (recognitionLocked() || localCapability.status !== "downloadable" ||
      localCapability.quality !== "command" || typeof Recognition?.install !== "function") return;
  setupInProgress = true;
  setupStatus = "Chrome is setting up local English. This may download language resources; the size is controlled by Chrome. No microphone is started. Keep this page open.";
  stopAudio();
  phase("Setting up local English");
  render();
  const options = { langs: ["en-US"], processLocally: true, quality: "command" };
  record("local-setup-request", { options, selectedMode: recognitionMode });
  let installed = null, error = null;
  try { installed = await Recognition.install(options); }
  catch (e) { error = e?.name || "SetupError"; }
  localCapability = await inspectLocalRecognition(Recognition, Phrase);
  const ready = localCapability.status === "available";
  record("local-setup-result", { installed, error, readiness: localCapability, selectedMode: recognitionMode });
  setupStatus = installed === true && ready
    ? "Chrome reported setup complete, and a fresh check reports local English ready. Your recognition mode is unchanged; select On-device only when you want to try it. No microphone was started."
    : `Chrome ${error ? `could not complete setup (${error})` : installed === true ? "reported setup complete" : installed === false ? "reported setup did not complete" : "returned without verified setup success"}. ${ready ? "A fresh check reports local English ready." : `A fresh readiness check returned ${localCapability.status}; local speech stays blocked.`} Nothing was retried and no microphone was started.`;
  setupInProgress = false;
  phase("Ready when you are");
  render();
}
function record(type, data = {}) {
  if (hostedReviewer) return;
  log.push({ type, at: new Date().toISOString(), ...data });
}
function phase(text) {
  $("phase").textContent = text;
}
function stopAudio() {
  audioGeneration++;
  window.speechSynthesis?.cancel();
}
function speak(text, token) {
  if (!voice || held || token !== generation || !text) return;
  stopAudio();
  const audioToken = audioGeneration;
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => /^en[-_]/i.test(v.lang));
  u.voice =
    voices.find((v) => v.localService && /Samantha|Daniel/i.test(v.name)) ||
    voices.find(
      (v) =>
        v.localService &&
        !/novelty|whisper|robot|zarvox|trinoids|bubbles|bells|boing|bad.?news|good.?news|hysterical|cellos|jester|organ|wobble|bahh|albert|fred|deranged/i.test(
          v.name,
        ),
    ) ||
    null;
  u.lang = u.voice?.lang || "en-US";
  u.rate = 1;
  u.onstart = () => {
    if (
      audioToken !== audioGeneration ||
      token !== generation ||
      held ||
      !voice
    )
      return;
    phase("Speaking");
    record("speech-start", {
      releaseToSpeechStartMs:
        releaseAt === null ? null : Math.round(performance.now() - releaseAt),
      measurement: "event proxy, not acoustic latency",
    });
  };
  u.onend = () => {
    if (
      audioToken === audioGeneration &&
      token === generation &&
      !held &&
      !finalizing &&
      !busy
    )
      phase("Ready when you are");
  };
  u.onerror = () => {
    if (
      audioToken === audioGeneration &&
      token === generation &&
      !held &&
      !finalizing &&
      !busy
    )
      phase("Ready when you are");
  };
  speechSynthesis.speak(u);
}
function row(label, value) {
  const d = document.createElement("div"),
    dt = document.createElement("dt"),
    dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value ?? "Not selected";
  d.append(dt, dd);
  return d;
}
// Prefer the order contract; aliases support older saved demo reservations.
function orderLines(order) {
  if (Array.isArray(order?.items)) return order.items;
  return order?.itemId
    ? [{ itemId: order.itemId, quantity: order.quantity }]
    : [];
}
function equipmentName(id) {
  return (
    state.inventory?.find((item) => item.id === id)?.name ||
    id ||
    "Equipment not selected"
  );
}
function render() {
  renderRecognition();
  if (!state) {
    $("talk").disabled = true;
    $("confirm").hidden = true;
    $("new").disabled = busy || setupInProgress;
    return;
  }
  $("status").textContent = state.status.toUpperCase();
  $("reply").textContent = state.reply || "What would you like to rent?";
  const d = state.draft || {};
  const lines = orderLines(d);
  $("draft").replaceChildren(
    ...(lines.length
      ? lines.map((line) =>
          row(
            equipmentName(line.itemId),
            line.quantity == null
              ? "Quantity not selected"
              : `Quantity: ${line.quantity}`,
          ),
        )
      : [row("Equipment", "Not selected")]),
    row("Shared start date", d.start),
    row("Shared end date", d.end),
    ...(state.booking ? [row("Reservation", state.booking.id)] : []),
  );
  $("stock").replaceChildren(
    ...(state.inventory || []).map((i) => {
      const r = document.createElement("div");
      r.className = "stock-row";
      r.textContent = i.name;
      const s = document.createElement("span");
      s.textContent =
        i.remaining == null
          ? `${i.stock} total · dates needed`
          : `${i.remaining} available / ${i.stock} total`;
      r.append(s);
      return r;
    }),
  );
  const datesChecked =
    state.inventory?.length &&
    state.inventory.every((i) => i.remaining != null);
  $("stock-heading").textContent = datesChecked
    ? "AVAILABILITY FOR YOUR DATES"
    : "INVENTORY TOTALS";
  $("stock-context").textContent = datesChecked
    ? `Remaining for ${d.start} through ${d.end}, inclusive. All saved reservations are included.`
    : "Choose dates to check availability. Totals are not remaining stock; saved reservations still apply.";
  $("saved-title").textContent =
    `Saved reservations (${state.bookings.length}, including demo seed)`;
  $("saved-list").replaceChildren(
    ...state.bookings.map((booking) => {
      const entry = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent =
        orderLines(booking)
          .map(
            (line) =>
              `${line.quantity ?? "Quantity not selected"} × ${equipmentName(line.itemId)}`,
          )
          .join(" · ") || "Equipment not selected";
      const dates = document.createElement("span");
      dates.textContent = `${booking.start} through ${booking.end}, inclusive`;
      const reference = document.createElement("span");
      reference.textContent =
        booking.id + (booking.sessionId == null ? " · Demo seed" : "");
      entry.append(label, dates, reference);
      return entry;
    }),
  );
  $("availability").textContent = state.booking
    ? "One reservation saved for all items. Remaining stock below includes this booking."
    : state.availability
      ? state.availability.available
        ? "All requested items are available for the shared dates. Review every quantity before confirming."
        : "This order cannot be confirmed yet. Review the item availability below."
      : "We’ll check every item for the same inclusive date range.";
  $("line-availability").replaceChildren(
    ...(state.availability?.items || []).map((item) => {
      const entry = document.createElement("li");
      entry.className = item.available ? "line-available" : "line-shortage";
      const name = document.createElement("strong");
      name.textContent = equipmentName(item.itemId);
      const detail = document.createElement("span");
      detail.textContent = `${item.requested ?? "Not selected"} requested · ${item.remaining ?? "Not checked"} available${item.available ? "" : " · Not enough stock"}`;
      entry.append(name, detail);
      return entry;
    }),
  );
  // Availability describes the pre-booking check; the inventory below is current.
  $("line-availability").hidden = Boolean(state.booking);
  $("confirm").hidden = state.status !== "review";
  $("confirm").disabled = recognitionLocked();
  $("new").disabled = busy || Boolean(pending) || setupInProgress;
  $("another").hidden = state.status !== "booked";
  $("another").disabled = $("new").disabled;
  $("talk").disabled = busy || Boolean(pending) || setupInProgress ||
    recognitionMode === "unselected" ||
    (recognitionMode === "local" && localCapability.status !== "available");
  $("choices").replaceChildren();
  for (const c of state.clarification?.candidates || []) {
    const text = typeof c === "string" ? c : c.label || c.name || c.id;
    if (!text) continue;
    const b = document.createElement("button");
    b.textContent = text;
    b.disabled = recognitionLocked();
    b.onclick = () => submit(text, [], "button");
    $("choices").append(b);
  }
  $("events").replaceChildren(
    ...state.events.map((e) => {
      const n = document.createElement("div");
      n.className = "event";
      for (const [who, t] of [
        ["YOU", e.transcript],
        ["ASSISTANT", e.reply],
      ]) {
        const p = document.createElement("p"),
          b = document.createElement("b");
        b.textContent = who;
        p.append(b, document.createTextNode(t || ""));
        n.append(p);
      }
      return n;
    }),
  );
  if (!state.events.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent =
      "No messages in this conversation yet. Existing reservations are still saved.";
    $("events").append(empty);
  }
  $("database").textContent = JSON.stringify(
    { inventory: state.inventory, bookings: state.bookings },
    null,
    2,
  );
}
async function api(path, body) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request deadline exceeded"));
    }, 12000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          signal: controller.signal,
          ...(body
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        const data = await response.json();
        if (!response.ok)
          throw Object.assign(
            new Error(data.error || `Request failed (${response.status})`),
            { data, status: response.status },
          );
        return data;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function submit(text, alts = [], source = "voice", retry = false, recognition = null) {
  if (
    busy ||
    setupInProgress ||
    held ||
    finalizing ||
    !state ||
    (pending && !retry) ||
    (retry && !pending)
  )
    return;
  busy = true;
  if (source === "button" && !retry) releaseAt = null;
  if (retry)
    record("retry-latency-note", {
      measurement:
        "Retains original voice release timestamp, including retry delay",
    });
  const token = generation;
  pending = retry
    ? pending
    : {
        sessionId: state.sessionId,
        eventId: crypto.randomUUID(),
        expectedRevision: state.revision,
        transcript: text,
        alternatives: alts,
        source,
      };
  if (!retry) pendingRecognition = source === "voice" ? recognition : null;
  $("retry").hidden = true;
  $("error").textContent = "";
  phase("Processing");
  render();
  record("turn-request", { request: pending, recognition: pendingRecognition });
  try {
    state = await api("/api/turn", pending);
    record("turn-result", { state });
    pending = null;
    if (token !== generation && !held && !finalizing)
      phase("Ready when you are");
    render();
    if (token === generation && !held) {
      phase("Ready when you are");
      speak(state.speechReply || state.reply, token);
    }
  } catch (e) {
    // These statuses are rejected before execution by this local server contract.
    const rejectedBeforeExecution = [400, 403, 404, 405, 408, 410, 413, 415, 429].includes(
      e.status,
    );
    if (rejectedBeforeExecution) pending = null;
    if (hostedReviewer && [404, 410].includes(e.status)) {
      state = null;
      try { localStorage.removeItem(key); } catch {}
      $("status").textContent = "EXPIRED";
      $("reply").textContent = "Temporary conversation unavailable. Choose New conversation. Previous demo bookings are not restored.";
      for (const id of ["draft", "stock", "saved-list", "events", "line-availability"]) $(id).replaceChildren();
      $("saved-title").textContent = "No current workspace";
      $("database").textContent = "Temporary workspace unavailable.";
      $("availability").textContent = "Start a new temporary conversation.";
      $("another").hidden = true;
    }
    if (e.data?.state) {
      state = e.data.state;
      pending = null;
      render();
    }
    $("error").textContent = rejectedBeforeExecution
      ? `${e.message}. This request was rejected before saving any changes. Please correct your request and try again.`
      : e.status && !pending
        ? `${e.message}. Please review the latest draft and try again.`
        : "The response was not received. This request may already have been saved; it was not cancelled. Retry the same request to recover its result before continuing.";
    $("retry").hidden = !pending;
    phase("Needs attention");
  } finally {
    busy = false;
    render();
  }
}
let finalizing = false;
const controller = new VoiceController({
  Recognition,
  Phrase,
  stopAudio,
  onEvent(event) {
    const { type, ...details } = event;
    record("recognition-" + type, details);
    if (event.type === "waiting-for-final") {
      phase("Waiting for the browser to finish · Esc cancels");
    }
  },
  onState(value) {
    held = value === "listening";
    finalizing = value === "finalizing";
    $("talk").classList.toggle("active", held);
    $("talk").setAttribute("aria-pressed", String(held));
    phase(
      {
        listening: "Listening · release to send",
        finalizing: "Finishing speech · please wait",
        idle: "Ready when you are",
      }[value],
    );
    render();
  },
  onTranscript(text, details = {}) {
    $("live").textContent = text
      ? `${details.provisional ? "Recognizing" : "Heard"}: ${text}`
      : "";
  },
  onFinal(text, alternatives, recognition) {
    $("live").textContent = "Heard: " + text;
    submit(text, alternatives, "voice", false, recognition);
  },
  onError(error) {
    held = finalizing = false;
    $("talk").classList.remove("active");
    $("talk").setAttribute("aria-pressed", "false");
    phase("Not sent · hold to try again");
    if ($("live").textContent)
      $("live").textContent =
        "Not sent: " +
        $("live").textContent.replace(/^(?:Recognizing|Heard): /, "");
    if (recognitionMode === "local" && ["language-not-supported", "local-not-ready", "local-not-supported"].includes(error))
      localCapability = { ...localCapability, status: "unchecked" };
    $("error").textContent =
      recognitionMode === "local" && ["language-not-supported", "local-not-ready", "local-not-supported"].includes(error)
        ? "On-device recognition is not ready. Nothing was sent and no remote recognizer was used. Check local support again, or explicitly select Browser default."
        : error === "phrases-not-supported"
          ? "The local recognizer rejected equipment hints. Nothing was sent. Turn off Equipment hints and try again; no remote recognizer was used."
      : error === "finalization-timeout"
        ? "The browser did not finish recognizing this turn within 15 seconds. Nothing was sent or booked. Check your connection, then hold to try again."
        : error === "no-final-speech"
          ? "The browser returned no finalized speech. Nothing was sent. Hold again and repeat your request."
          : error === "not-allowed"
            ? "Microphone permission was denied. Allow microphone access in browser settings, then try again."
            : error === "recognition-ended-before-release"
              ? "The microphone stopped before you released. Nothing was sent. Hold again and repeat the complete request."
              : error === "incomplete-speech"
                ? "The browser ended with unfinished speech. Nothing was sent or booked. Hold again and repeat the complete request."
                : `Speech recognition stopped (${error}). Check microphone and connection, then hold to try again.`;
    render();
  },
});
function abort() {
  generation++;
  controller.abort();
  held = finalizing = false;
  $("talk").classList.remove("active");
  $("talk").setAttribute("aria-pressed", "false");
  stopAudio();
  phase(
    setupInProgress
      ? "Local setup still in progress · microphone off"
      : pending
      ? busy
        ? "Request pending · outcome not yet known"
        : "Response missing · retry to recover"
      : busy
        ? "Loading conversation"
        : "Ready when you are",
  );
  render();
}
function start() {
  stopAudio();
  if (busy || pending || finalizing || held || setupInProgress) return;
  if (!Recognition) {
    $("error").textContent =
      "Speech recognition is unavailable. Use desktop Chrome and allow microphone access.";
    return;
  }
  if (!state) return;
  if (recognitionMode === "unselected") {
    $("error").textContent = "Choose a recognition mode before speaking. Nothing was started.";
    return;
  }
  if (recognitionMode === "local" && localCapability.status !== "available") {
    $("error").textContent = "On-device recognition is not ready. Check local support, or explicitly select Browser default. Nothing was started.";
    return;
  }
  generation++;
  releaseAt = null;
  $("error").textContent = "";
  $("live").textContent = "";
  record("hold-start");
  controller.start({
    mode: recognitionMode,
    localAvailable: localCapability.status === "available",
    phraseHints: recognitionMode === "local" && phraseHints,
  });
}
function release() {
  if (!held) return;
  releaseAt = performance.now();
  record("hold-release");
  controller.release();
}
$("talk").onpointerdown = (e) => {
  e.preventDefault();
  $("talk").setPointerCapture(e.pointerId);
  start();
};
$("talk").onpointerup = release;
$("talk").onpointercancel = abort;
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    abort();
    return;
  }
  if (
    e.code === "Space" &&
    !e.repeat &&
    !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) &&
    !$("drawer").open &&
    (e.target === document.body || e.target === $("talk"))
  ) {
    e.preventDefault();
    start();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && held) {
    e.preventDefault();
    release();
  }
});
window.addEventListener("blur", () => {
  if (controller.active) abort();
});
window.addEventListener("pagehide", abort);
$("voice").onclick = () => {
  voice = !voice;
  $("voice").textContent = `Voice ${voice ? "on" : "off"}`;
  if (!voice) {
    stopAudio();
    if (!held && !busy && !pending && !finalizing) phase("Ready when you are");
  }
};
$("stop").onclick = () => {
  stopAudio();
  if (!held && !busy && !pending && !finalizing) phase("Ready when you are");
};
$("confirm").onclick = () => submit("confirm booking", [], "button");
$("retry").onclick = () => submit("", [], "voice", true);
$("recognition-mode").onchange = () => {
  if (recognitionLocked()) return render();
  const selected = $("recognition-mode").value;
  if (!["browser", "local"].includes(selected)) return render();
  recognitionMode = selected;
  $("error").textContent = "";
  try { localStorage.setItem(recognitionPreferenceKey, recognitionMode); }
  catch {
    $("error").textContent = "This recognition choice could not be saved. It applies only to this page; check the mode again after reloading.";
  }
  record("recognition-mode-selected", { mode: recognitionMode });
  render();
  if (recognitionMode === "local") checkLocalRecognition();
};
$("equipment-hints").onchange = () => {
  if (recognitionLocked() || recognitionMode !== "local" ||
      localCapability.status !== "available" || !localCapability.phraseSupport) return render();
  phraseHints = $("equipment-hints").checked;
  record("recognition-hints-selected", { enabled: phraseHints });
};
$("check-local").onclick = checkLocalRecognition;
$("setup-local").onclick = setupLocalRecognition;
async function load(fresh = false) {
  if (!configReady) { $("error").textContent = "Configuration unavailable or still loading. Reload after the server wakes."; return; }
  if (busy || pending || setupInProgress) return;
  abort();
  busy = true;
  phase("Loading conversation");
  $("error").textContent = "";
  render();
  try {
    const id = !fresh && localStorage.getItem(key);
    try {
      state = id
        ? await api(`/api/sessions/${encodeURIComponent(id)}`)
        : await api("/api/sessions", {});
    } catch (error) {
      if (id && [404, 410].includes(error.status)) {
        state = await api("/api/sessions", {});
        $("error").textContent = "Previous conversation is unavailable. A new temporary conversation was created; previous demo bookings are not restored.";
      }
      else throw error;
    }
    localStorage.setItem(key, state.sessionId);
    pending = null;
    $("retry").hidden = true;
    $("live").textContent = "";
    record("session-loaded", { state });
    render();
    phase("Ready when you are");
  } catch (e) {
    $("error").textContent =
      "Could not load the conversation. Check the server (a free host may need about one minute to wake) and choose New conversation.";
    phase("Connection unavailable");
  } finally {
    busy = false;
    render();
  }
}
$("new").onclick = $("another").onclick = () => load(true);
$("evidence").onclick = () => {
  render();
  $("drawer").showModal();
};
$("close").onclick = () => $("drawer").close();
$("export").onclick = async () => {
  let database;
  try {
    database = await api("/api/state");
  } catch {
    database = {
      inventory: state?.inventory,
      bookings: state?.bookings,
      snapshotWarning: "Latest database fetch failed",
    };
  }
  const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            recordingProof: "pending",
            latencyDefinition:
              "Release to SpeechSynthesis onstart event; not acoustic latency",
            recognitionSettings: {
              selectedMode: recognitionMode,
              language: "en-US",
              phraseHintsRequested: recognitionMode === "local" && phraseHints,
              localCapability,
              accuracyComparison: "Not measured. Capability checks are not recognition accuracy evidence.",
              attribution: "See each recognition event and turn-request for the settings used; persisted older turns may not have attribution.",
            },
            session: state,
            database,
            log,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "rental-studio-evidence.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function initialize() {
  try {
    const config = await api("/api/config");
    hostedReviewer = config.temporary === true;
    configReady = true;
    $("temporary-notice").hidden = !hostedReviewer;
    await load();
  } catch {
    $("error").textContent = "Server unavailable. A free host may need about one minute to wake. Reload to try again.";
  }
}
initialize();

const evidenceCases = [
  [
    "normal",
    "Normal booking",
    "One camera · October 13–15, 2026. Confirm the complete summary. Expect one booking.",
  ],
  [
    "correction",
    "Corrected dates",
    "One camera · October 20–22, 2026. Correct to October 23–25 before confirming. Expect only corrected dates.",
  ],
  [
    "stock",
    "Insufficient stock",
    "Two cameras · October 10–12, 2026. Expect unavailable and no new booking.",
  ],
  [
    "interruption",
    "Interruption / pause",
    "Two tripods · November 1–3, 2026. Interrupt with one tripod. Pause while holding: no turn should submit. Expect one corrected booking.",
  ],
  [
    "repeat",
    "Repeated confirmation",
    "One microphone · November 5–6, 2026. Confirm repeatedly. Expect exactly one new booking.",
  ],
];
const captures = {};
for (const [id, name, expectation] of evidenceCases) {
  const section = document.createElement("section");
  section.className = "event";
  const title = document.createElement("h4");
  title.textContent = name;
  const description = document.createElement("p");
  description.textContent = expectation;
  const begin = document.createElement("button");
  begin.textContent = "Capture before";
  const end = document.createElement("button");
  end.textContent = "Capture after";
  end.disabled = true;
  const status = document.createElement("p");
  status.className = "small";
  status.textContent =
    "Not captured. Speak the test yourself; inventory is never reset.";
  begin.onclick = async () => {
    try {
      captures[id] = {
        expectation,
        before: await api("/api/state"),
        startedAt: new Date().toISOString(),
        eventOffset: log.length,
      };
      end.disabled = false;
      status.textContent =
        "Before snapshot captured. Run this check with your voice, then capture after.";
    } catch {
      status.textContent =
        "Snapshot failed. Check server connection and retry.";
    }
  };
  end.onclick = async () => {
    try {
      captures[id].after = await api("/api/state");
      captures[id].session = structuredClone(state);
      captures[id].events = log.slice(captures[id].eventOffset);
      record("manual-check-capture", { id, ...captures[id] });
      status.textContent = `Before/after captured. Booking count: ${captures[id].before.bookings.length} → ${captures[id].after.bookings.length}. Review expected outcome manually. Recording proof pending.`;
      $("case-count").textContent =
        `${Object.values(captures).filter((c) => c.after).length} of 5 checks captured. Recording proof pending.`;
    } catch {
      status.textContent =
        "Snapshot failed. Check server connection and retry.";
    }
  };
  section.append(title, description, begin, end, status);
  $("cases").append(section);
}
