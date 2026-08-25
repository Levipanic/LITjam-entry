import "./styles.css";
import { ASSETS, CREDITS_TRACK, MUSIC_CUES, prepareCriticalImages, preparePage, warmPagesAfter } from "./assets.js";
import { AudioEngine } from "./audio.js";
import { COPY, DEV_MODE, MOBILE_BREAKPOINT, PAGE_COUNT, TIMINGS } from "./config.js";

const app = document.querySelector("#app");
const storageKey = "ordinary-manual-audio";
const introUrls = Object.values(ASSETS.intro);
const delay = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

function readAudioPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    return {
      volume: typeof value?.volume === "number" ? value.volume : 0.7,
      muted: Boolean(value?.muted),
    };
  } catch {
    return { volume: 0.7, muted: false };
  }
}

const preferences = readAudioPreferences();
let audio;

const state = {
  screen: "loading",
  loadingError: null,
  hasStarted: false,
  mobileNoticeSeen: false,
  introLabel: "",
  introHasFunTime: false,
  introHasLogo: false,
  introFading: false,
  currentPage: 0,
  furthestPageReached: 0,
  currentMusic: null,
  volume: preferences.volume,
  muted: preferences.muted,
  navigationLocked: false,
  navigationError: null,
  needsAudioResume: false,
};

let experienceId = 0;
let preparedMusic = null;
let firstMusic = null;
let pendingNavigation = null;
let failedPlaybackTrack = null;
let cursorTimer = null;

try {
  audio = new AudioEngine(preferences);
} catch (error) {
  state.loadingError = error;
}

function saveAudioPreferences() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ volume: state.volume, muted: state.muted }));
  } catch {
    // Audio preferences are optional when storage is unavailable.
  }
}

function isMobileWidth() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function musicForPage(page) {
  let track = MUSIC_CUES[0].track;
  for (const cue of MUSIC_CUES) {
    if (cue.page > page) break;
    track = cue.track;
  }
  return track;
}

function musicForTarget(target) {
  return target === PAGE_COUNT ? CREDITS_TRACK : musicForPage(target);
}

function prepareTrack(track) {
  const record = {
    track,
    status: "loading",
    error: null,
    promise: null,
  };

  record.promise = audio.prepareBuffer(track.url)
    .then(() => {
      record.status = "ready";
    })
    .catch((error) => {
      record.status = "error";
      record.error = error;
    });

  return record;
}

function prepareNextMusic() {
  const nextCue = MUSIC_CUES.find((cue) => cue.page > state.furthestPageReached);
  setPreparedMusic(nextCue?.track ?? CREDITS_TRACK);
}

function setPreparedMusic(track) {
  if (preparedMusic?.track.url === track.url) return preparedMusic;

  const obsoleteMusic = preparedMusic;
  preparedMusic = prepareTrack(track);
  if (obsoleteMusic) {
    obsoleteMusic.promise.then(() => audio.releaseBuffer(obsoleteMusic.track.url));
  }
  return preparedMusic;
}

function playMusic(track) {
  return audio.playTrack(track.url, TIMINGS.crossfade, track.loop !== false);
}

function audioControls() {
  if (!state.hasStarted) {
    return "";
  }

  return `
    <div class="audio-controls" aria-label="Громкость">
      <button class="plain-button audio-controls__mute" type="button" data-action="mute">
        ${state.muted ? "sound" : "mute"}
      </button>
      <input
        class="audio-controls__range"
        type="range"
        min="0"
        max="100"
        value="${Math.round(state.volume * 100)}"
        aria-label="Громкость"
        data-action="volume"
      />
    </div>
  `;
}

function resumePrompt() {
  if (!state.needsAudioResume) {
    return "";
  }

  return `
    <div class="resume-prompt">
      <button class="plain-button" type="button" data-action="resume-audio">возобновить звук</button>
    </div>
  `;
}

function loadingScreen() {
  if (state.loadingError) {
    if (!audio) {
      return `
        <section class="center-screen dark-screen">
          <p>этот браузер не поддерживает необходимое воспроизведение звука</p>
        </section>
      `;
    }

    return `
      <section class="center-screen dark-screen">
        <p>не удалось загрузить необходимые файлы</p>
        <button class="plain-button light-button" type="button" data-action="retry-loading">повторить</button>
      </section>
    `;
  }

  return `<section class="center-screen dark-screen" aria-label="Загрузка"><span class="ellipsis">...</span></section>`;
}

