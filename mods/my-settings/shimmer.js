// Text that shimmers while something works: the "Shimmer" setting in Custom
// settings > Loaders (mods/my-settings, cmd-alt-l), stored in shared
// "loader.shimmer". After text-effects.colorion.co's shimmer text effect: the
// letters go faint and a soft band of light sweeps across them.
//
// GPUI can't clip a gradient to glyphs, so the band is built from layers: the
// text drawn faint, then bright copies of it seen through windows that slide
// across, each window's copy sliding the other way so the letters stay still.
// Five windows, each narrower than the last and stacked over the same middle,
// add up to a band that brightens toward its centre. A native loop goes there
// and back, so the light sweeps both ways.
//
// Mods can't import across folders, so mods/my-settings keeps a copy of this
// file; this one in mods/workspaces is the original.

import { div } from "gpui-kit";
import { shared } from "herdr";

const PERIOD = 3200; // ms for one sweep across and back
// Each window: its width as a share of the text's, and how much of the bright copy shows through it.
const LAYERS = [
  { share: 0.6, opacity: 0.2 },
  { share: 0.45, opacity: 0.25 },
  { share: 0.32, opacity: 0.3 },
  { share: 0.2, opacity: 0.4 },
  { share: 0.1, opacity: 1 },
];

export function shimmerOn() {
  return shared("loader.shimmer") === true;
}

// `text` in a box that fills the room it's given; the text truncates when it
// doesn't fit. The band sweeps the text, not the room. `widths` is a map the
// caller keeps across renders: the text's width is measured into it, and the
// windows only slide once it's known.
export function shimmerText(t, id, text, widths) {
  const w = widths[id];
  const box = div().id(id).relative().flex().flex_1().min_w(0).overflow_hidden()
    .child(div().id(`${id}-text`).min_w(0).truncate().text_color(t.dim)
      .on_size_change(({ width }, cx) => {
        if (Math.abs((widths[id] ?? -1) - width) < 0.5) return;
        widths[id] = width;
        cx.notify();
      })
      .child(text));
  if (!w) return box;
  const reach = (w * LAYERS[0].share) / 2; // the band starts and ends just out of sight
  return box.children(LAYERS.map((l, i) => {
    const bw = w * l.share;
    const from = -reach - bw / 2;
    const to = w + reach - bw / 2;
    return div().id(`${id}-band-${i}`).absolute().top(0).bottom(0).w(bw).overflow_hidden().opacity(l.opacity)
      .loop("left", { from, to, period: PERIOD, easing: "linear" })
      .child(div().id(`${id}-copy-${i}`).absolute().top(0).w(w).truncate().text_color(t.foreground)
        .loop("left", { from: -from, to: -to, period: PERIOD, easing: "linear" })
        .child(text));
  }));
}
