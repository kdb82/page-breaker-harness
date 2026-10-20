// Small DOM stand-in for logic that is otherwise only reachable after Chrome injection.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let now = 1000;
const listeners = new Map();
const rect = { left: 160, top: 170, right: 280, bottom: 250, width: 120, height: 80 };
const values = new Map();
const style = {
  getPropertyValue: (name) => values.get(name)?.value || "",
  getPropertyPriority: (name) => values.get(name)?.priority || "",
  setProperty: (name, value, priority = "") => values.set(name, { value, priority }),
  removeProperty: (name) => values.delete(name),
};
style.setProperty("mask-image", "original-mask");
style.setProperty("mask-composite", "add", "important");
style.setProperty("-webkit-mask-image", "original-webkit-mask", "important");
style.setProperty("mask-size", "40px 40px", "important");
style.setProperty("mask-position", "12px 8px");
style.setProperty("mask-repeat", "repeat");
style.setProperty("mask-origin", "content-box");
style.setProperty("mask-clip", "padding-box", "important");
style.setProperty("-webkit-mask-size", "55px 35px", "important");
style.setProperty("-webkit-mask-position", "9px 6px");
style.setProperty("-webkit-mask-repeat", "repeat-x");
style.setProperty("-webkit-mask-origin", "content-box", "important");
style.setProperty("-webkit-mask-clip", "padding-box");
const target = {
  tagName: "IMG",
  localName: "img",
  childNodes: [],
  offsetWidth: 120,
  offsetHeight: 80,
  _baseMask: "linear-gradient(black, transparent)",
  _webkitMask: "linear-gradient(black, transparent)",
  style,
  isConnected: true,
  getBoundingClientRect: () => rect,
};
const pageRoot = { parentElement: null };
target.parentElement = pageRoot;
const elements = [target];
let cover = null;
let extraHit = null;
let shadowHost = null;
let exposedHole = false;
const coverRect = { left: 190, top: 200, right: 210, bottom: 220, width: 20, height: 20 };
const hudParts = new Map();
const hud = {
  set className(value) { this._className = value; },
  set innerHTML(value) { this._innerHTML = value; },
  querySelector(selector) {
    if (!hudParts.has(selector)) hudParts.set(selector, { textContent: "" });
    return hudParts.get(selector);
  },
};
const context2d = { setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {} };
let host;
let divCount = 0;
const inlineStyle = (element, property) => element.style?.getPropertyValue(property) || "";
const hitTestable = (element) => element._pointerEvents !== "none" || inlineStyle(element, "pointer-events") === "auto";
const document = {
  documentElement: { append(element) { host = element; } },
  body: { querySelectorAll: () => elements },
  createElement(tag) {
    if (tag === "canvas") return { getContext: () => context2d };
    if (tag === "link") return {};
    if (tag === "div" && ++divCount === 2) return hud;
    return {
      style: { setProperty() {} },
      attachShadow: () => ({ append() {} }),
      remove() { this.removed = true; },
    };
  },
  createRange() {
    return {
      selectNodeContents(node) { this.node = node; },
      getClientRects() { return [this.node.rect]; },
      detach() {},
    };
  },
  elementsFromPoint(x, y) {
    if (exposedHole) return [pageRoot];
    if (shadowHost && x >= shadowHost.rect.left && x <= shadowHost.rect.right &&
        y >= shadowHost.rect.top && y <= shadowHost.rect.bottom) return [shadowHost];
    const hits = [];
    if (cover && hitTestable(cover) && x >= coverRect.left && x <= coverRect.right && y >= coverRect.top && y <= coverRect.bottom) hits.push(cover);
    if (extraHit) {
      const bounds = extraHit.getBoundingClientRect();
      if (hitTestable(extraHit) && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) hits.push(extraHit);
    }
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) hits.push(target);
    return hits;
  },
};
const sandbox = {
  document,
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  Node: { TEXT_NODE: 3 },
  chrome: { runtime: { getURL: (name) => name } },
  performance: { now: () => now },
  MutationObserver: class { observe() {} disconnect() {} },
  AbortController,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  getComputedStyle: (element) => ({
    display: "block", visibility: "visible", opacity: element._opacity || "1",
    pointerEvents: inlineStyle(element, "pointer-events") || element._pointerEvents || "auto",
    backgroundImage: "none", backgroundColor: element._background || "transparent",
    transform: element._transform || "none",
    maskImage: element._dynamicMask ? element.style.getPropertyValue("mask-image") || "none" : element._baseMask || "none",
    webkitMaskImage: element._dynamicMask ? element.style.getPropertyValue("-webkit-mask-image") || "none" : element._webkitMask || "none",
    maskComposite: element._dynamicMask ? element.style.getPropertyValue("mask-composite") || "add" : element._baseComposite || "add",
    webkitMaskComposite: element._dynamicMask ? element.style.getPropertyValue("-webkit-mask-composite") || "source-over" : element._webkitComposite || "source-over",
    maskSize: inlineStyle(element, "mask-size") || element._maskSize || "auto",
    maskPosition: inlineStyle(element, "mask-position") || element._maskPosition || "0% 0%",
    maskRepeat: inlineStyle(element, "mask-repeat") || element._maskRepeat || "repeat",
    maskOrigin: inlineStyle(element, "mask-origin") || element._maskOrigin || "border-box",
    maskClip: inlineStyle(element, "mask-clip") || element._maskClip || "border-box",
    webkitMaskSize: inlineStyle(element, "-webkit-mask-size") || element._webkitMaskSize || "auto",
    webkitMaskPosition: inlineStyle(element, "-webkit-mask-position") || element._webkitMaskPosition || "0% 0%",
    webkitMaskRepeat: inlineStyle(element, "-webkit-mask-repeat") || element._webkitMaskRepeat || "repeat",
    webkitMaskOrigin: inlineStyle(element, "-webkit-mask-origin") || element._webkitMaskOrigin || "border-box",
    webkitMaskClip: inlineStyle(element, "-webkit-mask-clip") || element._webkitMaskClip || "border-box",
  }),
  addEventListener(type, handler) { listeners.set(type, handler); },
  console,
};
vm.createContext(sandbox);
const source = fs.readFileSync(path.join(__dirname, "..", "extension", "content.js"), "utf8");
vm.runInContext(source, sandbox);
const game = sandbox.__pageSiegeGame;
assert.ok(game);
assert.equal(game.targets.size, 1);
assert.equal(game.ammo[0], 24);

