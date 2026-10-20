(() => {
  const INSTANCE_KEY = "__pageSiegeGame";
  if (globalThis[INSTANCE_KEY]) {
    globalThis[INSTANCE_KEY].stop();
    return;
  }

  const WEAPONS = [
    { name: "Pistol", capacity: 24, interval: 280, radius: 15, color: "#ffe08a" },
    { name: "AR", capacity: 18, interval: 105, radius: 10, color: "#95f3a1" },
    { name: "Rocket", capacity: 4, interval: 800, radius: 74, color: "#ff9d63" },
    { name: "Laser", capacity: 6, interval: 500, radius: 5, color: "#75e7ff" },
  ];
  const CELL_SIZE = 5;
  const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Digit1", "Digit2", "Digit3", "Digit4", "Numpad1", "Numpad2", "Numpad3", "Numpad4"]);
  const FULL_RECT_TAGS = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "BUTTON", "INPUT", "TEXTAREA", "SELECT"]);
  const MASK_LAYER_SETTINGS = [
    ["size", "100% 100%", "auto"],
    ["position", "0% 0%", "0% 0%"],
    ["repeat", "no-repeat", "repeat"],
    ["origin", "border-box", "border-box"],
    ["clip", "border-box", "border-box"],
  ];
  const MASK_PROPERTIES = ["image", "composite", ...MASK_LAYER_SETTINGS.map(([name]) => name)];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const contains = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const circleMeetsRect = (x, y, radius, rect) => {
    const nearX = clamp(x, rect.left, rect.right);
    const nearY = clamp(y, rect.top, rect.bottom);
    return (x - nearX) ** 2 + (y - nearY) ** 2 <= radius ** 2;
  };
  const insideHole = (x, y, hole) =>
    ((x - hole.x) / hole.radiusX) ** 2 + ((y - hole.y) / hole.radiusY) ** 2 <= 1;

  // Commas inside gradients and URLs do not separate mask layers.
  function cssList(value) {
    const parts = [];
    let start = 0, depth = 0, quote = "", escaped = false;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ""; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  }

  const composedParent = (element) => element.parentElement || element.getRootNode?.().host || null;
  const hiddenByAncestor = (element) => {
    for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || Number(style.opacity) === 0) return true;
    }
    return false;
  };

  // A transformed border box is an affine parallelogram. Its bounding rect
  // supplies the translation (including transform origins and CSS translates),
  // while the composed ancestors supply its orientation and scale.
  function elementCoordinates(element, rect) {
    const width = element.offsetWidth || rect.width;
    const height = element.offsetHeight || rect.height;
    let a = 1, b = 0, c = 0, d = 1;
    for (let node = element; node; node = composedParent(node)) {
      const transform = getComputedStyle(node).transform || "none";
      const match = /^matrix(3d)?\(([^)]+)\)$/.exec(transform);
      if (!match) continue;
      const values = match[2].split(",").map(Number);
      const [pa, pb, pc, pd] = match[1]
        ? [values[0], values[1], values[4], values[5]]
        : [values[0], values[1], values[2], values[3]];
      [a, b, c, d] = [pa * a + pc * b, pb * a + pd * b,
        pa * c + pc * d, pb * c + pd * d];
    }
    const cornersX = [0, a * width, c * height, a * width + c * height];
    const cornersY = [0, b * width, d * height, b * width + d * height];
    const minX = Math.min(...cornersX);
    const minY = Math.min(...cornersY);
    const renderedWidth = Math.max(...cornersX) - minX;
    const renderedHeight = Math.max(...cornersY) - minY;
    // The ratios also account for CSS zoom and preserve layout-only scaling.
    const ratioX = renderedWidth ? rect.width / renderedWidth : 1;
    const ratioY = renderedHeight ? rect.height / renderedHeight : 1;
    a *= ratioX; c *= ratioX;
    b *= ratioY; d *= ratioY;
    const originX = rect.left - minX * ratioX;
    const originY = rect.top - minY * ratioY;
    const determinant = a * d - b * c;
    if (!determinant) return null;
    return {
      width, height,
      local(x, y) {
        const dx = x - originX;
        const dy = y - originY;
        return { x: (d * dx - c * dy) / determinant, y: (a * dy - b * dx) / determinant };
      },
      radiusX(radius) { return radius * Math.hypot(d, c) / Math.abs(determinant); },
      radiusY(radius) { return radius * Math.hypot(b, a) / Math.abs(determinant); },
    };
  }

  const targetContains = (target, x, y) => {
    if (!target.coordinates || !target.visualRects.some((rect) => contains(rect, x, y))) return false;
    const local = target.coordinates.local(x, y);
    return local.x >= 0 && local.x <= target.coordinates.width &&
      local.y >= 0 && local.y <= target.coordinates.height;
  };

  class PageSiege {
    constructor() {
      this.abort = new AbortController();
      this.keys = new Set();
      this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
      this.player = { x: innerWidth / 2, y: innerHeight - 8, vy: 0, grounded: true };
      this.weapon = 0;
      this.ammo = WEAPONS.map((weapon) => weapon.capacity);
      this.lastShot = WEAPONS.map(() => -Infinity);
      this.score = 0;
      this.effects = [];
      this.platforms = [];
      this.support = null;
      this.targets = new Map();
      this.damage = new Map();
      this.observedShadowRoots = new WeakSet();
      this.geometryDirty = true;
      this.lastScan = -Infinity;
      this.lastFrame = 0;
      this.nextPickupAt = performance.now() + 9000;
      this.pickup = null;
      this.mouseDown = false;
      this.audio = null;
      this.noteUntil = 0;
      this.frameId = 0;
    }

    start() {
      this.host = document.createElement("div");
      this.host.id = "page-siege-overlay";
      // The host sits outside the shadow tree, so protect its placement from page CSS.
      for (const [property, value] of Object.entries({ position: "fixed", inset: "0", "z-index": "2147483647", "pointer-events": "none" })) {
        this.host.style.setProperty(property, value, "important");
      }
      const shadow = this.host.attachShadow({ mode: "closed" });
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = chrome.runtime.getURL("content.css");
      shadow.append(style);

      this.canvas = document.createElement("canvas");
      shadow.append(this.canvas);
      this.ctx = this.canvas.getContext("2d");

      const hud = document.createElement("div");
      hud.className = "hud";
      hud.innerHTML = '<div class="hud__title">PAGE SIEGE</div><div class="hud__stats"><span>Weapon: <strong id="weapon"></strong></span><span>Ammo: <strong id="ammo"></strong></span><span>Score: <strong id="score"></strong></span></div><div class="hud__help">A/D move · W jump · S crouch · 1–4 weapons<br>Mouse aim · click fire · hold for AR · Esc exit</div><div class="hud__note" id="note"></div>';
      shadow.append(hud);
      this.hud = {
        weapon: hud.querySelector("#weapon"),
        ammo: hud.querySelector("#ammo"),
        score: hud.querySelector("#score"),
        note: hud.querySelector("#note"),
      };
      document.documentElement.append(this.host);
      this.resize();
      this.updateHud();
      this.bindEvents();
      this.observer = new MutationObserver(() => { this.geometryDirty = true; });
      if (document.body) {
        this.observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "style", "src", "hidden"],
        });
      }
      this.scanGeometry();
      this.frameId = requestAnimationFrame((time) => this.tick(time));
    }

    bindEvents() {
      const options = { capture: true, signal: this.abort.signal };
      addEventListener("keydown", (event) => this.onKeyDown(event), options);
      addEventListener("keyup", (event) => this.onKeyUp(event), options);
      addEventListener("pointermove", (event) => {
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
      }, options);
      addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
        this.mouseDown = true;
        this.fire(performance.now());
        this.consume(event);
      }, options);
      addEventListener("pointerup", (event) => {
        if (event.button === 0) this.mouseDown = false;
        this.consume(event);
      }, options);
      addEventListener("pointercancel", () => { this.mouseDown = false; }, options);
      for (const type of ["click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup"]) {
        addEventListener(type, (event) => this.consume(event), options);
      }
      addEventListener("blur", () => {
        this.keys.clear();
        this.mouseDown = false;
      }, { signal: this.abort.signal });
      addEventListener("scroll", () => { this.geometryDirty = true; }, { capture: true, passive: true, signal: this.abort.signal });
      addEventListener("resize", () => {
        this.resize();
        this.geometryDirty = true;
      }, { signal: this.abort.signal });
      addEventListener("pagehide", () => this.stop(), { once: true, signal: this.abort.signal });
    }

    consume(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    onKeyDown(event) {
      if (event.code === "Escape") {
        this.consume(event);
        this.stop();
        return;
      }
      if (!GAME_KEYS.has(event.code)) return;
      this.consume(event);
      if (event.code.startsWith("Digit") || event.code.startsWith("Numpad")) {
        const number = Number(event.code.slice(-1));
        if (number >= 1 && number <= 4) {
          this.weapon = number - 1;
          this.updateHud();
        }
        return;
      }
      if (event.code === "KeyW" && !this.keys.has("KeyW") && this.player.grounded) {
        this.player.vy = -520;
        this.player.y -= 2;
        this.player.grounded = false;
        this.support = null;
      }
      this.keys.add(event.code);
    }

    onKeyUp(event) {
      if (!GAME_KEYS.has(event.code)) return;
      this.consume(event);
      this.keys.delete(event.code);
    }

    resize() {
      const scale = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(innerWidth * scale);
      this.canvas.height = Math.round(innerHeight * scale);
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
      this.player.x = clamp(this.player.x, 12, innerWidth - 12);
      this.player.y = Math.min(this.player.y, innerHeight - 8);
    }

    // Keep only visible content with its own pixels. Text ranges make individual
    // lines into platforms, while images and controls use their whole rectangle.
    scanGeometry() {
      const oldSupport = this.support;
      this.geometryDirty = false;
      this.lastScan = performance.now();
      this.platforms = [];
      this.targets = new Map();
      if (!document.body) return;

      const roots = [document.body];
      while (roots.length) {
        const root = roots.pop();
        if (root !== document.body && !this.observedShadowRoots.has(root)) {
          this.observer?.observe(root, {
            subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: ["class", "style", "src", "hidden"],
          });
          this.observedShadowRoots.add(root);
        }
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
          if (element === this.host || element.localName === "script" || element.localName === "style") continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
          const computed = getComputedStyle(element);
          if (computed.display === "none" || computed.visibility === "hidden" || Number(computed.opacity) === 0 || hiddenByAncestor(element)) continue;

          const visualRects = [];
          const fullRect = FULL_RECT_TAGS.has(element.tagName) ||
            (element !== document.body && element !== document.documentElement &&
              (computed.backgroundImage !== "none" || (computed.backgroundColor !== "rgba(0, 0, 0, 0)" && computed.backgroundColor !== "transparent")));
          if (fullRect) visualRects.push(rect);

          for (const child of element.childNodes) {
            if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(child);
            for (const line of range.getClientRects()) {
              if (line.width >= 4 && line.height >= 4) visualRects.push(line);
            }
            range.detach();
          }
          if (visualRects.length === 0) continue;
          this.targets.set(element, { element, rect, visualRects, coordinates: elementCoordinates(element, rect) });
          for (const [index, line] of visualRects.entries()) {
            if (line.bottom >= 0 && line.top <= innerHeight) {
              this.platforms.push({ element, index, left: line.left, right: line.right, top: line.top });
            }
          }
        }
      }
      if (oldSupport && this.player.grounded) {
        const current = this.platforms.find((platform) =>
          platform.element === oldSupport.element && platform.index === oldSupport.index);
        if (current) {
          this.player.x = clamp(this.player.x + current.left - oldSupport.left, 12, innerWidth - 12);
          this.player.y = Math.min(this.player.y + current.top - oldSupport.top, innerHeight - 8);
          this.support = this.player.y >= innerHeight - 10 ? null : current;
        } else {
          this.support = null;
        }
      }
    }

    solidAt(platform, x) {
      const target = this.targets.get(platform.element);
      if (!target) return false;
      const { coordinates } = target;
      if (!coordinates) return false;
      const state = this.damage.get(platform.element);
      return [x - 7, x, x + 7].some((footX) => {
        if (footX < platform.left || footX > platform.right) return false;
        const { x: localX, y: localY } = coordinates.local(footX, platform.top + 1);
        if (localX < 0 || localX > coordinates.width || localY < 0 || localY > coordinates.height) return false;
        return !state?.holes.some((hole) => insideHole(localX, localY, hole));
      });
    }

    supportAt(x, y) {
      return y >= innerHeight - 10 || Boolean(this.platformAt(x, y));
    }

    platformAt(x, y) {
      return this.platforms.find((platform) => Math.abs(platform.top - y) <= 4 &&
        x + 8 >= platform.left && x - 8 <= platform.right && this.solidAt(platform, x));
    }

    move(dt) {
      const player = this.player;
      const direction = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
      player.x = clamp(player.x + direction * (this.keys.has("KeyS") ? 115 : 230) * dt, 12, innerWidth - 12);
      if (player.grounded) {
        this.support = player.y >= innerHeight - 10 ? null : this.platformAt(player.x, player.y) || null;
        if (!this.support && player.y < innerHeight - 10) player.grounded = false;
      }
      if (!player.grounded) {
        const oldY = player.y;
        player.vy += 1350 * dt;
        let nextY = player.y + player.vy * dt;
        if (player.vy >= 0) {
          let landing = null;
          for (const rect of this.platforms) {
            if (rect.top < oldY - 2 || rect.top > nextY || player.x + 8 < rect.left || player.x - 8 > rect.right || !this.solidAt(rect, player.x)) continue;
            nextY = rect.top;
            landing = rect;
          }
          if (landing || nextY >= innerHeight - 8) {
            player.grounded = true;
            player.vy = 0;
            this.support = landing;
          }
        }
        player.y = Math.min(nextY, innerHeight - 8);
        if (player.y >= innerHeight - 8) {
          player.grounded = true;
          player.vy = 0;
          this.support = null;
        }
      }
    }

    surfaceAt(x, y) {
      // Hit testing skips pointer-transparent pixels, even when their element
      // is visibly painted. Temporarily include only eligible game targets so
      // the browser still decides which surface is actually on top.
      const transparent = [];
      let surface;
      try {
        for (const target of this.targets.values()) {
          const element = target.element;
          if (!targetContains(target, x, y) || getComputedStyle(element).pointerEvents !== "none") continue;
          const value = element.style.getPropertyValue("pointer-events");
          const priority = element.style.getPropertyPriority("pointer-events");
          transparent.push([element, value, priority]);
          element.style.setProperty("pointer-events", "auto", "important");
        }
        surface = document.elementsFromPoint(x, y)[0];
        while (surface?.shadowRoot) {
          const deeper = surface.shadowRoot.elementsFromPoint(x, y)[0];
          if (!deeper || deeper === surface) break;
          surface = deeper;
        }
      } finally {
        for (const [element, value, priority] of transparent) {
          if (element.style.getPropertyValue("pointer-events") !== "auto" ||
              element.style.getPropertyPriority("pointer-events") !== "important") continue;
          if (value) element.style.setProperty("pointer-events", value, priority);
          else element.style.removeProperty("pointer-events");
        }
      }
      return surface;
    }

    targetAt(x, y) {
      // Resolve the current top surface before considering an exposed hole.
      const surface = this.surfaceAt(x, y);
      let previous = null;
      for (const element of this.damage.keys()) {
        const target = this.targets.get(element);
        if (!target || !targetContains(target, x, y)) continue;
        if (!previous || target.rect.width * target.rect.height < previous.rect.width * previous.rect.height) previous = target;
      }
      for (let element = surface; element; element = composedParent(element)) {
        if (previous && element === previous.element) return previous;
        // An ancestor showing through a mask is the exposed hole, not a new hit.
        if (previous && element === surface) {
          for (let ancestor = composedParent(previous.element); ancestor; ancestor = composedParent(ancestor)) {
            if (ancestor === surface) return previous;
          }
        }
        const target = this.targets.get(element);
        if (target && targetContains(target, x, y)) return target;
      }
      return null;
    }

    damageCircle(target, x, y, radius, deferMask = false) {
      const { element, rect, visualRects, coordinates } = target;
      if (!element.isConnected || !circleMeetsRect(x, y, radius, rect)) return 0;
      if (!coordinates) return 0;
      let state = this.damage.get(element);

      const startX = Math.max(0, Math.floor((x - radius - rect.left) / CELL_SIZE));
      const endX = Math.ceil(Math.min(rect.width, x + radius - rect.left) / CELL_SIZE);
      const startY = Math.max(0, Math.floor((y - radius - rect.top) / CELL_SIZE));
      const endY = Math.ceil(Math.min(rect.height, y + radius - rect.top) / CELL_SIZE);
      const freshCells = new Set();
      const extendedCells = new Set();
      let meetsContent = false;
      for (let cy = startY; cy < endY; cy++) {
        for (let cx = startX; cx < endX; cx++) {
          const px = rect.left + cx * CELL_SIZE + CELL_SIZE / 2;
          const py = rect.top + cy * CELL_SIZE + CELL_SIZE / 2;
          if ((px - x) ** 2 + (py - y) ** 2 > radius ** 2 || !visualRects.some((line) => contains(line, px, py))) continue;
          const local = coordinates.local(px, py);
          if (local.x < 0 || local.x > coordinates.width || local.y < 0 || local.y > coordinates.height) continue;
          meetsContent = true;
          // Both the score grid and existing holes live in element coordinates,
          // so scrolling or resizing cannot score the same empty area twice.
          const key = `${Math.floor(local.x / CELL_SIZE)}:${Math.floor(local.y / CELL_SIZE)}`;
          if (state?.holes.some((hole) => insideHole(local.x, local.y, hole))) continue;
          if (state?.cells.has(key)) extendedCells.add(key);
          else freshCells.add(key);
        }
      }
      if (!meetsContent) return 0;
      const local = coordinates.local(x, y);
      const radiusX = coordinates.radiusX(radius);
      const radiusY = coordinates.radiusY(radius);
      if (freshCells.size === 0 && state?.holes.some((hole) =>
        Math.abs(hole.x - local.x) < 0.001 && Math.abs(hole.y - local.y) < 0.001 &&
        Math.abs(hole.radiusX - radiusX) < 0.001 && Math.abs(hole.radiusY - radiusY) < 0.001)) return 0;
      if (!state) {
        const properties = ["", "-webkit-"].flatMap((prefix) =>
          MASK_PROPERTIES.map((name) => `${prefix}mask-${name}`));
        const original = properties.map((property) => [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
        state = { original, applied: new Map(), cells: new Set(), holes: [] };
        this.damage.set(element, state);
      }
      for (const key of freshCells) state.cells.add(key);
      // CSS masks use the untransformed border box, while hit tests use viewport pixels.
      state.holes.push({
        x: local.x,
        y: local.y,
        radiusX,
        radiusY,
      });
      const newDamage = freshCells.size + extendedCells.size;
      this.score += newDamage;
      if (!deferMask) {
        this.renderMask(element, state);
        this.updateHud();
      }
      return newDamage;
    }

    renderMask(element, state) {
      const gradients = state.holes.map((hole) =>
        `radial-gradient(ellipse ${hole.radiusX}px ${hole.radiusY}px at ${hole.x}px ${hole.y}px, transparent 0 98%, white 100%)`);
      // Expose the latest page-owned inline values while reading computed styles.
      // This also picks up stylesheet changes made after the first shot.
      for (const entry of state.original) {
        const [property] = entry;
        const value = element.style.getPropertyValue(property);
        const priority = element.style.getPropertyPriority(property);
        if (state.applied.get(property) === value && priority === "important") {
          if (entry[1]) element.style.setProperty(property, entry[1], entry[2]);
          else element.style.removeProperty(property);
        } else {
          entry[1] = value;
          entry[2] = priority;
        }
      }
      const computed = getComputedStyle(element);
      const standardImage = computed.maskImage;
      const webkitImage = computed.webkitMaskImage;
      const standardComposite = computed.maskComposite;
      const webkitComposite = computed.webkitMaskComposite;
      const baseImage = standardImage && standardImage !== "none" ? standardImage : webkitImage;
      const baseWebkitImage = webkitImage && webkitImage !== "none" ? webkitImage : standardImage;
      const standardSource = standardImage && standardImage !== "none" ? "mask" : "webkitMask";
      const webkitSource = webkitImage && webkitImage !== "none" ? "webkitMask" : "mask";
      const apply = (property, value) => {
        element.style.setProperty(property, value, "important");
        state.applied.set(property, value);
      };
      const render = (prefix, image, composite, source, intersection, fallback) => {
        const imageProperty = `${prefix}mask-image`;
        const compositeProperty = `${prefix}mask-composite`;
        const baseLayers = image && image !== "none" ? cssList(image) : [];
        const layers = [...gradients, ...baseLayers];
        const baseOperators = cssList(composite || fallback);
        const operators = Array(gradients.length).fill(intersection);
        for (let i = 0; i < baseLayers.length - 1; i++) {
          operators.push(baseOperators[i % baseOperators.length]);
        }
        apply(imageProperty, layers.join(", "));
        if (layers.length > 1) apply(compositeProperty, operators.slice(0, layers.length - 1).join(", "));
        for (const [name, damageValue, defaultValue] of MASK_LAYER_SETTINGS) {
          const computedName = name[0].toUpperCase() + name.slice(1);
          const alternate = source === "mask" ? "webkitMask" : "mask";
          const baseValues = cssList(computed[`${source}${computedName}`] ||
            computed[`${alternate}${computedName}`] || defaultValue);
          // Keep the page's repeating property list on its original layers only.
          const values = [
            ...Array(gradients.length).fill(damageValue),
            ...baseLayers.map((_, index) => baseValues[index % baseValues.length]),
          ];
          apply(`${prefix}mask-${name}`, values.join(", "));
        }
      };
      render("", baseImage, standardComposite, standardSource, "intersect", "add");
      render("-webkit-", baseWebkitImage, webkitComposite, webkitSource, "source-in", "source-over");
    }

    muzzle() {
      const height = this.keys.has("KeyS") ? 24 : 36;
      return { x: this.player.x, y: this.player.y - height * 0.58 };
    }

    fire(time) {
      const index = this.weapon;
      const weapon = WEAPONS[index];
      if (time - this.lastShot[index] < weapon.interval) return;
      if (this.ammo[index] === 0) {
        this.note("Out of ammo — grab a crate", 1400);
        return;
      }
      if (this.geometryDirty) this.scanGeometry();
      this.lastShot[index] = time;
      this.ammo[index]--;
      this.updateHud();
      this.playSound(index);
      const origin = this.muzzle();
      const x = this.mouse.x;
      const y = this.mouse.y;

      if (index === 0 || index === 1) {
        const target = this.targetAt(x, y);
        if (target) this.damageCircle(target, x, y, weapon.radius);
        this.lineEffect(origin.x, origin.y, x, y, weapon.color, index === 0 ? 3 : 2, 100);
        this.burst(x, y, weapon.color, index === 0 ? 11 : 7, index === 0 ? 120 : 90);
      } else if (index === 2) {
        for (const target of this.targets.values()) {
          if (target.visualRects.some((rect) => circleMeetsRect(x, y, weapon.radius, rect))) {
            this.damageCircle(target, x, y, weapon.radius);
          }
        }
        this.lineEffect(origin.x, origin.y, x, y, "#ffc679", 5, 160);
        this.effects.push({ type: "ring", x, y, radius: weapon.radius, color: weapon.color, born: time, duration: 390 });
        this.burst(x, y, weapon.color, 34, 240);
      } else {
        const distance = Math.hypot(x - origin.x, y - origin.y);
        const steps = Math.max(1, Math.ceil(distance / weapon.radius));
        const changed = new Set();
        for (let step = 0; step <= steps; step++) {
          const px = origin.x + (x - origin.x) * step / Math.max(1, steps);
          const py = origin.y + (y - origin.y) * step / Math.max(1, steps);
          const target = this.targetAt(px, py);
          if (target) {
            this.damageCircle(target, px, py, weapon.radius, true);
            if (this.damage.has(target.element)) changed.add(target.element);
          }
        }
        for (const element of changed) this.renderMask(element, this.damage.get(element));
        if (changed.size) this.updateHud();
        this.lineEffect(origin.x, origin.y, x, y, weapon.color, 7, 220);
        this.burst(x, y, weapon.color, 15, 130);
      }
    }

    lineEffect(x1, y1, x2, y2, color, width, duration) {
      this.effects.push({ type: "line", x1, y1, x2, y2, color, width, born: performance.now(), duration });
    }

    burst(x, y, color, count, speed) {
      const now = performance.now();
      for (let i = 0; i < count; i++) {
        const angle = 2 * Math.PI * i / count + Math.random() * 0.35;
        const velocity = speed * (0.35 + Math.random() * 0.65);
        this.effects.push({ type: "particle", x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, color, born: now, duration: 280 + Math.random() * 260 });
      }
    }

    playSound(index) {
      try {
        this.audio ??= new AudioContext();
        if (this.audio.state === "suspended") this.audio.resume();
        const context = this.audio;
        const now = context.currentTime;
        const tone = (type, from, to, duration, volume) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = type;
          oscillator.frequency.setValueAtTime(from, now);
          oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
          gain.gain.setValueAtTime(volume, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(now);
          oscillator.stop(now + duration);
        };
        if (index === 0) tone("square", 620, 120, 0.13, 0.08);
        if (index === 1) tone("sawtooth", 300, 80, 0.075, 0.045);
        if (index === 2) {
          tone("sawtooth", 120, 36, 0.45, 0.13);
          const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.38), context.sampleRate);
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
          const noise = context.createBufferSource();
          const gain = context.createGain();
          gain.gain.setValueAtTime(0.09, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
          noise.buffer = buffer;
          noise.connect(gain).connect(context.destination);
          noise.start(now);
        }
        if (index === 3) tone("sine", 1100, 210, 0.3, 0.12);
      } catch (error) {
        // Audio can be disabled by the browser; visual gameplay still works.
      }
    }

    spawnPickup(time) {
      if (this.pickup || time < this.nextPickupAt) return;
      const direction = this.player.x < innerWidth / 2 ? 1 : -1;
      this.pickup = {
        x: clamp(this.player.x + direction * 65, 24, innerWidth - 24),
        y: clamp(this.player.y - 18, 35, innerHeight - 30),
        born: time,
      };
      this.note("Ammo crate nearby", 2000);
    }

    updatePickup(time) {
      this.spawnPickup(time);
      if (!this.pickup) return;
      if (time - this.pickup.born > 22000) {
        this.pickup = null;
        this.nextPickupAt = time + 5000;
        return;
      }
      const height = this.keys.has("KeyS") ? 24 : 36;
      if (Math.abs(this.player.x - this.pickup.x) < 18 &&
          this.player.y >= this.pickup.y - 10 && this.player.y - height <= this.pickup.y + 10 &&
          this.ammo[this.weapon] < WEAPONS[this.weapon].capacity) {
        this.ammo[this.weapon] = WEAPONS[this.weapon].capacity;
        this.pickup = null;
        this.nextPickupAt = time + 14000;
        this.updateHud();
        this.note(`${WEAPONS[this.weapon].name} refilled`, 1800);
        this.burst(this.player.x, this.player.y - height / 2, "#72f6cf", 16, 100);
      }
    }

    updateHud() {
      this.hud.weapon.textContent = `${this.weapon + 1} ${WEAPONS[this.weapon].name}`;
      this.hud.ammo.textContent = `${this.ammo[this.weapon]}/${WEAPONS[this.weapon].capacity}`;
      this.hud.score.textContent = String(this.score);
    }

    note(message, duration) {
      this.hud.note.textContent = message;
      this.noteUntil = performance.now() + duration;
    }

    drawSoldier(time) {
      const ctx = this.ctx;
      const { x, y } = this.player;
      const crouching = this.keys.has("KeyS");
      const height = crouching ? 24 : 36;
      const top = Math.round(y - height);
      const center = Math.round(x);
      const color = "#26333d";
      const accent = "#8ce2c1";
      const facing = this.mouse.x >= x ? 1 : -1;
      const stride = this.player.grounded && (this.keys.has("KeyA") || this.keys.has("KeyD")) ? Math.round(Math.sin(time / 90) * 4) : 0;
      ctx.fillStyle = "#10242e66";
      ctx.fillRect(center - 11, Math.round(y) + 1, 22, 3);
      ctx.fillStyle = color;
      ctx.fillRect(center - 5, top, 10, 9);
      ctx.fillRect(center - 3, top + 10, 6, crouching ? 7 : 14);
      ctx.fillRect(center - 6 + stride, top + height - 10, 5, 10);
      ctx.fillRect(center + 1 - stride, top + height - 10, 5, 10);
      ctx.fillStyle = accent;
      ctx.fillRect(center - 5, top, 10, 3);
      ctx.fillRect(center + facing * 2, top + 4, 2, 2);
      ctx.fillRect(center - 3, top + 11, 6, 3);

      const muzzle = this.muzzle();
      const angle = Math.atan2(this.mouse.y - muzzle.y, this.mouse.x - muzzle.x);
      const gunX = Math.round(muzzle.x + Math.cos(angle) * 14);
      const gunY = Math.round(muzzle.y + Math.sin(angle) * 14);
      ctx.strokeStyle = color;
      ctx.lineWidth = this.weapon === 2 ? 6 : 4;
      ctx.lineCap = "square";
      ctx.beginPath();
      ctx.moveTo(Math.round(muzzle.x), Math.round(muzzle.y));
      ctx.lineTo(gunX, gunY);
      ctx.stroke();
      ctx.fillStyle = WEAPONS[this.weapon].color;
      ctx.fillRect(gunX - 2, gunY - 2, 4, 4);
    }

    draw(time) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      this.drawSoldier(time);

      if (this.pickup) {
        const { x, y } = this.pickup;
        const bob = Math.sin(time / 220) * 3;
        ctx.fillStyle = "#10242e";
        ctx.fillRect(Math.round(x - 10), Math.round(y - 10 + bob), 20, 20);
        ctx.fillStyle = "#72f6cf";
        ctx.fillRect(Math.round(x - 8), Math.round(y - 8 + bob), 16, 16);
        ctx.fillStyle = "#10242e";
        ctx.fillRect(Math.round(x - 2), Math.round(y - 6 + bob), 4, 12);
        ctx.fillRect(Math.round(x - 6), Math.round(y - 2 + bob), 12, 4);
      }

      this.effects = this.effects.filter((effect) => time - effect.born < effect.duration);
      for (const effect of this.effects) {
        const progress = clamp((time - effect.born) / effect.duration, 0, 1);
        ctx.globalAlpha = 1 - progress;
        ctx.strokeStyle = effect.color;
        ctx.fillStyle = effect.color;
        if (effect.type === "line") {
          ctx.lineWidth = effect.width;
          ctx.beginPath();
          ctx.moveTo(effect.x1, effect.y1);
          ctx.lineTo(effect.x2, effect.y2);
          ctx.stroke();
        } else if (effect.type === "ring") {
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillRect(effect.x + effect.vx * progress * effect.duration / 1000,
            effect.y + effect.vy * progress * effect.duration / 1000 + 50 * progress * progress, 4, 4);
        }
      }
      ctx.globalAlpha = 1;
      const mx = this.mouse.x;
      const my = this.mouse.y;
      ctx.fillStyle = WEAPONS[this.weapon].color;
      ctx.fillRect(mx - 1, my - 9, 2, 6);
      ctx.fillRect(mx - 1, my + 3, 2, 6);
      ctx.fillRect(mx - 9, my - 1, 6, 2);
      ctx.fillRect(mx + 3, my - 1, 6, 2);
    }

    tick(time) {
      const dt = Math.min((time - (this.lastFrame || time)) / 1000, 0.035);
      this.lastFrame = time;
      if ((this.geometryDirty && time - this.lastScan >= 120) || time - this.lastScan > 1500) this.scanGeometry();
      this.move(dt);
      if (this.mouseDown && this.weapon === 1) this.fire(time);
      this.updatePickup(time);
      if (this.noteUntil && time >= this.noteUntil) {
        this.hud.note.textContent = "";
        this.noteUntil = 0;
      }
      this.draw(time);
      this.frameId = requestAnimationFrame((next) => this.tick(next));
    }

    stop() {
      cancelAnimationFrame(this.frameId);
      this.abort.abort();
      this.observer?.disconnect();
      for (const [element, state] of this.damage) {
        for (const [property, value, priority] of state.original) {
          if (element.style.getPropertyValue(property) !== state.applied.get(property) ||
              element.style.getPropertyPriority(property) !== "important") continue;
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
      }
      this.audio?.close();
      this.host?.remove();
      delete globalThis[INSTANCE_KEY];
    }
  }

  const game = new PageSiege();
  globalThis[INSTANCE_KEY] = game;
  try {
    game.start();
  } catch (error) {
    game.stop();
    console.error("Page Siege could not start:", error);
  }
})();
