const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 3;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createViewerController(viewport, image) {
  const pointers = new Map();
  const state = { scale: 1, x: 0, y: 0 };
  let panStart = null;
  let pinchStart = null;
  let tapStart = null;
  let lastTap = null;
  let transitionTimer = 0;

  function geometry(scale = state.scale) {
    const viewportRect = viewport.getBoundingClientRect();
    const width = image.offsetWidth;
    const height = image.offsetHeight;
    const slot = image.parentElement;
    const baseX = (slot?.offsetLeft ?? 0) + image.offsetLeft;
    const baseY = (slot?.offsetTop ?? 0) + image.offsetTop;
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    return {
      viewportRect,
      baseX,
      baseY,
      minX: scaledWidth <= viewport.clientWidth ? (viewport.clientWidth - scaledWidth) / 2 - baseX : viewport.clientWidth - baseX - scaledWidth,
      maxX: scaledWidth <= viewport.clientWidth ? (viewport.clientWidth - scaledWidth) / 2 - baseX : -baseX,
      minY: scaledHeight <= viewport.clientHeight ? (viewport.clientHeight - scaledHeight) / 2 - baseY : viewport.clientHeight - baseY - scaledHeight,
      maxY: scaledHeight <= viewport.clientHeight ? (viewport.clientHeight - scaledHeight) / 2 - baseY : -baseY,
    };
  }

  function constrain() {
    const bounds = geometry();
    state.x = clamp(state.x, bounds.minX, bounds.maxX);
    state.y = clamp(state.y, bounds.minY, bounds.maxY);
  }

  function render() {
    if (state.scale <= MIN_SCALE) {
      state.scale = MIN_SCALE;
      state.x = 0;
      state.y = 0;
      image.classList.remove("is-zoomed");
      image.style.transform = "";
      return;
    }

    image.classList.add("is-zoomed");
    image.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
  }

  function zoomAt(clientX, clientY, nextScale) {
    const oldGeometry = geometry();
    const focusX = clientX - oldGeometry.viewportRect.left;
    const focusY = clientY - oldGeometry.viewportRect.top;
    const contentX = (focusX - oldGeometry.baseX - state.x) / state.scale;
    const contentY = (focusY - oldGeometry.baseY - state.y) / state.scale;

    state.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const nextGeometry = geometry(state.scale);
    state.x = focusX - nextGeometry.baseX - contentX * state.scale;
    state.y = focusY - nextGeometry.baseY - contentY * state.scale;
    constrain();
    render();
  }

  function animateZoom(clientX, clientY) {
    window.clearTimeout(transitionTimer);
    image.style.transition = "transform 200ms ease-out";
    if (state.scale > MIN_SCALE) {
      state.scale = MIN_SCALE;
      state.x = 0;
      state.y = 0;
      render();
    } else {
      zoomAt(clientX, clientY, DOUBLE_TAP_SCALE);
    }
    transitionTimer = window.setTimeout(() => {
      image.style.transition = "";
    }, 200);
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startPan(pointer) {
    panStart = { pointerX: pointer.x, pointerY: pointer.y, x: state.x, y: state.y };
  }

  function startPinch() {
    const [first, second] = [...pointers.values()];
    const focus = midpoint(first, second);
    const currentGeometry = geometry();
    const focusX = focus.x - currentGeometry.viewportRect.left;
    const focusY = focus.y - currentGeometry.viewportRect.top;
    pinchStart = {
      distance: Math.max(1, distance(first, second)),
      scale: state.scale,
      contentX: (focusX - currentGeometry.baseX - state.x) / state.scale,
      contentY: (focusY - currentGeometry.baseY - state.y) / state.scale,
    };
    panStart = null;
    tapStart = null;
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    image.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point(event));
    window.clearTimeout(transitionTimer);
    image.style.transition = "";

    if (pointers.size === 1) {
      startPan(point(event));
      tapStart = { ...point(event), time: performance.now(), moved: false };
    } else if (pointers.size === 2) {
      startPinch();
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const nextPoint = point(event);
    pointers.set(event.pointerId, nextPoint);

    if (tapStart && distance(tapStart, nextPoint) > 10) {
      tapStart.moved = true;
    }

    if (pointers.size === 2 && pinchStart) {
      event.preventDefault();
      const [first, second] = [...pointers.values()];
      const focus = midpoint(first, second);
      const currentGeometry = geometry();
      const focusX = focus.x - currentGeometry.viewportRect.left;
      const focusY = focus.y - currentGeometry.viewportRect.top;
      state.scale = clamp(pinchStart.scale * distance(first, second) / pinchStart.distance, MIN_SCALE, MAX_SCALE);
      state.x = focusX - currentGeometry.baseX - pinchStart.contentX * state.scale;
      state.y = focusY - currentGeometry.baseY - pinchStart.contentY * state.scale;
      constrain();
      render();
    } else if (pointers.size === 1 && state.scale > MIN_SCALE && panStart) {
      event.preventDefault();
      state.x = panStart.x + nextPoint.x - panStart.pointerX;
      state.y = panStart.y + nextPoint.y - panStart.pointerY;
      constrain();
      render();
    }
  }

  function finishPointer(event) {
    const wasTap = pointers.size === 1 && tapStart && !tapStart.moved && performance.now() - tapStart.time <= 250;
    const releasedPoint = point(event);
    pointers.delete(event.pointerId);

    if (wasTap) {
      const isDoubleTap = lastTap && performance.now() - lastTap.time <= 320 && distance(lastTap, releasedPoint) <= 32;
      if (isDoubleTap) {
        animateZoom(releasedPoint.x, releasedPoint.y);
        lastTap = null;
      } else {
        lastTap = { ...releasedPoint, time: performance.now() };
      }
    } else if (tapStart?.moved || pinchStart) {
      lastTap = null;
    }

    tapStart = null;
    pinchStart = null;
    if (pointers.size === 1) {
      startPan([...pointers.values()][0]);
    } else {
      panStart = null;
    }
  }

  function cancelPointer(event) {
    pointers.delete(event.pointerId);
    tapStart = null;
    pinchStart = null;
    lastTap = null;
    if (pointers.size === 1) {
      startPan([...pointers.values()][0]);
    } else {
      panStart = null;
    }
  }

  function onWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, state.scale * Math.exp(-event.deltaY * 0.002));
  }

  function onResize() {
    if (state.scale <= MIN_SCALE) return;
    constrain();
    render();
  }

  viewport.classList.add("is-interactive");
  image.addEventListener("pointerdown", onPointerDown);
  image.addEventListener("pointermove", onPointerMove);
  image.addEventListener("pointerup", finishPointer);
  image.addEventListener("pointercancel", cancelPointer);
  image.addEventListener("wheel", onWheel, { passive: false });
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(viewport);

  return {
    destroy() {
      window.clearTimeout(transitionTimer);
      resizeObserver.disconnect();
      viewport.classList.remove("is-interactive");
      image.removeEventListener("pointerdown", onPointerDown);
      image.removeEventListener("pointermove", onPointerMove);
      image.removeEventListener("pointerup", finishPointer);
      image.removeEventListener("pointercancel", cancelPointer);
      image.removeEventListener("wheel", onWheel);
      image.style.transition = "";
      image.style.transform = "";
      image.classList.remove("is-zoomed");
    },
  };
}