const sounds = [];
game.playSound = (weapon) => sounds.push(weapon);
game.mouse = { x: 200, y: 210 };

game.fire(now);
assert.ok(game.score > 0, "a hit awards destruction score");
assert.match(style.getPropertyValue("mask-image"), /radial-gradient/);
assert.match(style.getPropertyValue("mask-image"), /linear-gradient\(black, transparent\)/, "damage keeps an existing mask");
assert.match(style.getPropertyValue("-webkit-mask-image"), /radial-gradient/, "WebKit receives the damage mask");
assert.match(style.getPropertyValue("-webkit-mask-composite"), /source-in/, "WebKit combines damage with the existing mask");
assert.equal(style.getPropertyValue("mask-size"), "100% 100%, 40px 40px",
  "the hole covers the element while the original mask keeps its size");
assert.equal(style.getPropertyValue("mask-position"), "0% 0%, 12px 8px");
assert.equal(style.getPropertyValue("mask-repeat"), "no-repeat, repeat");
assert.equal(style.getPropertyValue("mask-origin"), "border-box, content-box");
assert.equal(style.getPropertyValue("mask-clip"), "border-box, padding-box");
assert.equal(style.getPropertyValue("-webkit-mask-size"), "100% 100%, 55px 35px");
assert.equal(style.getPropertyValue("-webkit-mask-position"), "0% 0%, 9px 6px");
assert.equal(style.getPropertyValue("-webkit-mask-repeat"), "no-repeat, repeat-x");
assert.equal(style.getPropertyValue("-webkit-mask-origin"), "border-box, content-box");
assert.equal(style.getPropertyValue("-webkit-mask-clip"), "border-box, padding-box");
assert.ok(game.effects.some((effect) => effect.type === "particle" && effect.color === "#ffe08a"), "pistol particles are distinct");
const firstScore = game.score;
now += 300;
exposedHole = true;
game.fire(now);
exposedHole = false;
assert.equal(game.score, firstScore, "a second shot into the same hole adds no score");
assert.equal(game.ammo[0], 22);

// A transform changes the viewport grid but leaves the existing CSS mask hole
// at the same local position. Hitting that transparent spot must stay scoreless.
Object.assign(rect, { left: 100, right: 340, width: 240 });
game.scanGeometry();
game.mouse = { x: 180, y: 210 };
now += 300;
game.fire(now);
assert.equal(game.score, firstScore, "resizing a damaged image cannot score its existing hole again");
Object.assign(rect, { left: 160, right: 280, width: 120 });
game.scanGeometry();
game.mouse = { x: 200, y: 210 };

game.weapon = 1;
now += 300;
game.fire(now);
assert.equal(game.ammo[1], 17, "the AR uses its own ammo");
game.mouseDown = true;
game.tick(now + 110);
game.mouseDown = false;
assert.equal(game.ammo[1], 16, "holding the pointer repeats AR fire");
assert.ok(game.effects.some((effect) => effect.type === "particle" && effect.color === "#95f3a1"),
  "AR particles differ from pistol particles");
