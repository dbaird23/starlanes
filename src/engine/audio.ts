/** Web Audio playback for extracted Nova 'snd ' resources + title music. */

/**
 * The snd ids we call by name, taken from the resource names in
 * Nova Sounds.rez. Nova numbers them in families: 128-130 hyperspace,
 * 150-154 the five interface beeps, 200-235 weapon fire (200 + weap Sound),
 * 300-303 explosions (300 + bööm SoundIndex), 370-390 ship events,
 * 600-603 the menu plates, 1000-1627 per-government comm chatter and
 * 10000-10034 planet/station ambience.
 */
export const SND = {
  WARP_IN: 128, // "Warp up"    — hyperdrive spooling up
  WARP_IN_BIG: 129, // "Warp up.x2"
  WARP_OUT: 130, // "Warp out"   — arriving in a new system
  BEEP1: 150,
  BEEP2: 151,
  BEEP3: 152,
  BEEP4: 153,
  BEEP5: 154,
  RED_ALERT: 370,
  KLAXON: 371,
  EJECT: 372,
  CLOAK_OFF: 380,
  CLOAK_ON: 381,
  AIRLOCK: 390, // boarding / docking tube
  MENU_DOWN: 600,
  MENU_UP: 601,
  MENU_START: 602,
  MENU_END: 603,
} as const;

/**
 * Escort speech, per the Bible's gövt VoiceType field. A government's ships
 * draw from bank 1000 + VoiceType * 100, which holds three sets of takes:
 * +0 acknowledging an order, +10 going after a target, +20 on a kill.
 *
 * How many takes each bank actually ships, counted off the extracted
 * resources. Where the count is even, Nova reads it as two voices — the
 * Auroran, Pirate and Wild Geese banks each hold eight, which is how the
 * scenario gets male and female pilots out of one bank.
 */
const VOICE_TAKES: Record<number, number> = {
  1000: 7, 1010: 5, 1020: 3, // 0 civilian / independent
  1100: 7, 1110: 5, 1120: 5, // 1 Federation
  1200: 9, 1210: 5, 1220: 3, // 2 Rebellion
  1300: 5, 1310: 3, 1320: 5, // 3 Polaris
  1400: 8, 1410: 8, 1420: 8, // 4 Auroran
  1500: 8, 1510: 8, 1520: 8, // 5 Pirate
  1600: 8, 1610: 8, 1620: 8, // 6 Wild Geese
};

/** Which line an escort is saying. The numbers are the Bible's bank offsets. */
export const VOICE = { ACKNOWLEDGE: 0, TARGET: 10, VICTORY: 20 } as const;
export type VoiceKind = (typeof VOICE)[keyof typeof VOICE];

/**
 * Pick a take for one ship. `parity` is that ship's own coin-flip, fixed for
 * its lifetime, so a given escort keeps the same voice; a govt can override it
 * by setting VoiceType 1000-1007 (odd takes only) or 2000-2007 (even only).
 * Returns null for a government that doesn't speak — VoiceType -1, which is
 * what Nova gives the Wraith, the Krypt and the Hyperioid.
 */
/** Split a VoiceType into its bank number and any forced half. */
function readVoiceType(voiceType: number): { type: number; forced: 0 | 1 | null } | null {
  if (voiceType >= 2000 && voiceType <= 2007) return { type: voiceType - 2000, forced: 0 };
  if (voiceType >= 1000 && voiceType <= 1007) return { type: voiceType - 1000, forced: 1 };
  if (voiceType >= 0 && voiceType <= 7) return { type: voiceType, forced: null };
  return null; // -1, or something a plug-in invented
}

export function voiceSnd(voiceType: number, kind: VoiceKind, parity: 0 | 1): number | null {
  const vt = readVoiceType(voiceType);
  if (!vt) return null;
  const bank = 1000 + vt.type * 100 + kind;
  const takes = VOICE_TAKES[bank] ?? 0;
  if (takes === 0) return null;
  // an odd number of takes leaves nothing to split, so everyone shares them
  if (takes % 2 === 1) return bank + Math.floor(Math.random() * takes);
  const half = vt.forced ?? parity;
  return bank + half + 2 * Math.floor(Math.random() * (takes / 2));
}