function startScreen() {
  return `
    <section class="center-screen dark-screen">
      <button class="plain-button light-button" type="button" data-action="start">начать</button>
    </section>
  `;
}

function mobileNoticeScreen() {
  return `
    <section class="center-screen dark-screen notice-screen">
      <p>${COPY.mobileNotice}</p>
      <button class="plain-button light-button" type="button" data-action="continue-mobile">продолжить на телефоне</button>
    </section>
  `;
}

function introScreen() {
  return `
    <section class="center-screen dark-screen intro-screen ${state.introFading ? "is-fading" : ""}">
      <div class="intro-lockup">
        ${state.introHasLogo ? `<img class="intro-logo" src="${ASSETS.logo}" alt="" draggable="false" />` : ""}
        <div class="intro-brackets">[ <span class="intro-phrase">${state.introLabel ? `<span>${state.introLabel}</span>` : ""}${state.introHasFunTime ? `<span>fun time</span>` : ""}</span> ]</div>
      </div>
    </section>
  `;
}

function titleScreen() {
  const status = firstMusic?.status ?? "loading";
  let action;

  if (status === "error") {
    action = `
      <p class="small-status">не удалось загрузить аудио</p>
      <button class="plain-button" type="button" data-action="retry-first-music">повторить</button>
    `;
  } else {
    action = `
      <button class="plain-button" type="button" data-action="read" ${status !== "ready" ? "disabled" : ""}>читать</button>
      ${status !== "ready" ? `<span class="title-loading" aria-label="Загрузка">...</span>` : ""}
    `;
  }

  return `
    <section class="center-screen title-screen">
      <h1>${COPY.title}</h1>
      <div class="title-screen__action">${action}</div>
    </section>
  `;
}

function debugPanel() {
  if (!DEV_MODE) {
    return "";
  }

  const options = Array.from({ length: PAGE_COUNT }, (_, index) => (
    `<option value="${index}" ${index === state.currentPage ? "selected" : ""}>${String(index).padStart(2, "0")}</option>`
  )).join("");

  return `
    <aside class="debug-panel">
      <span>current: ${state.currentPage}</span>
      <span>furthest: ${state.furthestPageReached}</span>
      <span>music: ${state.currentMusic?.name ?? "none"}</span>
      <label>jump <select data-action="dev-jump">${options}</select></label>
    </aside>
  `;
}

function navigationError() {
  if (!state.navigationError) {
    return "";
  }

  return `
    <div class="asset-error" role="alert">
      <p>${failedPlaybackTrack ? "не удалось запустить аудио" : "не удалось загрузить необходимый файл"}</p>
      <button class="plain-button" type="button" data-action="retry-navigation">повторить</button>
    </div>
  `;
}

function readerScreen() {
  return `
    <section class="reader-screen">
      <div class="reader-page-scroll">
        <img
          class="reader-page page-enter"
          src="${ASSETS.pages[state.currentPage]}"
          alt="Страница ${state.currentPage + 1} из ${PAGE_COUNT}"
          draggable="false"
        />
      </div>
      <nav class="reader-controls" aria-label="Навигация по страницам">
        ${state.currentPage > 0
          ? `<button class="plain-button reader-arrow" type="button" data-action="previous" aria-label="Предыдущая страница" ${state.navigationLocked ? 'aria-disabled="true"' : ""}>&lt;-</button>`
          : `<span class="reader-arrow reader-arrow--placeholder" aria-hidden="true"></span>`}
        <div class="reader-controls__forward">
          <button class="plain-button reader-arrow" type="button" data-action="next" aria-label="Следующая страница" ${state.navigationLocked ? 'aria-disabled="true"' : ""}>-&gt;</button>
          <span class="cooldown-bar" aria-hidden="true"><span></span></span>
        </div>
      </nav>
      <p class="rotate-notice">${COPY.rotateNotice}</p>
      ${navigationError()}
      ${debugPanel()}
    </section>
  `;
}

function creditsScreen() {
  return `
    <section class="center-screen credits-screen">
      <p class="credits-screen__title">${COPY.title}</p>
      <p>Сделано для LITjam 2026<br>Levipanic</p>
      <p>Музыка: Alias Conrad Coldwood</p>
      <p>Визуал украден у IKEA</p>
      <button class="plain-button" type="button" data-action="restart">начать сначала(?)</button>
      ${navigationError()}
    </section>
  `;
}