game.weapon = 0;
now += 300;
const pointerEvent = {
  button: 0, clientX: 200, clientY: 210,
  preventDefault() {}, stopImmediatePropagation() {},
};
listeners.get("pointerdown")(pointerEvent);
listeners.get("pointerup")(pointerEvent);
assert.equal(game.mouse.x, 200, "a click updates aim to its pointer location");
assert.equal(game.mouse.y, 210);
assert.equal(game.mouseDown, false);

const targetCells = game.damage.get(target).cells.size;
const coverValues = new Map();
cover = {
  tagName: "IMG",
  localName: "img",
  childNodes: [],
  style: {
    getPropertyValue: (name) => coverValues.get(name)?.value || "",
    getPropertyPriority: (name) => coverValues.get(name)?.priority || "",
    setProperty: (name, value, priority = "") => coverValues.set(name, { value, priority }),
    removeProperty: (name) => coverValues.delete(name),
  },
  isConnected: true,
  getBoundingClientRect: () => coverRect,
};
elements.push(cover);
game.scanGeometry();
now += 300;
game.fire(now);
assert.equal(game.damage.get(target).cells.size, targetCells, "a new foreground element shields old damage");
assert.ok(game.damage.has(cover), "the foreground element receives the shot");
const damagedCover = cover;
elements.pop();
cover = null;
game.scanGeometry();

game.player.x = 200;
game.player.y = 310;
game.weapon = 3;
game.mouse = { x: 200, y: 190 };
game.fire(now);
assert.ok(game.score > firstScore, "the laser cuts a fresh path through an image");
assert.equal(game.ammo[3], 5);
assert.match(style.getPropertyValue("mask-composite"), /intersect/, "holes compose rather than cover each other");

game.player.y = 160;
game.player.vy = 300;
game.player.grounded = false;
game.move(0.035);
assert.equal(game.player.y, 170, "the soldier lands on the image's intact top edge");
assert.equal(game.player.grounded, true);
rect.right += 60;
rect.width += 60;
game.scanGeometry();
game.move(0.035);
assert.equal(game.player.grounded, true, "resizing a supporting image keeps the soldier grounded");
rect.right -= 60;
rect.width -= 60;
game.scanGeometry();

rect.top += 45;
rect.bottom += 45;
game.scanGeometry();
assert.equal(game.player.y, 215, "scrolling carries the soldier with the supporting image");
game.move(0.035);
assert.equal(game.player.y, 215, "the soldier remains grounded after the scroll");
rect.top -= 45;
rect.bottom -= 45;
game.scanGeometry();
assert.equal(game.player.y, 170);

rect.left += 150;
rect.right += 150;
game.scanGeometry();
assert.equal(game.player.x, 350, "horizontal scrolling carries the soldier with the image");
game.move(0.035);
assert.equal(game.player.grounded, true, "the soldier stays on the shifted image");
rect.left -= 150;
rect.right -= 150;
game.scanGeometry();
assert.equal(game.player.x, 200);

const scaledRect = { left: 400, top: 280, right: 600, bottom: 430, width: 200, height: 150 };
const scaledValues = new Map();
const scaledImage = {
  tagName: "IMG",
  localName: "img",
  childNodes: [],
  offsetWidth: 100,
  offsetHeight: 50,
  style: {
    getPropertyValue: (name) => scaledValues.get(name)?.value || "",
    getPropertyPriority: (name) => scaledValues.get(name)?.priority || "",
    setProperty: (name, value, priority = "") => scaledValues.set(name, { value, priority }),
    removeProperty: (name) => scaledValues.delete(name),
  },
  isConnected: true,
  getBoundingClientRect: () => scaledRect,
};
elements.push(scaledImage);
game.scanGeometry();
const scoreBeforeScaled = game.score;
assert.ok(game.damageCircle(game.targets.get(scaledImage), 450, 282, 15) > 0);
assert.ok(game.score > scoreBeforeScaled, "fresh damage on a scaled image earns score");
const scaledCells = game.damage.get(scaledImage).cells.size;
const scoreAfterScaled = game.score;
assert.equal(game.damageCircle(game.targets.get(scaledImage), 450, 282, 15), 0, "an identical shot is scoreless");
assert.equal(game.score, scoreAfterScaled);
assert.ok(game.damageCircle(game.targets.get(scaledImage), 467, 282, 15) > 0,
  "an overlapping shot scores its fresh edge");
assert.ok(game.score - scoreAfterScaled >= game.damage.get(scaledImage).cells.size - scaledCells,
  "the fresh edge scores even when it extends an existing local cell");
