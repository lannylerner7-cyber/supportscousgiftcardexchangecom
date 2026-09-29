let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function soundEnabled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("scous.sound") !== "off";
}

export function setSoundEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("scous.sound", on ? "on" : "off");
}

function tone(freq: number, start: number, duration: number, gain = 0.12) {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0.0001, audio.currentTime + start);
  vol.gain.exponentialRampToValueAtTime(gain, audio.currentTime + start + 0.02);
  vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
  osc.connect(vol).connect(audio.destination);
  osc.start(audio.currentTime + start);
  osc.stop(audio.currentTime + start + duration + 0.05);
}

/** Money landed in the wallet. */
export function playChime() {
  if (!soundEnabled()) return;
  void getCtx()?.resume();
  tone(880, 0, 0.18);
  tone(1318.5, 0.12, 0.26);
}

/** New message / new trade for admin. */
export function playAlert() {
  if (!soundEnabled()) return;
  void getCtx()?.resume();
  tone(660, 0, 0.12, 0.1);
  tone(520, 0.13, 0.16, 0.1);
}

export function playTap() {
  if (!soundEnabled()) return;
  void getCtx()?.resume();
  tone(420, 0, 0.05, 0.05);
}
