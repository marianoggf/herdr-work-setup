// A finished agent nobody has looked at: by default a radar pulse, after
// kinetics.colorion.co/effects/radar-pulse. A dot, and three rings that grow
// out of it and fade, a new one every TICK ms.
//
// Herdr's native loops swing there and back, so a ring would shrink in again.
// Instead each ring is a fresh element every third tick: it is drawn small
// behind the dot, and on the next tick a native transition carries it out
// and fades it. The mod only bumps `tick` every TICK ms while a radar shows
// (see radarTicker); everything in between runs natively.
//
// Mods can't import across folders, so each keeps a copy of this file; this
// one in mods/workspaces is the original.

import { div, image } from "gpui-kit";
import { shared } from "herdr";

export const TICK = 800;
const GROW = { duration: 1500, easing: "ease-out" };

// `key` makes the rings' ids unique per place it's drawn (a tab id, a pane id).
export function radar(t, tick, key, size = 20, color = t.done) {
  const dot = Math.max(6, Math.round(size * 0.36));
  const small = dot - 2;
  const rings = [0, 1, 2].map((r) => {
    const age = (((tick - r) % 3) + 3) % 3; // 0: just made, hidden behind the dot; 1: growing; 2: faded out
    const born = Math.floor((tick - r) / 3);
    const s = age === 0 ? small : size;
    return div().id(`radar-${key}-${r}-${born}`).absolute()
      .left((size - s) / 2).top((size - s) / 2).size(s).rounded_full()
      .border(1.5).border_color(color).opacity(age === 0 ? 0.9 : 0)
      .transition("width", GROW).transition("height", GROW)
      .transition("left", GROW).transition("top", GROW).transition("opacity", GROW);
  });
  const at = (s) => (size - s) / 2;
  return div().relative().size(size).flex_none()
    .children(rings)
    .child(div().absolute().left(at(dot + 4)).top(at(dot + 4)).size(dot + 4).rounded_full().bg(`${color}33`))
    .child(div().absolute().left(at(dot)).top(at(dot)).size(dot).rounded_full().bg(color));
}

// Call from init. Re-renders every TICK ms, but only while the last render drew
// a radar: set view.radarShown = false at the top of render, and radar() callers
// set it to true.
export function radarTicker(view, cx) {
  view.tick = 0;
  cx.timer.every(TICK, (cx) => {
    if (!view.radarShown) return;
    view.tick += 1;
    cx.notify();
  });
}

// A dot's color, set in Custom settings (shared "dot.color" for the finished dot,
// "seen.color" for the seen one): white, the theme's gray, a custom #rrggbb, or
// null to keep the theme's (its "done" blue, its "idle" gray).
export function dotColor(key = "dot.color", t = null) {
  const c = shared(key);
  if (c?.mode === "white") return "#ffffff";
  if (c?.mode === "grey") return t?.muted ?? "#8b8d93";
  return c?.mode === "custom" && /^#[0-9a-f]{6}$/i.test(c.hex ?? "") ? c.hex : null;
}

// The finished dot's styles, chosen in Custom settings > Dots (shared "dot.style").
// Herdr's own first.
export const DOTS = [
  { id: "classic", name: "Classic", detail: "Herdr's plain dot." },
  { id: "radar", name: "Radar", detail: "A dot with rings pulsing out of it." },
  { id: "crater", name: "Crater", detail: "The smoking crater the Kamehameha fighter leaves when he blasts off." },
];
// The crater (crater/crater.webp, drawn by kame/exit.py): from the very frame
// the Kamehameha exit ends on (its crater and its dust), the dust rolls and
// smoke rises off it, all of it thinning out over 10 s until only the crater is
// left, held. Same canvas as the exit, three times the slot and centred on it,
// at the exit's scale (a 20 px slot), so it takes over without a seam. It keeps
// its own colors. A tab that finished long ago (or before the view saw it
// finish) gets the bare crater (crater-still.png), so a redraw never brings the
// dust back.
const CRATER = "mods/workspaces/crater/crater.webp";
const CRATER_STILL = "mods/workspaces/crater/crater-still.png";
const CRATER_CLEARED = 16000; // ms after finishing: the exit (if any) and the 10 s of dust are over

// The finished dot in the chosen style (or `style`, for a preview), in a box of
// `size` either way so switching styles doesn't move anything. A radar marks
// the view so its ticker keeps the rings going (see radarTicker).
export function doneDot(view, t, key, size = 20, style = shared("dot.style")) {
  const color = dotColor("dot.color", t) ?? t.done;
  if (style === "crater") {
    const s = 3 * Math.max(size, 20);
    // Views that track when a tab finished (view.finishedAt) know when its dust has cleared.
    const since = view.finishedAt ? view.finishedAt[key] ?? 0 : Date.now();
    const src = Date.now() - since > CRATER_CLEARED ? CRATER_STILL : CRATER;
    return div().relative().size(size).flex_none()
      .child(image(src).absolute().left((size - s) / 2).top((size - s) / 2).size(s));
  }
  if (style === "classic") {
    const dot = Math.max(6, Math.round(size * 0.36));
    return div().size(size).flex_none().flex().items_center().justify_center()
      .child(div().size(dot).rounded_full().bg(color));
  }
  view.radarShown = true;
  return radar(t, view.tick ?? 0, key, size, color);
}

// A tab whose agent finished and that you have since looked at ("idle"), chosen in
// Custom settings > Dots (shared "seen.style"): a hollow ring, or nothing. Either way
// it keeps its slot (13 px in a row, or `size` for a preview), so nothing shifts.
export const SEEN = [
  { id: "ring", name: "Ring", detail: "A hollow circle, as Herdr draws it." },
  { id: "none", name: "Nothing", detail: "No mark once you've looked." },
];

export function seenDot(t, size = 13, style = shared("seen.style")) {
  const box = div().size(size).flex_none().flex().items_center().justify_center();
  if (style === "none") return box;
  const ring = size <= 13 ? 7 : Math.round(size * 0.36);
  return box.child(div().size(ring).rounded_full().border(size <= 13 ? 1.5 : 2).border_color(dotColor("seen.color", t) ?? t.idle ?? t.dim));
}