game.damageCircle(game.targets.get(scaledImage), 450, 320, 5);
const scoreBeforeNarrowEdge = game.score;
const narrowEdgeCells = game.damage.get(scaledImage).cells.size;
assert.ok(game.damageCircle(game.targets.get(scaledImage), 454, 320, 5) > 0,
  "a new visible edge inside an already scored cell still earns score");
assert.ok(game.score > scoreBeforeNarrowEdge);
assert.equal(game.damage.get(scaledImage).cells.size, narrowEdgeCells,
  "the fresh edge remains within the previously scored cells");
assert.match(scaledValues.get("mask-image").value, /radial-gradient.*radial-gradient/,
  "overlapping damage holes remain in the same mask");
const scaledHole = game.damage.get(scaledImage).holes[0];
assert.equal(scaledHole.x, 25, "the impact uses the image's local x coordinate");
assert.equal(scaledHole.y, 2 / 3, "the impact uses the image's local y coordinate");
assert.equal(scaledHole.radiusX, 7.5);
assert.equal(scaledHole.radiusY, 5);
assert.match(scaledValues.get("mask-image").value, /ellipse 7\.5px 5px at 25px/);
assert.equal(game.supportAt(450, 280), false, "collision uses the same local hole coordinates");
Object.assign(scaledRect, { right: 700, width: 300 });
game.scanGeometry();
assert.equal(game.damageCircle(game.targets.get(scaledImage), 475, 282, 15), 0,
  "resizing a scaled image cannot score its old hole");
elements.pop();
game.scanGeometry();

const webkitImage = imageAt(
  { left: 500, top: 180, right: 600, bottom: 230, width: 100, height: 50 }, "none");
webkitImage._webkitMask = "linear-gradient(black, transparent)";
elements.push(webkitImage);
game.scanGeometry();
assert.ok(game.damageCircle(game.targets.get(webkitImage), 550, 200, 15) > 0);
assert.match(webkitImage.style.getPropertyValue("-webkit-mask-image"), /linear-gradient\(black, transparent\)/,
  "a WebKit-only base mask remains in the damage mask");
elements.pop();
game.scanGeometry();

const luminanceImage = imageAt(
  { left: 500, top: 180, right: 600, bottom: 230, width: 100, height: 50 }, "none");
luminanceImage._baseMask = "linear-gradient(white, white)";
luminanceImage._webkitMask = luminanceImage._baseMask;
luminanceImage.style.setProperty("mask-mode", "luminance");
elements.push(luminanceImage);
game.scanGeometry();
assert.ok(game.damageCircle(game.targets.get(luminanceImage), 550, 200, 15) > 0);
assert.match(luminanceImage.style.getPropertyValue("mask-image"),
  /radial-gradient\([^)]*transparent 0 98%, white 100%\)/,
  "the area outside a hole stays opaque under luminance mask mode");
assert.equal(luminanceImage.style.getPropertyValue("mask-mode"), "luminance",
  "damage preserves the page's mask mode");
elements.pop();
game.scanGeometry();

const layeredImage = imageAt(
  { left: 610, top: 180, right: 710, bottom: 230, width: 100, height: 50 }, "none");
layeredImage._baseMask = "linear-gradient(90deg, black 50%, transparent 50%), linear-gradient(90deg, transparent 50%, black 50%)";
layeredImage._webkitMask = layeredImage._baseMask;
layeredImage._baseComposite = "add";
layeredImage._webkitComposite = "source-over";
layeredImage._maskSize = "40px 40px, 80px 25px";
layeredImage._webkitMaskSize = "35px 35px, 70px 20px";
layeredImage._maskPosition = "3px 4px, 6px 7px";
layeredImage._maskRepeat = "repeat-x, no-repeat";
layeredImage._maskOrigin = "content-box, padding-box";
layeredImage._maskClip = "padding-box, content-box";
layeredImage._webkitMaskOrigin = "content-box, padding-box";
layeredImage._webkitMaskClip = "padding-box, content-box";
elements.push(layeredImage);
game.scanGeometry();
assert.ok(game.damageCircle(game.targets.get(layeredImage), 630, 200, 10) > 0);
assert.equal(layeredImage.style.getPropertyValue("mask-composite"), "intersect, add",
  "the two original mask layers remain additive below the damage hole");
assert.equal(layeredImage.style.getPropertyValue("-webkit-mask-composite"), "source-in, source-over",
  "WebKit also preserves the original additive layers");
assert.equal(layeredImage.style.getPropertyValue("mask-size"), "100% 100%, 40px 40px, 80px 25px",
  "both original mask layers retain their distinct sizes");
