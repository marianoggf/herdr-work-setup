// What shows while an agent (or anything) is working: the loader chosen in
// Custom settings > Loaders (mods/my-settings, cmd-alt-l), stored in shared
// "loader.style".
//
// - hamster: a hamster running in a wheel, after uiverse.io/Nawsome/wet-mayfly-23.
//   The wheel turns once a second, two leg poses swap four times a second, and
//   the hamster bobs with each stride.
// - original: Herdr's own spinner, an arc turning in the "working" color.
// - pacman: after cssloaders.github.io's circle "eat" loader: a disc whose
//   mouth opens and shuts every half second, with dots streaming into it.
// - stickfight: an even 11-second fight between a bouncing red boxer and a
//   swaying blue kicker, never in step: a jab into a block, a sway, an
//   uppercut dodged Matrix-style, a roundhouse ducked, a sweep jumped, a dive
//   kick dodged with a backflip, a flying kick blocked, trades to the body and
//   head, a ducked kick punished by an uppercut, a sweep rolled out of, a
//   superman punch and a "come on" wave, then back to their marks. Too many poses for
//   native motion, so it's an animated WebP drawn by stickfight/render.py; a
//   set color picks the matching one-color render (the nearest one for a
//   custom color).
// - kame: a stick figure charging a Kamehameha while it works; when the agent
//   finishes, the tab bar and Workspaces fire it across the title (kameShot).
//   Drawn by kame/kame.py, the same way.
//
// The rest are native motion. Mods can't import across folders, so each keeps
// a copy of this file; this one in mods/workspaces is the original, and the
// SVGs and WebPs live beside it.

import { div, svg, image } from "gpui-kit";
import { shared } from "herdr";

const DIR = "mods/workspaces";
const STRIDE = 250; // ms for one leg swap there and back

// Herdr's own first.
export const LOADERS = [
  { id: "original", name: "Original", detail: "Herdr's own spinner." },
  { id: "hamster", name: "Hamster", detail: "A hamster running in its wheel." },
  { id: "pacman", name: "Pac-Man", detail: "Chomping through a line of dots." },
  { id: "stickfight", name: "Stick Fight", detail: "Two stick figures trading punches, kicks and flips." },
  { id: "kame", name: "Kamehameha", detail: "Charges an energy ball while it works; fires it across the title when it's done." },
  { id: "hud", name: "Status Face", detail: "The classic status-bar face: glances around, takes hits, grins, then god mode." },
];

// The classic status-bar face, cut from a sprite sheet by hud/faces.py. It
// starts healthy and takes damage the longer the agent works: five health
// levels, each a loop of glances and reactions (grin, ouch, head turns, a
// scream), bloodier level by level, staying at the last. Where how long it has
// worked isn't known (the settings preview, the pane header) it plays the
// whole story in 12 seconds, god mode included. Its own colors.
const HUD_LEVEL_AT = [0, 15000, 40000, 80000, 150000]; // ms of work before each level

export function hud(_t, size = 22, level = null) {
  const file = level === null ? "hud" : `hud-${level}`;
  return image(`${DIR}/hud/${file}.webp`).size(size).flex_none();
}

// The face for `key`, hurt by how long it has been drawn working, timed like
// kameCharge: a key not drawn in the last render starts healthy again.
function hudHurt(view, t, key, size) {
  view.hudWork ??= new Map();
  const now = view.kameRender ?? 0;
  let w = view.hudWork.get(key);
  if (!w || w.render < now - 1) w = { at: Date.now() };
  w.render = now;
  const ms = Date.now() - w.at;
  w.level = HUD_LEVEL_AT.filter((at) => ms >= at).length - 1;
  view.hudWork.set(key, w);
  if (w.level < HUD_LEVEL_AT.length - 1) view.radarShown = true;
  return hud(t, size, w.level);
}

