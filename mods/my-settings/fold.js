// Folding in Workspaces: a repo's branches, and a branch's tabs, slide shut and
// open under their row. Set in Custom settings > Sections (shared "fold.anim").
//
// The rows sit in a container whose height goes between 0 and its content's
// measured height; motion() makes that change a native transition (or spring),
// so nothing redraws while it plays.
//
// Mods can't import across folders, so each keeps a copy of this file; this one
// in mods/workspaces is the original.

import { shared } from "herdr";

export const SPEEDS = [
  { id: "fast", name: "Fast", ms: 140 },
  { id: "normal", name: "Normal", ms: 240 },
  { id: "slow", name: "Slow", ms: 420 },
];
export const EASINGS = [
  { id: "ease-out", name: "Ease out" },
  { id: "ease-in-out", name: "Ease in-out" },
  { id: "spring", name: "Spring" },
  { id: "linear", name: "Linear" },
];

export function foldSettings() {
  const s = shared("fold.anim") ?? {};
  return { on: s.on ?? true, speed: s.speed ?? "normal", easing: s.easing ?? "ease-out" };
}

// Animates later changes to `el`'s height as chosen; off, it changes at once.
export function motion(el) {
  const { on, speed, easing } = foldSettings();
  if (!on) return el;
  const ms = SPEEDS.find((s) => s.id === speed)?.ms ?? 240;
  if (easing === "spring") return el.spring("height", { response: ms, damping: 0.62 });
  return el.transition("height", { duration: ms, easing: EASINGS.some((e) => e.id === easing) ? easing : "ease-out" });
}