assert.equal(layeredImage.style.getPropertyValue("mask-position"), "0% 0%, 3px 4px, 6px 7px");
assert.equal(layeredImage.style.getPropertyValue("mask-repeat"), "no-repeat, repeat-x, no-repeat");
assert.equal(layeredImage.style.getPropertyValue("mask-origin"), "border-box, content-box, padding-box");
assert.equal(layeredImage.style.getPropertyValue("mask-clip"), "border-box, padding-box, content-box");
assert.equal(layeredImage.style.getPropertyValue("-webkit-mask-size"), "100% 100%, 35px 35px, 70px 20px");
assert.equal(layeredImage.style.getPropertyValue("-webkit-mask-origin"), "border-box, content-box, padding-box");
assert.equal(layeredImage.style.getPropertyValue("-webkit-mask-clip"), "border-box, padding-box, content-box");
assert.ok(game.damageCircle(game.targets.get(layeredImage), 680, 200, 10) > 0);
assert.equal(layeredImage.style.getPropertyValue("mask-composite"), "intersect, intersect, add",
  "multiple holes intersect the combined original mask");
assert.equal(layeredImage.style.getPropertyValue("mask-size"), "100% 100%, 100% 100%, 40px 40px, 80px 25px",
  "each damage layer gets full-element sizing after another shot");
assert.equal(layeredImage.style.getPropertyValue("mask-origin"), "border-box, border-box, content-box, padding-box",
  "each hole uses border-box coordinates while base layers keep their origins");
elements.pop();
game.scanGeometry();

function imageAt(bounds, transform, parent = pageRoot) {
  const saved = new Map();
  return {
    tagName: "IMG", localName: "img", childNodes: [], parentElement: parent,
    offsetWidth: 100, offsetHeight: 50, _transform: transform, isConnected: true,
    getBoundingClientRect: () => bounds,
    style: {
      getPropertyValue: (name) => saved.get(name)?.value || "",
      getPropertyPriority: (name) => saved.get(name)?.priority || "",
      setProperty: (name, value, priority = "") => saved.set(name, { value, priority }),
      removeProperty: (name) => saved.delete(name),
    },
  };
}

const mirrored = imageAt(
  { left: 300, top: 400, right: 400, bottom: 450, width: 100, height: 50 },
  "matrix(-1, 0, 0, 1, 0, 0)");
elements.push(mirrored);
extraHit = mirrored;
game.scanGeometry();
assert.equal(game.targetAt(310, 402).element, mirrored);
assert.ok(game.damageCircle(game.targets.get(mirrored), 310, 402, 15) > 0);
assert.equal(game.damage.get(mirrored).holes[0].x, 90, "a mirrored impact uses the displayed edge");
assert.equal(game.supportAt(310, 400), false, "the mirrored hole removes the matching platform surface");
assert.equal(game.supportAt(380, 400), true, "the opposite edge remains solid");
elements.pop();
extraHit = null;

const rotated = imageAt(
  { left: 550, top: 300, right: 600, bottom: 400, width: 50, height: 100 },
  "matrix(0, 1, -1, 0, 0, 0)");
elements.push(rotated);
game.scanGeometry();
assert.ok(game.damageCircle(game.targets.get(rotated), 575, 305, 15) > 0);
assert.equal(game.damage.get(rotated).holes[0].x, 5, "rotation maps the impact to local x");
assert.equal(game.damage.get(rotated).holes[0].y, 25, "rotation maps the impact to local y");
assert.equal(game.supportAt(575, 300), false, "rotation maps collision through the same hole");
elements.pop();

const transformedParent = { parentElement: pageRoot, _transform: "matrix(0, 1, -1, 0, 0, 0)" };
const nested = imageAt(
  { left: 720, top: 300, right: 770, bottom: 400, width: 50, height: 100 },
  "matrix(-1, 0, 0, 1, 0, 0)", transformedParent);
elements.push(nested);
game.scanGeometry();
assert.ok(game.damageCircle(game.targets.get(nested), 745, 305, 15) > 0);
assert.equal(game.damage.get(nested).holes[0].x, 95, "ancestor and element transforms compose");
assert.equal(game.damage.get(nested).holes[0].y, 25);
elements.pop();

const shadowBounds = { left: 620, top: 90, right: 700, bottom: 140, width: 80, height: 50 };
const shadowImage = imageAt(shadowBounds, "none", null);
shadowImage.offsetWidth = 80;
const shadowRoot = {
  host: null,
  querySelectorAll: () => [shadowImage],
  elementsFromPoint: () => [shadowImage],
};
shadowHost = {
  tagName: "DIV", localName: "div", childNodes: [], parentElement: pageRoot,
  rect: shadowBounds, getBoundingClientRect: () => shadowBounds, shadowRoot,
};
shadowRoot.host = shadowHost;
shadowImage.getRootNode = () => shadowRoot;
elements.push(shadowHost);
game.scanGeometry();
assert.ok(game.targets.has(shadowImage), "open shadow-root images become targets");
assert.ok(game.platforms.some((platform) => platform.element === shadowImage), "open shadow-root images become platforms");
assert.equal(game.targetAt(650, 115).element, shadowImage, "aiming resolves through the shadow host");
now += 300;
game.mouse = { x: 650, y: 115 };
game.weapon = 0;
game.fire(now);
assert.ok(game.damage.has(shadowImage), "a shot damages the shadow-root image");
elements.pop();
shadowHost = null;
game.scanGeometry();