// A program's icon (Claude's, Codex's...), tinted or full color. While a Claude
// agent works, its static mascot comes alive instead: one of six routines
// (walk, juggle, jumping jacks, wave, dance, foot tap; mascot/icons.py draws
// them), picked from the agent's own id so each agent does its own, and
// reshuffled every five minutes of work.
//
// Codex shows the ChatGPT knot instead of its own icon (chatgpt/knot.svg, in
// the row's color), and while it works the knot runs one of six native
// routines picked the same way: spin, hop, kaleidoscope (two knots turning at
// different speeds), orbit (a dot circling a pulsing knot), breathe, wobble.
const MASCOT_ROUTINES = ["walk", "juggle", "jacks", "wave", "dance", "tap"];
const KNOT_ROUTINES = ["spin", "hop", "kaleido", "orbit", "breathe", "wobble"];
const KNOT = `${DIR}/chatgpt/knot.svg`;

function pick(list, seed) {
  let h = Math.floor(Date.now() / 300000);
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return list[Math.abs(h) % list.length];
}

function knot(size, color, working, seed) {
  const k = (s = size) => svg(KNOT).size(s).text_color(color);
  if (!working) return k().flex_none();
  const box = div().relative().size(size).flex_none();
  const layer = (el, s = size) => el.absolute().top((size - s) / 2).left((size - s) / 2);
  switch (pick(KNOT_ROUTINES, seed)) {
    case "hop":
      return box.child(layer(div().size(size)).loop("top", { from: 0, to: -size * 0.18, period: 520 }).child(k().spin(2400)));
    case "kaleido":
      return box.child(layer(k().spin(1800))).child(layer(k().spin(2900).opacity(0.4)));
    case "orbit": {
      const inner = Math.round(size * 0.72);
      return box.child(layer(k(inner), inner).loop("opacity", { from: 1, to: 0.55, period: 1200 }))
        .child(layer(svg(`${DIR}/chatgpt/orbit.svg`).size(size).text_color(color).spin(900)));
    }
    case "breathe":
      return box.child(layer(k().spin(5000)).loop("opacity", { from: 1, to: 0.3, period: 1600 }));
    case "wobble":
      return box.child(layer(div().size(size)).loop("left", { from: -size * 0.12, to: size * 0.12, period: 600 }).child(k().spin(3000)));
    default:
      return box.child(layer(k().spin(1400)));
  }
}