/** Every take a government can speak, for preloading a spawned escort. */
export function voiceBank(voiceType: number): number[] {
  const vt = readVoiceType(voiceType);
  if (!vt) return [];
  const ids: number[] = [];
  for (const kind of [VOICE.ACKNOWLEDGE, VOICE.TARGET, VOICE.VICTORY]) {
    const bank = 1000 + vt.type * 100 + kind;
    for (let i = 0; i < (VOICE_TAKES[bank] ?? 0); i++) ids.push(bank + i);
  }
  return ids;
}

// ---------------------------------------------------------------- graph ----

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Everything funnels through a limiter — a big furball starts a dozen
 *  sources at once and straight summing into destination clips hard. */
let limiter: DynamicsCompressorNode | null = null;

const buffers = new Map<number, AudioBuffer>();
const inflight = new Map<number, Promise<AudioBuffer | null>>();
const missing = new Set<number>();

/** Live source count per snd id, so one weapon can't stack 20 copies. */
const voices = new Map<number, number>();
const MAX_VOICES_PER_SND = 4;
const MAX_VOICES_TOTAL = 24;
let totalVoices = 0;

const VOL_KEY = "starlanes.audio";
let masterVolume = 0.8;
let muted = false;

try {
  const saved = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null") as {
    volume?: number;
    muted?: boolean;
  } | null;
  if (saved) {
    if (typeof saved.volume === "number") masterVolume = Math.max(0, Math.min(1, saved.volume));
    if (typeof saved.muted === "boolean") muted = saved.muted;
  }
} catch {
  /* corrupt or unavailable storage — defaults are fine */
}

function persist(): void {
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ volume: masterVolume, muted }));
  } catch {
    /* private mode: volume just won't survive a reload */
  }
}

function effectiveVolume(): number {
  return muted ? 0 : masterVolume;
}

function audioCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = effectiveVolume();
    master.connect(limiter).connect(ctx.destination);
  }
  return ctx;
}

/**
 * Browsers hand back a suspended context until the page has been interacted
 * with. Sources started while suspended do not play — they queue on a clock
 * that isn't running, and all fire at once the moment it resumes. So we never
 * start a source unless the context is actually running, and we resume on the
 * first gesture instead.
 */