const pointerFree = imageAt(
  { left: 190, top: 200, right: 230, bottom: 240, width: 40, height: 40 }, "none");
pointerFree._pointerEvents = "none";
pointerFree.style.setProperty("pointer-events", "none", "important");
elements.push(pointerFree);
extraHit = pointerFree;
game.scanGeometry();
assert.equal(game.targetAt(220, 230).element, pointerFree,
  "an untouched pointer-transparent image remains shootable");
assert.equal(pointerFree.style.getPropertyValue("pointer-events"), "none",
  "hit testing restores the page's pointer behavior");
assert.equal(pointerFree.style.getPropertyPriority("pointer-events"), "important");
game.weapon = 0;
game.mouse = { x: 220, y: 230 };
now += 300;
game.fire(now);
assert.ok(game.damage.has(pointerFree), "the pistol damages the pointer-transparent image");
game.weapon = 1;
game.mouse = { x: 225, y: 225 };
now += 300;
game.fire(now);
assert.equal(game.damage.get(pointerFree).holes.length, 2,
  "the AR also targets a pointer-transparent image");
pointerFree.style.removeProperty("pointer-events");
assert.equal(game.targetAt(220, 230).element, pointerFree,
  "a stylesheet's pointer-events rule does not hide a visible target");
assert.equal(pointerFree.style.getPropertyValue("pointer-events"), "",
  "hit testing removes its temporary inline override");
pointerFree.style.setProperty("pointer-events", "none", "important");
const hitTest = document.elementsFromPoint;
document.elementsFromPoint = () => { throw new Error("hit test failed"); };
assert.throws(() => game.targetAt(220, 230), /hit test failed/);
document.elementsFromPoint = hitTest;
assert.equal(pointerFree.style.getPropertyValue("pointer-events"), "none",
  "hit test errors still restore pointer behavior");
cover = imageAt(coverRect, "none");
elements.push(cover);
game.scanGeometry();
assert.equal(game.targetAt(200, 210).element, cover,
  "a painted foreground element shields the pointer-transparent image");
elements.pop();
cover = null;
elements.pop();
extraHit = null;
game.scanGeometry();

const hiddenParent = { parentElement: pageRoot, _opacity: "0" };
const hiddenImage = imageAt(
  { left: 400, top: 120, right: 500, bottom: 170, width: 100, height: 50 },
  "none", hiddenParent);
elements.push(hiddenImage);
game.scanGeometry();
assert.equal(game.targets.has(hiddenImage), false, "content under a transparent ancestor is not a platform or target");
elements.pop();

const painted = imageAt(
  { left: 0, top: 100, right: 800, bottom: 400, width: 800, height: 300 }, "none");
painted.tagName = "DIV";
painted.localName = "div";
painted._background = "rgb(20, 40, 60)";
elements.push(painted);
game.scanGeometry();
assert.ok(game.targets.has(painted), "large painted elements remain damage targets");
assert.ok(game.platforms.some((platform) => platform.element === painted), "large painted elements remain platforms");
assert.ok(game.damageCircle(game.targets.get(painted), 500, 250, 15) > 0,
  "a painted element can be damaged");
game.player.x = 350;
game.player.y = 95;
game.player.vy = 300;
game.player.grounded = false;
game.move(0.035);
assert.equal(game.player.y, 100, "the soldier lands on a painted element");
elements.pop();
game.scanGeometry();

const textRect = { left: 300, top: 80, right: 480, bottom: 120, width: 180, height: 40 };
const textLine = { left: 310, top: 85, right: 470, bottom: 104, width: 160, height: 19 };
const textPlatform = imageAt(textRect, "none");
textPlatform.tagName = "P";
textPlatform.localName = "p";
textPlatform.childNodes = [{ nodeType: 3, textContent: "Text platform", rect: textLine }];
elements.push(textPlatform);
game.scanGeometry();
assert.ok(game.targets.has(textPlatform), "visible text lines become targets");
assert.ok(game.damageCircle(game.targets.get(textPlatform), 450, 95, 10) > 0,
  "text pixels can be damaged");
game.player.x = 350;
game.player.y = 82;
game.player.vy = 300;
game.player.grounded = false;
game.move(0.035);
assert.equal(game.player.y, 85, "the soldier lands on a text line");
elements.pop();

