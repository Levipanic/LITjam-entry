const delay = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
const AUDIO_TIMEOUT = 45000;
const DECODE_TIMEOUT = 15000;

function timeoutAfter(duration, message) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), duration);
  });
}

export class AudioEngine {
  constructor({ volume, muted }) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API не поддерживается этим браузером.");
    }

    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.buffers = new Map();
    this.activeDeck = null;
    this.decks = new Set();
    this.oneShots = new Set();
    this.transitionId = 0;
    this.volume = volume;
    this.muted = muted;
    this.applyMasterVolume(true);
  }

  applyMasterVolume(immediate = false) {
    const value = this.muted ? 0 : this.volume;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    if (immediate) {
      this.master.gain.setValueAtTime(value, now);
    } else {
      this.master.gain.setTargetAtTime(value, now, 0.015);
    }
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyMasterVolume();
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyMasterVolume();
  }

  async unlock() {
    if (this.context.state !== "running") {
      await this.context.resume();
    }

    if (this.context.state !== "running") {
      throw new Error("Браузер не разрешил запустить звук.");
    }

    const silentBuffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(this.master);
    source.start();
  }

  async tryResume() {
    if (this.context.state === "running") {
      return true;
    }

    try {
      await this.context.resume();
      return this.context.state === "running";
    } catch {
      return false;
    }
  }

  async prepareBuffer(url, attempts = 3) {
    if (this.buffers.has(url)) {
      return this.buffers.get(url);
    }

    const request = (async () => {
      let lastError;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), AUDIO_TIMEOUT);
        try {
          const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const bytes = await response.arrayBuffer();
          window.clearTimeout(timeout);
          return await Promise.race([
            this.context.decodeAudioData(bytes),
            timeoutAfter(DECODE_TIMEOUT, `Превышено время обработки аудио: ${url}`),
          ]);
        } catch (error) {
          lastError = error.name === "AbortError" ? new Error(`Превышено время загрузки аудио: ${url}`) : error;
          if (attempt < attempts - 1) {
            await delay(500 * 2 ** attempt);
          }
        } finally {
          window.clearTimeout(timeout);
        }
      }

      throw lastError ?? new Error(`Не удалось загрузить аудио: ${url}`);
    })();

    this.buffers.set(url, request);

    try {
      const buffer = await request;
      this.buffers.set(url, buffer);
      return buffer;
    } catch (error) {
      this.buffers.delete(url);
      throw error;
    }
  }

  releaseBuffer(url) {
    this.buffers.delete(url);
  }

  async playOneShot(url) {
    const buffer = await this.prepareBuffer(url);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    this.oneShots.add(source);

    return new Promise((resolve) => {
      source.onended = () => {
        this.oneShots.delete(source);
        source.disconnect();
        this.releaseBuffer(url);
        resolve();
      };
      source.start();
    });
  }

  async playTrack(url, fadeDuration, loop = true) {
    const buffer = await this.prepareBuffer(url);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const fadeSeconds = fadeDuration / 1000;
    const transitionId = ++this.transitionId;

    source.buffer = buffer;
    source.loop = loop;
    if (loop) {
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }
    source.connect(gain);
    gain.connect(this.master);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);
    source.start(now);

    const previous = this.activeDeck;
    const nextDeck = { source, gain, url, stopped: false };
    this.activeDeck = nextDeck;
    this.decks.add(nextDeck);
    this.releaseBuffer(url);

    if (!loop) {
      source.addEventListener("ended", () => {
        if (this.activeDeck === nextDeck) this.activeDeck = null;
        this.stopDeck(nextDeck);
      }, { once: true });
    }

    if (!previous) {
      return;
    }

    if (typeof previous.gain.gain.cancelAndHoldAtTime === "function") {
      previous.gain.gain.cancelAndHoldAtTime(now);
    } else {
      const heldGain = previous.gain.gain.value;
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(heldGain, now);
    }
    previous.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    window.setTimeout(() => {
      if (transitionId <= this.transitionId) this.stopDeck(previous);
    }, fadeDuration + 100);
  }

  stopDeck(deck) {
    if (deck.stopped) return;
    deck.stopped = true;
    try {
      deck.source.stop();
    } catch {
      // The source may already be stopped by the browser.
    }
    deck.source.disconnect();
    deck.gain.disconnect();
    this.decks.delete(deck);
  }

  stopAll() {
    this.transitionId += 1;

    for (const source of this.oneShots) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.oneShots.clear();

    for (const deck of [...this.decks]) this.stopDeck(deck);
    this.activeDeck = null;

    this.buffers.clear();
  }
}