function installUnlock(): void {
  const unlock = (): void => {
    const ac = audioCtx();
    if (ac && ac.state === "suspended") void ac.resume();
    if (!ac || ac.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
installUnlock();

// ------------------------------------------------------------- controls ----

export function getVolume(): number {
  return masterVolume;
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(v: number): void {
  masterVolume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(effectiveVolume(), ctx.currentTime, 0.01);
  applyMusicVolume();
  persist();
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(effectiveVolume(), ctx.currentTime, 0.01);
  applyMusicVolume();
  persist();
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// --------------------------------------------------------------- sounds ----

function fetchSnd(sndId: number): Promise<AudioBuffer | null> {
  const pending = inflight.get(sndId);
  if (pending) return pending;
  const ac = audioCtx();
  if (!ac) return Promise.resolve(null);
  const p = fetch(`/nova/sounds/snd-${sndId}.wav`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`snd ${sndId}: 404`))))
    .then((ab) => ac.decodeAudioData(ab))
    .then((buf) => {
      buffers.set(sndId, buf);
      inflight.delete(sndId);
      return buf;
    })
    .catch(() => {
      // Some stock bööm resources point at sounds Nova never shipped (bööm 142
      // "HellHound Detonation" asks for snd 314). Remember the gap so we stop
      // re-requesting it rather than 404ing on every detonation.
      missing.add(sndId);
      inflight.delete(sndId);
      return null;
    });
  inflight.set(sndId, p);
  return p;
}

/** Warm the cache so the first shot of a weapon isn't swallowed by latency. */
export function preloadSnds(ids: Iterable<number | null | undefined>): void {
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    if (buffers.has(id) || missing.has(id) || inflight.has(id)) continue;
    void fetchSnd(id);
  }
}

/** The interface and system sounds that fire often enough to be worth eager loading. */
export function preloadCoreSnds(): void {
  preloadSnds([
    SND.WARP_IN, SND.WARP_OUT,
    SND.BEEP1, SND.BEEP2, SND.BEEP3, SND.BEEP4, SND.BEEP5,
    SND.RED_ALERT, SND.KLAXON, SND.EJECT,
    SND.CLOAK_OFF, SND.CLOAK_ON, SND.AIRLOCK,
    SND.MENU_DOWN, SND.MENU_UP, SND.MENU_START, SND.MENU_END,
    300, 301, 302, 303,
  ]);
}

export interface PlayOpts {
  /** Stereo position, -1 hard left to +1 hard right. */
  pan?: number;
  /** Extra gain multiplier, e.g. distance falloff. */
  attenuation?: number;
}

function startSource(sndId: number, buf: AudioBuffer, volume: number, opts?: PlayOpts): void {
  const ac = ctx;
  if (!ac || !master || ac.state !== "running") return;

  const live = voices.get(sndId) ?? 0;
  if (live >= MAX_VOICES_PER_SND || totalVoices >= MAX_VOICES_TOTAL) return;

  const gainValue = volume * (opts?.attenuation ?? 1);
  if (gainValue <= 0.001) return;

  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = gainValue;

  let tail: AudioNode = gain;
  const pan = opts?.pan;
  if (pan !== undefined && pan !== 0 && typeof ac.createStereoPanner === "function") {
    const panner = ac.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    tail = panner;
  }
  src.connect(gain);
  tail.connect(master);

  voices.set(sndId, live + 1);
  totalVoices++;
  src.onended = () => {
    voices.set(sndId, Math.max(0, (voices.get(sndId) ?? 1) - 1));
    totalVoices = Math.max(0, totalVoices - 1);
  };
  src.start();
}

/**
 * Play a snd resource by id. Fire-and-forget: a cached buffer plays now, an
 * uncached one loads and plays only if it arrives promptly — a blaster shot
 * that turns up 800ms late is worse than no shot at all.
 */
export function playSnd(sndId: number, volume = 0.5, opts?: PlayOpts): void {
  if (muted || masterVolume <= 0) return;
  const ac = audioCtx();
  if (!ac || missing.has(sndId)) return;

  const cached = buffers.get(sndId);
  if (cached) {
    startSource(sndId, cached, volume, opts);
    return;
  }
  const deadline = performance.now() + 350;
  void fetchSnd(sndId).then((buf) => {
    if (buf && performance.now() <= deadline) startSource(sndId, buf, volume, opts);
  });
}

/**
 * Play a sound positioned in the world. `dx`/`dy` are the source's offset from
 * the player; distant fire fades out and pans off to the side instead of
 * landing dead centre at full volume like a shot fired on top of you.
 */
const AUDIBLE_NEAR = 350;
const AUDIBLE_FAR = 2600;

export function playSndAt(sndId: number, volume: number, dx: number, dy: number): void {
  const dist = Math.hypot(dx, dy);
  if (dist >= AUDIBLE_FAR) return;
  const atten =
    dist <= AUDIBLE_NEAR ? 1 : 1 - (dist - AUDIBLE_NEAR) / (AUDIBLE_FAR - AUDIBLE_NEAR);
  playSnd(sndId, volume, {
    pan: Math.max(-1, Math.min(1, dx / 900)) * 0.7,
    attenuation: atten * atten,
  });
}

// ------------------------------------------------------------- ambience ----

/**
 * A single sustained sound — a world's ambience while you're landed, held on
 * its own node so it can be stopped when you take off. Nova's stock worlds all
 * play their ambience once (not one of the 232 sets the loop flag), but the
 * flag is honoured for plug-ins that do.
 */
interface Sustained {
  /** null while the buffer is still loading — the slot is claimed, not playing */
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
  /** what the slot is playing, so a repeat request is a no-op rather than a restart */
  sndId: number;
  /** bumped on every (re)start, so a slow fetch can tell it has been replaced */
  token: number;
}

const sustained = new Map<string, Sustained>();
let sustainToken = 0;

/**
 * Start a sustained sound under `key`, replacing whatever was there. Fades in
 * and out, because a four-second ambience or a beam hum that snaps on and off
 * at full amplitude clicks audibly.
 */
export function startSustained(key: string, sndId: number, loop: boolean, volume: number): void {
  // already playing this, or still fetching it — asking again must not restart it
  if (sustained.get(key)?.sndId === sndId) return;
  stopSustained(key);
  const token = ++sustainToken;
  const ac = audioCtx();
  if (!ac || missing.has(sndId)) return;
  // claim the slot before the fetch, so the next frame sees it and stays quiet
  sustained.set(key, { src: null, gain: null, sndId, token });
  const start = (buf: AudioBuffer): void => {
    // stopped, or superseded by a later start, while this was loading
    if (sustained.get(key)?.token !== token) return;
    if (!ctx || !master || ctx.state !== "running") {
      sustained.delete(key);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.12);
    src.connect(gain).connect(master);
    src.start();
    // a one-shot clears its own slot so a later start isn't treated as a no-op
    src.onended = () => {
      if (sustained.get(key)?.token === token) sustained.delete(key);
    };
    sustained.set(key, { src, gain, sndId, token });
  };
  const cached = buffers.get(sndId);
  if (cached) start(cached);
  else void fetchSnd(sndId).then((buf) => (buf ? start(buf) : sustained.delete(key)));
}

export function stopSustained(key: string): void {
  const s = sustained.get(key);
  sustained.delete(key);
  // no src yet means it was still loading; dropping the slot is enough — the
  // pending start checks its token and finds it has been superseded
  if (!s || !ctx || !s.src || !s.gain) return;
  const end = ctx.currentTime + 0.18;
  s.gain.gain.cancelScheduledValues(ctx.currentTime);
  s.gain.gain.setValueAtTime(s.gain.gain.value, ctx.currentTime);
  s.gain.gain.linearRampToValueAtTime(0, end);
  try {
    s.src.stop(end);
  } catch {
    /* already finished on its own */
  }
}

export function isSustaining(key: string): boolean {
  return sustained.has(key);
}

/** Drop every sustained sound — taking off, dying, or bailing to the menu. */
export function stopAllSustained(): void {
  for (const key of [...sustained.keys()]) stopSustained(key);
}

const AMBIENT_KEY = "ambient";

/** A world's ambience while you're landed. */
export function playAmbient(sndId: number, loop: boolean, volume = 0.35): void {
  startSustained(AMBIENT_KEY, sndId, loop, volume);
}

export function stopAmbient(): void {
  stopSustained(AMBIENT_KEY);
}

// ---------------------------------------------------------------- music ----

let musicEl: HTMLAudioElement | null = null;
/** true only while the title menu wants music; guards the autoplay retry */
let musicWanted = false;
let musicRetryArmed = false;
const MUSIC_GAIN = 0.55;

function applyMusicVolume(): void {
  if (musicEl) musicEl.volume = MUSIC_GAIN * effectiveVolume();
}

/*
 * The title music loops for as long as the menu is up, which is tiresome when
 * the game is being driven from a dev server all day, so it stays off under
 * `npm run dev` and plays normally in a production build. Sound effects are
 * unaffected either way. To hear it while developing, set localStorage
 * "music" to "1"; to silence it in a build, set "music" to "0".
 */
function musicMuted(): boolean {
  try {
    const pref = localStorage.getItem("music");
    if (pref !== null) return pref === "0";
  } catch {
    // storage can be unavailable (private mode, sandboxed iframe); fall through
  }
  return import.meta.env.DEV;
}

/** Title music: loops while the menu is up. */
export function playMusic(): void {
  if (musicMuted()) return;
  musicWanted = true;
  if (!musicEl) {
    musicEl = new Audio("/nova/music.mp3");
    musicEl.loop = true;
  }
  applyMusicVolume();
  void musicEl.play().catch(() => {
    // autoplay blocked: retry on the first user interaction, but only if the
    // menu still wants music by then (otherwise it would start mid-flight).
    // Arm the retry once — repeated blocked plays used to stack listeners.
    if (musicRetryArmed) return;
    musicRetryArmed = true;
    const retry = (): void => {
      musicRetryArmed = false;
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      if (musicWanted) void musicEl?.play().catch(() => undefined);
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
  });
}

export function stopMusic(): void {
  musicWanted = false;
  musicEl?.pause();
}