function render() {
  const screens = {
    loading: loadingScreen,
    mobileNotice: mobileNoticeScreen,
    start: startScreen,
    intro: introScreen,
    title: titleScreen,
    reader: readerScreen,
    credits: creditsScreen,
  };

  app.innerHTML = `${screens[state.screen]()}${audioControls()}${resumePrompt()}`;
  bindScreenEvents();
  updateCursorTimer();
}

function bindScreenEvents() {
  app.querySelector('[data-action="retry-loading"]')?.addEventListener("click", boot);
  app.querySelector('[data-action="continue-mobile"]')?.addEventListener("click", () => {
    state.mobileNoticeSeen = true;
    state.screen = "start";
    render();
  });
  app.querySelector('[data-action="start"]')?.addEventListener("click", beginIntro);
  app.querySelector('[data-action="retry-first-music"]')?.addEventListener("click", retryFirstMusic);
  app.querySelector('[data-action="read"]')?.addEventListener("click", enterReader);
  app.querySelector('[data-action="previous"]')?.addEventListener("click", () => requestNavigation(-1));
  app.querySelector('[data-action="next"]')?.addEventListener("click", () => requestNavigation(1));
  app.querySelector('[data-action="retry-navigation"]')?.addEventListener("click", retryNavigation);
  app.querySelector('[data-action="restart"]')?.addEventListener("click", restartExperience);
  app.querySelector('[data-action="resume-audio"]')?.addEventListener("click", resumeAudio);
  app.querySelector('[data-action="dev-jump"]')?.addEventListener("change", (event) => devJump(Number(event.target.value)));

  app.querySelector('[data-action="mute"]')?.addEventListener("click", () => {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    saveAudioPreferences();
    const muteButton = app.querySelector('[data-action="mute"]');
    if (muteButton) muteButton.textContent = state.muted ? "sound" : "mute";
  });

  app.querySelector('[data-action="volume"]')?.addEventListener("input", (event) => {
    state.volume = Number(event.target.value) / 100;
    audio.setVolume(state.volume);
    saveAudioPreferences();
  });
}

async function prepareInitialAssets() {
  await Promise.all([
    prepareCriticalImages(),
    ...introUrls.map((url) => audio.prepareBuffer(url)),
    prepareInterfaceFont(),
  ]);
}

async function prepareInterfaceFont() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('400 16px "Roboto Slab"', "unproductive fun time"),
    document.fonts.load('400 16px "Roboto Slab"', "начать руководство"),
  ]);
}

async function boot() {
  if (!audio) {
    render();
    return;
  }

  state.screen = "loading";
  state.loadingError = null;
  render();

  try {
    await prepareInitialAssets();
    state.screen = isMobileWidth() && !state.mobileNoticeSeen ? "mobileNotice" : "start";
  } catch (error) {
    state.loadingError = error;
  }

  render();
}

async function beginIntro() {
  const runId = ++experienceId;
  const unlockPromise = audio.unlock();

  state.hasStarted = true;
  state.introLabel = "";
  state.introHasFunTime = false;
  state.introHasLogo = false;
  state.introFading = false;
  state.screen = "intro";
  firstMusic = prepareTrack(MUSIC_CUES[0].track);
  firstMusic.promise.then(() => {
    if (state.screen === "title") {
      render();
    }
  });
  render();

  try {
    await unlockPromise;
  } catch (error) {
    if (firstMusic) audio.releaseBuffer(firstMusic.track.url);
    firstMusic = null;
    state.hasStarted = false;
    state.screen = "start";
    render();
    return;
  }

  await delay(120);
  if (runId !== experienceId) return;
  const prerollPromise = audio.playOneShot(ASSETS.intro.first);
  await delay(1000);
  if (runId !== experienceId) return;
  state.introLabel = "unproductive";
  render();
  await prerollPromise;

  if (runId !== experienceId) return;
  state.introHasFunTime = true;
  render();
  await audio.playOneShot(ASSETS.intro.second);

  if (runId !== experienceId) return;
  state.introHasLogo = true;
  render();
  await audio.playOneShot(ASSETS.intro.cat);

  if (runId !== experienceId) return;
  await delay(TIMINGS.introHold);
  if (runId !== experienceId) return;
  state.introFading = true;
  render();
  await delay(TIMINGS.introFade);

  if (runId !== experienceId) return;
  state.screen = "title";
  render();
}

function retryFirstMusic() {
  firstMusic = prepareTrack(firstMusic.track);
  render();
  firstMusic.promise.then(() => {
    if (state.screen === "title") {
      render();
    }
  });
}