const buttonBounds = { left: 400, top: 120, right: 500, bottom: 160, width: 100, height: 40 };
const button = imageAt(buttonBounds, "none");
button.tagName = "BUTTON";
button.localName = "button";
elements.push(button);
game.scanGeometry();
assert.ok(game.targets.has(button), "controls become targets");
assert.ok(game.damageCircle(game.targets.get(button), 450, 140, 10) > 0,
  "controls can be damaged");
game.player.x = 450;
game.player.y = 117;
game.player.vy = 300;
game.player.grounded = false;
game.move(0.035);
assert.equal(game.player.y, 120, "the soldier lands on a control");
elements.pop();
game.scanGeometry();
game.player.x = 200;
game.player.y = 170;
game.player.grounded = true;
game.player.vy = 0;

const scoreBeforeRocket = game.score;
game.weapon = 2;
game.mouse = { x: 200, y: 210 };
game.fire(now);
assert.ok(game.score > scoreBeforeRocket, "a rocket opens a larger crater");
assert.equal(game.ammo[2], 3);
assert.ok(game.effects.some((effect) => effect.type === "ring" && effect.radius === 74),
  "a rocket creates a blast ring");
assert.ok(game.effects.some((effect) => effect.type === "particle" && effect.color === "#ff9d63"),
  "rocket particles have their own color");
assert.equal(game.supportAt(200, 170), false, "the crater removes its platform surface");
game.move(0.035);
assert.ok(game.player.y > 170, "the soldier falls through the crater");

game.weapon = 0;
game.ammo[0] = 1;
game.pickup = { x: game.player.x, y: game.player.y - 18, born: now };
game.updatePickup(now);
assert.equal(game.ammo[0], 24, "touching a crate refills the selected weapon");
assert.equal(game.pickup, null);

game.ammo[0] = 0;
const scoreBeforeEmpty = game.score;
now += 1000;
game.fire(now);
assert.equal(game.score, scoreBeforeEmpty, "empty weapons cannot deal damage");
assert.equal(game.ammo[0], 0);
assert.ok([0, 1, 2, 3].every((weapon) => sounds.includes(weapon)),
  "all four weapons trigger their own sound path");
assert.ok(game.effects.some((effect) => effect.type === "particle" && effect.color === "#75e7ff"),
  "laser particles have their own color");

sandbox.innerWidth = 1920;
Object.assign(rect, { left: 1100, right: 1400, width: 300 });
game.scanGeometry();
game.player.x = 20;
game.player.y = 230;
game.weapon = 3;
game.mouse = { x: 1900, y: 210 };
now += 1000;
game.fire(now);
const laserHoles = game.damage.get(target).holes;
const laserCoordinates = game.targets.get(target).coordinates;
for (let cx = 0; cx < 60; cx++) {
  const point = laserCoordinates.local(rect.left + cx * 5 + 2.5, 210);
  assert.ok(laserHoles.some((hole) =>
    ((point.x - hole.x) / hole.radiusX) ** 2 + ((point.y - hole.y) / hole.radiusY) ** 2 <= 1),
  `the long laser beam covers column ${cx}`);
}

elements.push(damagedCover);
game.scanGeometry();
damagedCover._dynamicMask = true;
damagedCover.style.setProperty("mask-image",
  "linear-gradient(black, transparent), linear-gradient(white, transparent)", "important");
damagedCover.style.setProperty("mask-composite", "subtract");
damagedCover.style.setProperty("mask-size", "35px 25px", "important");
damagedCover.style.setProperty("mask-origin", "content-box", "important");
game.damageCircle(game.targets.get(damagedCover), 193, 203, 5);
assert.match(damagedCover.style.getPropertyValue("mask-image"), /linear-gradient\(black, transparent\)/,
  "a later shot uses the page's new standard mask");
assert.equal(damagedCover.style.getPropertyValue("mask-composite"), "intersect, intersect, subtract",
  "a later shot keeps the page's new composition between base layers");
assert.equal(damagedCover.style.getPropertyValue("mask-size"), "100% 100%, 100% 100%, 35px 25px, 35px 25px",
  "a later shot keeps the page's new size on both base layers");
assert.equal(damagedCover.style.getPropertyValue("mask-origin"),
  "border-box, border-box, content-box, content-box",
  "a later shot keeps the page's new origin on both base layers");
damagedCover.style.setProperty("-webkit-mask-image",
  "linear-gradient(white, transparent), linear-gradient(black, transparent)");
damagedCover.style.setProperty("-webkit-mask-composite", "source-out");
damagedCover.style.setProperty("-webkit-mask-clip", "content-box");
game.damageCircle(game.targets.get(damagedCover), 207, 217, 5);
assert.match(damagedCover.style.getPropertyValue("-webkit-mask-image"), /linear-gradient\(white, transparent\)/,
  "a later shot uses the page's new WebKit mask");
