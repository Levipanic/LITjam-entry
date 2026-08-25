const pageUrls = [
  new URL("../pages/renders/00_page.webp", import.meta.url).href,
  new URL("../pages/renders/01_page.webp", import.meta.url).href,
  new URL("../pages/renders/02_page.webp", import.meta.url).href,
  new URL("../pages/renders/03_page.webp", import.meta.url).href,
  new URL("../pages/renders/04_page.webp", import.meta.url).href,
  new URL("../pages/renders/05_page.webp", import.meta.url).href,
  new URL("../pages/renders/06_page.webp", import.meta.url).href,
  new URL("../pages/renders/07_page.webp", import.meta.url).href,
  new URL("../pages/renders/08_page.webp", import.meta.url).href,
  new URL("../pages/renders/09_page.webp", import.meta.url).href,
  new URL("../pages/renders/10_page.webp", import.meta.url).href,
  new URL("../pages/renders/11_page.webp", import.meta.url).href,
  new URL("../pages/renders/12_page.webp", import.meta.url).href,
  new URL("../pages/renders/13_page.webp", import.meta.url).href,
  new URL("../pages/renders/14_page.webp", import.meta.url).href,
  new URL("../pages/renders/15_page.webp", import.meta.url).href,
  new URL("../pages/renders/16_page.webp", import.meta.url).href,
  new URL("../pages/renders/17_page.webp", import.meta.url).href,
  new URL("../pages/renders/18_page.webp", import.meta.url).href,
  new URL("../pages/renders/19_page.webp", import.meta.url).href,
  new URL("../pages/renders/20_page.webp", import.meta.url).href,
];

export const ASSETS = {
  logo: new URL("../logo.png", import.meta.url).href,
  pages: pageUrls,
  intro: {
    first: new URL("../audio/intropreroll1.mp3", import.meta.url).href,
    second: new URL("../audio/intropreroll2.mp3", import.meta.url).href,
    cat: new URL("../audio/cat.mp3", import.meta.url).href,
  },
};

export const MUSIC_CUES = [
  { page: 0, track: { name: "manualbegins", url: new URL("../audio/manualbegins.mp3", import.meta.url).href } },
  { page: 5, track: { name: "go-on", url: new URL("../audio/go-on.mp3", import.meta.url).href } },
  { page: 9, track: { name: "A Stab of Happiness", url: new URL("../audio/OFF - A Stab of Happiness.mp3", import.meta.url).href } },
  { page: 10, track: { name: "childsplay", url: new URL("../audio/childsplay.mp3", import.meta.url).href } },
  { page: 12, track: { name: "Clockwork", url: new URL("../audio/Clockwork.mp3", import.meta.url).href } },
  { page: 13, track: { name: "inrainydaynorain", url: new URL("../audio/inrainydaynorain.mp3", import.meta.url).href } },
  { page: 15, track: { name: "greypencil", url: new URL("../audio/greypencil.mp3", import.meta.url).href } },
  { page: 16, track: { name: "Brain Plague (Re-Reversed)", url: new URL("../audio/OFF - Brain Plague (Re-Reversed).mp3", import.meta.url).href } },
  { page: 17, track: { name: "Brain Plague (Rewind)", url: new URL("../audio/OFF - Brain Plague (Rewind).mp3", import.meta.url).href } },
  { page: 19, track: { name: "DesperatelySafe", url: new URL("../audio/OFF - DesperatelySafe.mp3", import.meta.url).href } },
];

export const CREDITS_TRACK = {
  name: "dramaticcrusendo",
  url: new URL("../audio/dramaticcrusendo.mp3", import.meta.url).href,
  loop: false,
};

const loadedImages = new Map();

const delay = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

async function loadImage(url, attempts = 3) {
  if (loadedImages.has(url)) {
    return loadedImages.get(url);
  }

  const request = (async () => {
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const image = new Image();
        image.decoding = "async";
        image.src = url;

        if (typeof image.decode === "function") {
          try {
            await image.decode();
          } catch (error) {
            if (image.complete && image.naturalWidth === 0) {
              throw error;
            }
            if (!image.complete) {
              await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(error);
              });
            }
          }
        } else {
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
          });
        }

        return image;
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          await delay(500 * 2 ** attempt);
        }
      }
    }

    throw lastError ?? new Error(`Не удалось загрузить изображение: ${url}`);
  })();

  loadedImages.set(url, request);

  try {
    return await request;
  } catch (error) {
    loadedImages.delete(url);
    throw error;
  }
}

export function preparePage(index, attempts = 3) {
  const url = ASSETS.pages[index];
  if (!url) {
    return Promise.reject(new Error(`Неизвестная страница: ${index}`));
  }
  return loadImage(url, attempts);
}

export function prepareCriticalImages() {
  return Promise.all([
    loadImage(ASSETS.logo),
    preparePage(0),
    preparePage(1),
    preparePage(2),
  ]);
}

export function warmPagesAfter(index) {
  const retainedUrls = new Set(ASSETS.pages.slice(Math.max(0, index - 1), index + 3));
  for (const url of ASSETS.pages) {
    if (!retainedUrls.has(url)) {
      loadedImages.delete(url);
    }
  }

  for (let offset = -1; offset <= 2; offset += 1) {
    if (offset !== 0 && index + offset >= 0 && index + offset < ASSETS.pages.length) {
      preparePage(index + offset).catch(() => {});
    }
  }
}