async function enterReader() {
  if (firstMusic?.status !== "ready") {
    return;
  }

  state.currentPage = 0;
  state.furthestPageReached = 0;
  state.currentMusic = firstMusic.track;
  state.navigationLocked = false;
  state.navigationError = null;
  state.screen = "reader";
  render();

  const track = state.currentMusic;
  firstMusic = null;
  warmPagesAfter(0);
  try {
    await playMusic(track);
    prepareNextMusic();
  } catch (error) {
    showPlaybackError(track, error);
  }
}

function setNavigationUi(mode, duration = 0) {
  app.querySelectorAll(".reader-arrow").forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      if (state.navigationLocked) {
        button.setAttribute("aria-disabled", "true");
      } else {
        button.removeAttribute("aria-disabled");
      }
    }
  });

  const bar = app.querySelector(".cooldown-bar");
  if (!bar || mode === "none") {
    return;
  }

  bar.classList.add("is-visible");
  bar.classList.remove("is-waiting", "is-running");
  if (mode === "waiting") {
    bar.classList.add("is-waiting");
    return;
  }

  bar.style.setProperty("--cooldown", `${duration}ms`);
  void bar.offsetWidth;
  bar.classList.add("is-running");
}

function pulseCooldownBar() {
  const bar = app.querySelector(".cooldown-bar");
  if (!bar) return;
  bar.classList.remove("is-pulsing");
  void bar.offsetWidth;
  bar.classList.add("is-pulsing");
}

async function waitForPreparedMusic(track) {
  setPreparedMusic(track);
  await preparedMusic.promise;
  if (preparedMusic.status !== "ready") {
    throw preparedMusic.error;
  }
}

async function ensureForwardAssets(target) {
  if (target < PAGE_COUNT) {
    await preparePage(target);
  }
  if (target > state.furthestPageReached) {
    const targetMusic = musicForTarget(target);
    if (targetMusic.url !== state.currentMusic.url) {
      await waitForPreparedMusic(targetMusic);
    }
  }
}

function forwardCooldown() {
  if (DEV_MODE) return 0;
  return state.currentPage <= 6 ? TIMINGS.earlyForwardCooldown : TIMINGS.lateForwardCooldown;
}

async function requestNavigation(direction) {
  if (state.screen !== "reader") return;

  if (state.navigationLocked) {
    if (direction > 0) pulseCooldownBar();
    return;
  }

  const target = state.currentPage + direction;
  if (target < 0 || target > PAGE_COUNT) return;

  const runId = experienceId;
  state.navigationLocked = true;
  pendingNavigation = { target, runId };

  if (direction < 0) {
    setNavigationUi("none");
    await delay(DEV_MODE ? 0 : TIMINGS.backwardCooldown);
    if (runId !== experienceId || state.screen !== "reader") return;
    await showPage(target);
    return;
  }

  await continueForwardNavigation();
}

async function continueForwardNavigation() {
  const pending = pendingNavigation;
  if (!pending) return;

  state.navigationError = null;
  setNavigationUi("waiting");

  try {
    await ensureForwardAssets(pending.target);
  } catch (error) {
    if (pending.runId !== experienceId) return;
    state.navigationError = error;
    render();
    return;
  }

  if (pending.runId !== experienceId || state.screen !== "reader") return;
  const cooldown = forwardCooldown();
  setNavigationUi("running", cooldown);
  await delay(cooldown);

  if (pending.runId !== experienceId || state.screen !== "reader") return;
  if (pending.target === PAGE_COUNT) {
    await showCredits();
  } else {
    await showPage(pending.target);
  }
}

async function retryNavigation() {
  if (failedPlaybackTrack) {
    const track = failedPlaybackTrack;
    state.navigationError = null;
    render();

    try {
      await audio.prepareBuffer(track.url);
      await playMusic(track);
      failedPlaybackTrack = null;
      state.navigationLocked = false;
      state.navigationError = null;
      app.querySelector(".asset-error")?.remove();
      setNavigationUi("none");
      if (state.screen === "reader") prepareNextMusic();
    } catch (error) {
      showPlaybackError(track, error);
    }
    return;
  }

  if (!pendingNavigation) return;

  if (preparedMusic?.status === "error") {
    preparedMusic = prepareTrack(preparedMusic.track);
  }
  state.navigationError = null;
  render();
  continueForwardNavigation();
}

async function fadeCurrentPage() {
  const image = app.querySelector(".reader-page");
  image?.classList.add("page-exit");
  await delay(TIMINGS.pageFade);
}