assert.equal(damagedCover.style.getPropertyValue("-webkit-mask-composite"), "source-in, source-in, source-in, source-out",
  "a later shot keeps the page's new WebKit composition");
assert.equal(damagedCover.style.getPropertyValue("-webkit-mask-clip"),
  "border-box, border-box, border-box, content-box, content-box",
  "a later shot keeps the page's new WebKit clip on its original layers");
elements.pop();
game.scanGeometry();
vm.runInContext(source, sandbox);
assert.equal(sandbox.__pageSiegeGame, undefined, "reinjection toggles off");
assert.equal(style.getPropertyValue("mask-image"), "original-mask", "stopping restores original styles");
assert.equal(style.getPropertyValue("mask-composite"), "add", "stopping restores original mask composition");
assert.equal(style.getPropertyPriority("mask-composite"), "important", "stopping restores composition priority");
assert.equal(style.getPropertyValue("-webkit-mask-image"), "original-webkit-mask", "stopping restores the WebKit mask");
assert.equal(style.getPropertyPriority("-webkit-mask-image"), "important", "stopping restores original priority");
for (const [property, value, priority] of [
  ["mask-size", "40px 40px", "important"],
  ["mask-position", "12px 8px", ""],
  ["mask-repeat", "repeat", ""],
  ["mask-origin", "content-box", ""],
  ["mask-clip", "padding-box", "important"],
  ["-webkit-mask-size", "55px 35px", "important"],
  ["-webkit-mask-position", "9px 6px", ""],
  ["-webkit-mask-repeat", "repeat-x", ""],
  ["-webkit-mask-origin", "content-box", "important"],
  ["-webkit-mask-clip", "padding-box", ""],
]) {
  assert.equal(style.getPropertyValue(property), value, `stopping restores ${property}`);
  assert.equal(style.getPropertyPriority(property), priority, `stopping restores ${property} priority`);
}
assert.equal(damagedCover.style.getPropertyValue("mask-image"),
  "linear-gradient(black, transparent), linear-gradient(white, transparent)",
  "stopping preserves the page's later standard mask");
assert.equal(damagedCover.style.getPropertyPriority("mask-image"), "important",
  "stopping preserves the page's later priority");
assert.equal(damagedCover.style.getPropertyValue("mask-composite"), "subtract",
  "stopping preserves the page's later composition");
assert.equal(damagedCover.style.getPropertyValue("mask-size"), "35px 25px",
  "stopping preserves the page's later mask size");
assert.equal(damagedCover.style.getPropertyPriority("mask-size"), "important",
  "stopping preserves the page's later mask size priority");
assert.equal(damagedCover.style.getPropertyValue("mask-origin"), "content-box",
  "stopping preserves the page's later mask origin");
assert.equal(damagedCover.style.getPropertyPriority("mask-origin"), "important");
assert.equal(damagedCover.style.getPropertyValue("-webkit-mask-image"),
  "linear-gradient(white, transparent), linear-gradient(black, transparent)",
  "stopping preserves the page's later WebKit mask");
assert.equal(damagedCover.style.getPropertyValue("-webkit-mask-composite"), "source-out",
  "stopping preserves the page's later WebKit composition");
assert.equal(damagedCover.style.getPropertyValue("-webkit-mask-clip"), "content-box",
  "stopping preserves the page's later WebKit clip");
assert.equal(damagedCover.style.getPropertyPriority("-webkit-mask-image"), "", "stopping preserves later priority changes");
assert.equal(layeredImage.style.getPropertyValue("mask-image"), "",
  "stopping removes game masks and exposes the original two-layer CSS mask");
assert.equal(layeredImage.style.getPropertyValue("mask-composite"), "",
  "stopping removes the game's composition override");
assert.equal(luminanceImage.style.getPropertyValue("mask-image"), "",
  "stopping exposes the original luminance mask");
assert.equal(luminanceImage.style.getPropertyValue("mask-mode"), "luminance",
  "stopping preserves the page's luminance mode");
for (const property of ["mask-size", "mask-position", "mask-repeat", "mask-origin", "mask-clip",
  "-webkit-mask-size", "-webkit-mask-position", "-webkit-mask-repeat", "-webkit-mask-origin", "-webkit-mask-clip"]) {
  assert.equal(layeredImage.style.getPropertyValue(property), "",
    `stopping removes the game's ${property} override`);
}
assert.equal(pointerFree.style.getPropertyValue("pointer-events"), "none",
  "stopping preserves the pointer-transparent image's page style");
assert.equal(host.removed, true);
assert.equal(game.abort.signal.aborted, true, "stopping removes the game's event listeners");
console.log("Game smoke checks passed");