export function programIcon(p, size, color, working = false, seed = "") {
  if (!p?.icon) return null;
  if (p.key === "codex" || /codex/i.test(p.icon)) return knot(size, color, working, seed);
  if (working && (p.key === "claude" || /claude/i.test(p.icon))) {
    return image(`${DIR}/mascot/icons/${pick(MASCOT_ROUTINES, seed)}.webp`).w(size).h(size).flex_none();
  }
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The color set in Custom settings > Loaders (shared "loader.color"): white, the
// theme's gray, a custom #rrggbb, or null to keep each loader's own colors.
export function loaderColor(t) {
  const c = shared("loader.color");
  if (c?.mode === "white") return "#ffffff";
  if (c?.mode === "grey") return t?.muted ?? "#8b8d93";
  return c?.mode === "custom" && /^#[0-9a-f]{6}$/i.test(c.hex ?? "") ? c.hex : null;
}

// The hamster itself is a drawing in its own colors; a set color tints its wheel.
export function hamster(t, size = 22, color = null) {
  const layer = (el) => el.absolute().top(0).left(0).size(size);
  return div().relative().size(size).flex_none()
    .child(layer(svg(`${DIR}/wheel.svg`)).text_color(color ?? t.muted).spin(1000))
    .child(layer(div()).loop("top", { from: 0, to: size / 30, period: STRIDE })
      .child(layer(image(`${DIR}/hamster-body.svg`)))
      .child(layer(image(`${DIR}/hamster-legs-a.svg`)).loop("opacity", { from: 1, to: 0, period: STRIDE }))
      .child(layer(image(`${DIR}/hamster-legs-b.svg`)).loop("opacity", { from: 0, to: 1, period: STRIDE })));
}

// Herdr's spinner, at the size it had in a 22 px slot.
export function original(t, size = 22, color = null) {
  return div().size(size).flex_none().flex().items_center().justify_center()
    .child(svg("mods/workspace-chrome/spinner.svg").size(Math.round(size * 0.55)).text_color(color ?? t.working).spin(900));
}

// The mouth is a wedge that fades in and out over the open disc, once a second.
// The dots sit on a ring 7× the slot's size, spun slowly clockwise and clipped
// to a strip from the mouth to the slot's right edge: there its bottom runs
// left in a nearly straight line, so the dots stream into the mouth (natively,
// with no redraws) and vanish behind it.
export function pacman(t, size = 22, color = null) {
  const c = color ?? t.foreground;
  const p = Math.round(size * 0.6); // the disc
  const left = Math.round(size * 0.04), top = (size - p) / 2;
  const cx = left + p / 2, cy = size / 2; // its centre
  const ring = Math.round(size * 7.2); // the dots' ring; its bottom is 0.985 of the way down
  const strip = size - cx;
  const layer = (el) => el.absolute().left(left).top(top).size(p);
  return div().relative().size(size).flex_none()
    .child(div().absolute().left(cx).top(0).w(strip).h(size).overflow_hidden()
      .child(svg(`${DIR}/pacman-dots.svg`).absolute().left(strip / 2 - ring / 2).top(cy - ring * 0.985).size(ring)
        .text_color(c).spin(38000)))
    .child(layer(svg(`${DIR}/pacman-body.svg`)).text_color(c))
    .child(layer(svg(`${DIR}/pacman-mouth.svg`)).text_color(c).loop("opacity", { from: 1, to: 0, period: 1000 }));
}

// The one-color renders of the drawn loaders: white, grey and Custom settings' swatches.
const RENDER_COLORS = {
  white: "#ffffff", grey: "#8b8d93", ff3d00: "#ff3d00", f5a524: "#f5a524", e3c07b: "#e3c07b",
  "3fae6a": "#3fae6a", "22a99a": "#22a99a", "5b8def": "#5b8def", "8b7cf6": "#8b7cf6", d9649a: "#d9649a",
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// The file suffix for `color`: "" for each loader's own colors, else the nearest render's.
function renderSuffix(color) {
  if (!/^#[0-9a-f]{6}/i.test(color ?? "")) return "";
  const c = rgb(color);
  let best = "white", bestDist = Infinity;
  for (const [name, hex] of Object.entries(RENDER_COLORS)) {
    const dist = rgb(hex).reduce((sum, v, i) => sum + (v - c[i]) ** 2, 0);
    if (dist < bestDist) { best = name; bestDist = dist; }
  }
  return `-${best}`;
}

export function stickfight(_t, size = 22, color = null) {
  return image(`${DIR}/stickfight/stickfight${renderSuffix(color)}.webp`).size(size).flex_none();
}

// While it works: a stick figure (an orange gi, or the set color) in a wide
// stance, palms cupped at his hip, charging a ball of blue energy that pulses
// and pulls sparks in. The charge builds the longer the agent works: the ball
// grows (stages 0-4) to its limit, then a ki aura of rising flames flares
// round him (5), then lightning crackles and rocks lift off the ground (6).
// Each stage is an animated WebP drawn by kame/kame.py; stages 5 and 6 (Super
// Saiyan: golden hair and aura, then lightning) by kame/ssj.py, on a canvas
// three times the slot, centred on it, so the aura can leave the square.
const KAME_STAGE_AT = [0, 3000, 6000, 10000, 15000, 22000, 35000]; // ms of work before each stage
const KAME_FULL = 4; // the stage shown where how long it has worked isn't known
const KAME_BIG = 5; // the first stage drawn on the 3x canvas

// An image for a `size` slot; a `big` one (a 3x canvas) spills out of it on every side.
function kameImage(src, size, big) {
  if (!big) return image(src).size(size).flex_none();
  return div().relative().size(size).flex_none().child(image(src).absolute().left(-size).top(-size).size(size * 3));
}

// Characters (Custom settings > Loader > Characters, shared "kame.cast"): when
// on, each working run picks a fighter at random, who charges, fires and flies
// off with the same moves and timings, drawn by kame/cast.py into
// kame/cast/<name>/ in their own colors: Goku (with a head and hair), Piccolo,
// Vegeta (a yellow Final Flash for a shot), Frieza (a purple one), Krillin
// (shorter, so his palms are lower), and the boys Trunks (a yellow shot) and
// Goten, as short as Krillin. Off, nothing here changes anything.
export const KAME_CAST = ["goku", "piccolo", "vegeta", "frieza", "krillin", "trunks", "goten"];
export function kameCastOn() {
  return shared("kame.cast") === true;
}
const KAME_BEAM = ["#40aaff88", "#96e1ff", "#96e1ffcc"]; // the shot's glow, body and burst
const KAME_YELLOW = ["#ffc41e88", "#fff096", "#fff096cc"];
const KAME_BEAMS = { vegeta: KAME_YELLOW, trunks: KAME_YELLOW, frieza: ["#b046ff88", "#e2b0ff", "#e2b0ffcc"] };
const KAME_SHORT = { x: 0.306, y: 0.484 }; // the firing palms of the short ones (Goku's: KAME_HAND)
const KAME_HANDS = { krillin: KAME_SHORT, trunks: KAME_SHORT, goten: KAME_SHORT };

// One of the loader's images (`name` + `ext`), for `fighter` (null: the loader in `color`).
function kameSrc(fighter, name, ext, color) {
  if (fighter) return `${DIR}/kame/cast/${fighter}/${name}.${ext}`;
  return `${DIR}/kame/${name}${renderSuffix(color)}.${ext}`;
}

export function kame(_t, size = 22, color = null, stage = KAME_FULL, fighter = null) {
  // A fighter's images are all on the 3x canvas (room for hair); the plain loader's from stage 5.
  return kameImage(kameSrc(fighter, `kame-charge${stage}`, "webp", color), size, Boolean(fighter) || stage >= KAME_BIG);
}

// The charge for `key`, grown by how long it has been drawn working: a key not
// drawn in the last render starts again from a small ball. Until the last stage
// it keeps the radar ticker going, so the next stage shows within a tick.
function kameCharge(view, t, key, size, color) {
  view.kameWork ??= new Map();
  const now = view.kameRender ?? 0;
  let w = view.kameWork.get(key);
  if (!w || w.render < now - 1) w = { at: Date.now(), fighter: kameCastOn() ? KAME_CAST[Math.floor(Math.random() * KAME_CAST.length)] : null };
  w.render = now;
  const ms = Date.now() - w.at;
  w.stage = KAME_STAGE_AT.filter((at) => ms >= at).length - 1;
  view.kameWork.set(key, w);
  if (w.stage < KAME_STAGE_AT.length - 1) view.radarShown = true;
  return kame(t, size, color, w.stage, w.fighter);
}

// What a working `key` shows, for views that call kameFrame each render (the
// tab bar, Workspaces): the chosen loader, with a Kamehameha that builds up and
// a status face that takes damage.
export function workingLoader(view, t, key, size = 22) {
  if (shared("loader.style") === "kame") return kameCharge(view, t, key, size, loaderColor(t));
  if (shared("loader.style") === "hud") return hudHurt(view, t, key, size);
  return loader(t, size);
}

// When it's done (kameShot): he thrusts his palms out and a beam shoots left
// from them across the title, a burst riding its tip, then it fades and the
// finished dot takes his place. The figure is a still (kame-fire.png); the
// beam is native, so it can leave the slot. It lands like the DONE stamp: drawn
// unfired on the first render, fired on the next (the radar ticker brings it
// within a tick), and transitions carry it out.
const KAME_HAND = { x: 0.241, y: 0.376 }; // the firing palms, as a share of the image
const KAME_SHOT = { duration: 240, easing: "ease-out" };
const KAME_HOLD = 650; // ms the beam stays out before it fades
const KAME_FADE = 380;
const KAME_BEAM_MS = KAME_SHOT.duration + KAME_HOLD + KAME_FADE + 100; // fired to gone
// Once the beam is gone he stands, powers up and blasts off straight up,
// breaking the ground (kame/exit.py, the 3x canvas, played once, ending empty).
const KAME_EXIT_MS = 1800;
const KAME_STALE = 15000; // a shot not fired by then (a tab not drawn) never fires

// Call at the top of render, beside `view.radarShown = false`.
export function kameFrame(view) {
  view.kameRender = (view.kameRender ?? 0) + 1;
}

// The shot for `key`, finished at `since` (ms), in a `size` slot whose left
// edge is `reach` px right of where the beam should stop (the title's start);
// null when Kamehameha isn't the loader, or once the beam has played. Call it
// before kameTitle for the same key, in the same render.
export function kameShot(view, t, key, since, reach, size = 20, color = loaderColor(t), style = shared("loader.style")) {
  if (style !== "kame" || !since || Date.now() - since > KAME_STALE) return null;
  view.kameDrawn ??= new Map();
  view.kameFiredAt ??= new Map();
  const shotAt = view.kameFiredAt.get(key)?.since === since ? view.kameFiredAt.get(key).at : null;
  if (shotAt !== null && Date.now() - shotAt > KAME_BEAM_MS + KAME_EXIT_MS) return null;
  const leaving = shotAt !== null && Date.now() - shotAt > KAME_BEAM_MS;
  const now = view.kameRender ?? 0;
  const fired = (view.kameDrawn.get(key) ?? -2) >= now - 1;
  view.kameDrawn.set(key, now);
  if (fired && view.kameFiredAt.get(key)?.since !== since) view.kameFiredAt.set(key, { since, at: Date.now() });
  view.radarShown = true;
  const fighter = view.kameWork?.get(key)?.fighter ?? null; // who charged it
  const hand = KAME_HANDS[fighter] ?? KAME_HAND;
  const hx = size * hand.x, hy = size * hand.y;
  const len = fired ? hx + Math.max(0, reach) : 0;
  const fade = { duration: KAME_FADE, delay: KAME_HOLD, easing: "ease-in" };
  const beam = (id, h, bg) => div().id(`kame-${key}-${id}`).absolute().rounded_full().bg(bg)
    .left(hx - len).top(hy - h / 2).w(len).h(h).opacity(fired ? 0 : 1)
    .transition("left", KAME_SHOT).transition("width", KAME_SHOT).transition("opacity", fade);
  const b = fired ? size * 1.3 : 0; // the burst at the tip
  const colors = KAME_BEAMS[fighter] ?? KAME_BEAM;
  const burst = div().id(`kame-${key}-burst`).absolute().rounded_full().bg(colors[2])
    .left(hx - len - b / 2).top(hy - b / 2).size(b).opacity(fired ? 0 : 1)
    .transition("left", KAME_SHOT).transition("top", KAME_SHOT).transition("width", KAME_SHOT).transition("height", KAME_SHOT)
    .transition("opacity", { duration: 450, delay: KAME_SHOT.duration, easing: "ease-in" });
  const aimed = view.kameWork?.get(key)?.stage ?? KAME_FULL; // the charge it had built
  // Charged to Super Saiyan, he fires still transformed; after the shot he's back to normal.
  // With the Crater finished dot, the exit ends on the crater and holds it (the
  // dot draws that same frame), so the dot takes over without a seam.
  const [name, ext, big] = leaving ? [`kame-exit${shared("dot.style") === "crater" ? "-hold" : ""}`, "webp", true]
    : !fired ? [`kame-charge${aimed}`, "webp", aimed >= KAME_BIG]
    : aimed >= KAME_BIG ? [`kame-fire${aimed}`, "webp", true]
    : ["kame-fire", "png", false];
  const fig = image(kameSrc(fighter, name, ext, color)).absolute();
  const wide = big || Boolean(fighter); // a fighter's images are all on the 3x canvas
  return div().relative().size(size).flex_none()
    .child(beam("glow", size * 0.55, colors[0]))
    .child(beam("mid", size * 0.32, colors[1]))
    .child(beam("core", size * 0.14, "#ffffff"))
    .child(burst)
    .child(wide ? fig.left(-size).top(-size).size(size * 3) : fig.left(0).top(0).size(size));
}

// The title the shot destroys, or null when no shot is on for `key` (draw the
// plain title then, truncated as usual). Each letter is its own element: whole
// while the figure aims. When the beam reaches it (right to left, as the beam
// travels), a white shockwave flashes over the title, the letter is hurled the
// way the beam pushes, up or down, and fades, and three sparks (white, blue,
// orange) burst out of it. Once the beam is gone the letters fly back from
// where they landed, one after another, left to right, as if rewritten. All
// native transitions; the radar ticker brings the next stage.
//
// The letters can't be clipped (they fly out of the title's box), so a title
// longer than `maxW` (at about `charW` px a letter) is cut to fit, with an ellipsis.
const KAME_BLAST_MS = KAME_BEAM_MS; // how long the letters stay blown away
const KAME_BACK = 900; // ms for one letter to come back
const KAME_BACK_SPREAD = 1500; // ms from the first letter coming back to the last starting
const KAME_SPARKS = ["#ffffff", "#96e1ff", "#ffb347"];

// A steady pseudo-random number in [0, 1) per letter, so a letter flies the same way each render.
function scatter(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function kameTitle(view, key, text, maxW = Infinity, charW = 6.8) {
  const drawn = (view.kameDrawn?.get(key) ?? -2) === (view.kameRender ?? 0);
  const fire = view.kameFiredAt?.get(key);
  let chars = [...String(text)];
  const fit = Math.floor(maxW / charW);
  if (chars.length > fit && fit > 2) chars = [...chars.slice(0, fit - 1), "…"];
  const n = Math.max(1, chars.length);
  const step = Math.min(70, KAME_BACK_SPREAD / n);
  const since = fire ? Date.now() - fire.at : null;
  if (since !== null && since > KAME_BLAST_MS + 800 + step * n + KAME_BACK + 200) return null;
  if (since === null && !drawn) return null;
  view.radarShown = true;
  const blown = since !== null && since < KAME_BLAST_MS;
  const after = since !== null && !blown; // coming back: the sparks and the flash are spent
  const letters = chars.map((ch, i) => {
    const hit = Math.round((1 - i / n) * KAME_SHOT.duration); // when the beam gets there
    const back = Math.round(i * step);
    const dx = -(12 + scatter(i, 1) * 46); // the beam pushes left
    const dy = (scatter(i, 2) - 0.5) * 50;
    const out = (duration) => ({ duration, delay: hit, easing: "ease-out" });
    const home = (duration) => ({ duration, delay: back, easing: "ease-in-out" });
    const letter = div().id(`kame-${key}-ch-${i}`).relative()
      .left(blown ? dx : 0).top(blown ? dy : 0).opacity(blown ? 0 : 1)
      .transition("left", blown ? out(520) : home(KAME_BACK))
      .transition("top", blown ? out(520) : home(KAME_BACK))
      .transition("opacity", blown ? { duration: 420, delay: hit + 120, easing: "ease-in" } : home(KAME_BACK))
      .child(ch === " " ? " " : ch);
    const sparks = after ? [] : KAME_SPARKS.map((bg, k) => {
      const ang = scatter(i, 3 + k) * Math.PI * 2;
      const dist = 10 + scatter(i, 6 + k) * 24;
      const s = blown ? 2.5 + scatter(i, 9 + k) * 2 : 0;
      return div().id(`kame-${key}-sp-${i}-${k}`).absolute().rounded_full().bg(bg)
        .left(charW / 2 + (blown ? Math.cos(ang) * dist : 0) - s / 2).top(8 + (blown ? Math.sin(ang) * dist : 0) - s / 2).size(s)
        .opacity(blown ? 0 : 1)
        .transition("left", out(460)).transition("top", out(460)).transition("width", out(460)).transition("height", out(460))
        .transition("opacity", { duration: 300, delay: hit + 200, easing: "ease-in" });
    });
    return div().relative().flex_none().child(letter).children(sparks);
  });
  const width = n * charW;
  const flash = after ? null : div().id(`kame-${key}-flash`).absolute().left(-4).w(width + 8).rounded_full().bg("#ffffff")
    .top(blown ? -10 : 8).h(blown ? 36 : 0).opacity(blown ? 0 : 0.9)
    .transition("top", { duration: 260, delay: 60, easing: "ease-out" })
    .transition("height", { duration: 260, delay: 60, easing: "ease-out" })
    .transition("opacity", { duration: 520, delay: 140, easing: "ease-out" });
  return div().relative().flex().flex_row().items_center().flex_none().children(letters).when(Boolean(flash), (el) => el.child(flash));
}

// The chosen loader (or `style`, for a preview), in the chosen color.
export function loader(t, size = 22, style = shared("loader.style"), color = loaderColor(t)) {
  if (style === "original") return original(t, size, color);
  if (style === "pacman") return pacman(t, size, color);
  if (style === "stickfight") return stickfight(t, size, color);
  if (style === "kame") return kame(t, size, color);
  if (style === "hud") return hud(t, size);
  return hamster(t, size, color);
}