async function showPage(target) {
  await fadeCurrentPage();
  const advanced = target > state.furthestPageReached;
  const targetMusic = advanced ? musicForPage(target) : state.currentMusic;
  const musicChanged = advanced && targetMusic.url !== state.currentMusic.url;
  const nextMusic = musicChanged ? preparedMusic : null;

  state.currentPage = target;
  if (advanced) {
    state.furthestPageReached = target;
  }
  if (musicChanged) {
    state.currentMusic = nextMusic.track;
    preparedMusic = null;
  }
  state.navigationError = null;
  pendingNavigation = null;
  render();
  setNavigationUi("none");
  app.querySelector(".reader-page-scroll")?.scrollTo({ top: 0, left: 0 });
  warmPagesAfter(target);

  if (musicChanged) {
    const track = state.currentMusic;
    try {
      await playMusic(track);
      prepareNextMusic();
    } catch (error) {
      showPlaybackError(track, error);
      return;
    }
  }
  state.navigationLocked = false;
  setNavigationUi("none");
}

async function showCredits() {
  await fadeCurrentPage();
  const finalMusic = preparedMusic;
  state.currentMusic = finalMusic.track;
  preparedMusic = null;
  state.navigationLocked = false;
  pendingNavigation = null;
  state.screen = "credits";
  render();
  try {
    await playMusic(state.currentMusic);
  } catch (error) {
    showPlaybackError(state.currentMusic, error);
  }
}

function showPlaybackError(track, error) {
  failedPlaybackTrack = track;
  state.navigationLocked = true;
  state.navigationError = error;
  render();
}

async function devJump(target) {
  if (!DEV_MODE || target === state.currentPage || state.navigationLocked) return;

  state.navigationLocked = true;
  setNavigationUi("waiting");

  try {
    await ensureForwardAssets(target);
    await showPage(target);
  } catch (error) {
    state.navigationError = error;
    pendingNavigation = { target, runId: experienceId };
    render();
  }
}

async function restartExperience() {
  experienceId += 1;
  audio.stopAll();
  firstMusic = null;
  preparedMusic = null;
  pendingNavigation = null;
  failedPlaybackTrack = null;
  state.hasStarted = false;
  state.introLabel = "";
  state.introHasFunTime = false;
  state.introHasLogo = false;
  state.introFading = false;
  state.currentPage = 0;
  state.furthestPageReached = 0;
  state.currentMusic = null;
  state.navigationLocked = false;
  state.navigationError = null;
  state.needsAudioResume = false;
  state.loadingError = null;
  state.screen = "loading";
  render();

  try {
    await prepareInitialAssets();
    state.screen = "start";
  } catch (error) {
    state.loadingError = error;
  }
  render();
}

async function resumeAudio() {
  const resumed = await audio.tryResume();
  state.needsAudioResume = !resumed;
  if (resumed) app.querySelector(".resume-prompt")?.remove();
}

function syncAudioState() {
  if (audio.context.state === "running") {
    state.needsAudioResume = false;
    app.querySelector(".resume-prompt")?.remove();
    return;
  }

  if (state.hasStarted && document.visibilityState === "visible") {
    state.needsAudioResume = true;
    if (!app.querySelector(".resume-prompt")) {
      app.insertAdjacentHTML("beforeend", resumePrompt());
      app.querySelector('[data-action="resume-audio"]')?.addEventListener("click", resumeAudio);
    }
  }
}

function updateCursorTimer() {
  window.clearTimeout(cursorTimer);
  app.classList.remove("cursor-idle");
  if (state.screen !== "reader" || isMobileWidth()) return;

  cursorTimer = window.setTimeout(() => {
    if (state.screen === "reader") {
      app.classList.add("cursor-idle");
    }
  }, TIMINGS.cursorIdle);
}

window.addEventListener("pointermove", updateCursorTimer, { passive: true });

window.addEventListener("keydown", (event) => {
  if (state.screen !== "reader" || event.repeat) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    requestNavigation(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    requestNavigation(1);
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !state.hasStarted) return;
  const resumed = await audio.tryResume();
  if (!resumed) {
    syncAudioState();
  }
});

audio?.context.addEventListener("statechange", syncAudioState);

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

window.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("dragstart", (event) => {
  if (event.target instanceof HTMLImageElement) event.preventDefault();
});
window.addEventListener("dblclick", (event) => {
  if (event.target.closest("button, .reader-controls, .audio-controls")) event.preventDefault();
});

render();
boot();
