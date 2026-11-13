// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" } } } }
// Shows the program's icon and a Claude agent's model, effort and context use on the
// left, and the agent's status on the right; on hover, buttons split, zoom and close
// this pane. No title or folder: the tab names it. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { loader, programIcon } from "./loader.js";
import { doneDot, radarTicker } from "./radar.js";
import { panes, props, run, theme, hc, exec, appHome } from "herdr";

// "Opus 5.5 · high · 124k · 62%": a Claude Code agent's model, effort and context use, read from its transcript by context.py.
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    radarTicker(this, cx);
    this.context = null;
    this.pid = null;
    this.measure(cx);
    cx.timer.every(5000, (cx) => this.measure(cx));
  }

  measure(cx) {
    const p = this.me();
    if (p?.program?.key !== "claude" || !p.terminal || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.pid || this.pid.terminal !== p.terminal || Date.now() - this.pid.at > 60000) {
          const got = await hc(["get", p.terminal, "--json"]);
          this.pid = { terminal: p.terminal, id: JSON.parse(got.stdout || "{}").foreground?.pid, at: Date.now() };
        }
        if (!this.pid.id) return;
        const r = await exec("python3", ["-I", `${appHome()}/mods/my-pane/context.py`, String(this.pid.id)]);
        const c = r.code === 0 ? JSON.parse(r.stdout || "null") : null;
        if (!c) this.pid = null; // Claude restarted under another process: look it up again next time.
        if (JSON.stringify(c) !== JSON.stringify(this.context)) { this.context = c; cx.notify(); }
      } catch {} finally { this.busy = false; }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/my-pane/${icon}.svg`).size(14));
  }

  render(cx) {
    this.radarShown = false;
    const t = theme();
    const p = this.me();
    if (!p) return div();
    // The empty tab (mods/blank-tab) has nothing to name.
    if (p.mod === "blank-tab") return div().size_full().bg(t.background);
    const pic = programIcon(p.program, 14, t.dim, p.status === "working", p.pane);
    const st = p.status;
    const pane = p.pane;
    const c = p.program?.key === "claude" ? this.context : null;
    const used = c ? Math.round((100 * c.tokens) / c.window) : 0;
    // Context use: dim, yellow above 30%, red above 50%, red with a skull above 80%.
    const tone = used > 50 ? (t.ansi1 ?? t.blocked) : used > 30 ? (t.ansi3 ?? t.working) : t.dim;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      // No title or folder: the tab already names it. The agent's icon and its context on the
      // left, its state and buttons on the right.
      .when(Boolean(pic), (el) => el.child(pic))
      .when(Boolean(c), el => el.child(div().id(`ph-ctx-${pane}`).flex_none().text_size(11).text_color(tone)
        .tooltip(`Context: ${c.tokens.toLocaleString("en-US")} of ${c.window.toLocaleString("en-US")} tokens`).child([c.model, c.effort, short(c.tokens), `${used > 80 ? "\u{1F480} " : ""}${used}%`].filter(Boolean).join(" \u00b7 "))))
      .child(div().flex_1())
      .when(st === "working", el => el.child(loader(t, 20)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(doneDot(this, t, pane, 18)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", `my-tabs.pane-close:${pane}`)));
  }
}
