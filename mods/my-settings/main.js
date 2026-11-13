// Custom settings: settings for the mods made here, laid out like Herdr's own
// Settings (whose sections can't be extended): tabs on the left, the page on
// the right. Opened from the sidebar footer's "Custom settings" row
// (mods/my-workspace-chrome) or cmd-alt-l ("mod.open:my-settings"). Esc closes it.
//
// Add a page: an entry in TABS (the left column) or WORKSPACE_TABS (the tabs across
// the top of Workspaces), and a method named after its id.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { LOADERS, loader, kame, kameShot, kameTitle, kameFrame, loaderColor } from "./loader.js";
import { DOTS, SEEN, doneDot, seenDot, radarTicker, stampFrame, stampOn, stampMode, doneStamp } from "./radar.js";
import { SPEEDS, EASINGS, foldSettings } from "./fold.js";
import { shimmerOn, shimmerText } from "./shimmer.js";

const TABS = [
  { id: "workspaces", title: "Workspaces", icon: "mods/workspace-chrome/layers.svg" },
  { id: "sections", title: "Sections", icon: "mods/my-settings/fold-icon.svg" },
];

const WORKSPACE_TABS = [
  { id: "loaders", title: "Loaders", icon: "mods/my-settings/loader-icon.svg" },
  { id: "finished", title: "Finished dot", icon: "mods/my-settings/dot-icon.svg" },
  { id: "seen", title: "Seen dot", icon: "mods/my-settings/seen-icon.svg" },
  { id: "plain", title: "Plain spaces", icon: "mods/my-settings/plain-icon.svg" },
  { id: "badge", title: "Badge", icon: "mods/my-settings/badge-icon.svg" },
];

// The count on a folded row in Workspaces; mods/workspaces draws it the same way (countBadge there).
const COUNT_MODES = [{ id: "off", name: "Off" }, { id: "default", name: "Default" }, { id: "grey", name: "Grey" }];
const countMode = () => shared("fold.count") ?? "default";

// Icons for a space on a folder outside any repo; mods/workspaces draws the chosen one (PLAIN_ICON there).
const PLAIN_ICONS = [
  { id: "folder", name: "Folder", icon: "mods/workspace-chrome/folder.svg" },
  { id: "joker", name: "Joker", icon: "mods/workspaces/joker.svg" },
];

// Colors offered for a custom color, beside a field for any #rrggbb.
const SWATCHES = ["#ff3d00", "#f5a524", "#e3c07b", "#3fae6a", "#22a99a", "#5b8def", "#8b7cf6", "#d9649a"];
const HEX = /^#[0-9a-f]{6}$/i;

// Choice cards: just the preview, all the same size; the chosen one has the accent
// border, and the name shows on hover.
const CARD_W = 168;
const CARD_H = 112;

export default class CustomSettings extends View {
  init(_props, cx) {
    // The custom colors' hex fields: typing a full #rrggbb applies it.
    this.hex = {};
    for (const key of ["loader.color", "dot.color", "seen.color"]) {
      const field = InputState.new({ placeholder: "#rrggbb" });
      field.set_value(shared(key)?.hex ?? "");
      field.on("change", (_e, cx) => {
        const v = field.value().trim().replace(/^(?!#)/, "#");
        if (!HEX.test(v)) return;
        setShared(key, { ...(shared(key) ?? {}), mode: "custom", hex: v.toLowerCase() });
        cx.notify();
      });
      this.hex[key] = field;
    }
    // The name a space outside any repo shows in Workspaces; empty keeps the space's own.
    this.plainName = InputState.new({ placeholder: "The space's own name" });
    this.plainName.set_value(shared("plain.name") ?? "");
    this.plainName.on("change", () => setShared("plain.name", this.plainName.value().trim()));
    this.shimmerWidths = {}; // the preview's measured width (see shimmer.js)
    this.tab = TABS[0].id;
    this.workspaceTab = WORKSPACE_TABS[0].id;
    radarTicker(this, cx); // keeps a radar preview pulsing
  }

  // A page's heading, as Settings writes them: a title and a line under it.
  heading(t, title, detail) {
    return v_flex().gap(4).pb(14).border_b(1).border_color(t.border)
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .child(div().text_size(12.5).text_color(t.muted).child(detail));
  }

  // One card per choice, with a live preview: clicking it stores its id in shared `key`.
  cards(t, items, key, fallback, preview) {
    const chosen = shared(key) ?? fallback;
    const card = (c) => {
      const on = c.id === chosen;
      return h_flex().id(`cs-${key}-${c.id}`).w(CARD_W).h(CARD_H).flex_none().items_center().justify_center().rounded(10).cursor_pointer()
        .border(2).border_color(on ? t.accent : t.border).bg(t.background)
        .hover((s) => s.bg(t.hover))
        .tooltip(c.name)
        .on_click((_e, cx) => { setShared(key, c.id); cx.notify(); })
        .child(preview(c));
    };
    return h_flex().flex_wrap().gap(14).children(items.map(card));
  }

  // Default (each one's own colors), white, the theme's gray, or a custom color: swatches and a hex field.
  colorSetting(t, key, detail) {
    const c = shared(key) ?? {};
    const mode = c.mode ?? "default";
    const set = (change) => setShared(key, { ...c, ...change });
    const modes = [{ id: "default", name: "Default" }, { id: "white", name: "White" }, { id: "grey", name: "Grey" }, { id: "custom", name: "Custom" }];
    return v_flex()
      .child(this.setting(t, "Color", detail, this.segmented(t, `${key}-mode`, modes, mode, (v) => set({ mode: v, hex: c.hex ?? SWATCHES[0] }))))
      .when(mode === "custom", (el) => el.child(h_flex().py(12).gap(8).items_center().border_b(1).border_color(t.border)
        .children(SWATCHES.map((hex) => div().id(`${key}-sw-${hex}`).size(22).flex_none().rounded_full().bg(hex).cursor_pointer()
          .border(2).border_color((c.hex ?? "").toLowerCase() === hex ? t.foreground : "#00000000")
          .on_click((_e, cx) => { set({ hex }); this.hex[key].set_value(hex); cx.notify(); })))
        .child(div().w(8))
        .child(h_flex().w(104).h(28).px(8).flex_none().items_center().rounded(6).border(1).border_color(t.border).bg(t.background)
          .child(Input.new(this.hex[key]).flex_1().text_size(12.5).text_color(t.foreground)))));
  }

  loaders(t) {
    return v_flex().gap(18)
      .child(this.heading(t, "Loader", "What shows while an agent works: in the sidebar, the tab bar, pane headers, the picker and panels."))
      .child(this.cards(t, LOADERS, "loader.style", "hamster", (c) => loader(t, 40, c.id)))
      .child(v_flex()
        .child(this.colorSetting(t, "loader.color", "Default keeps each loader's own colors; the hamster stays itself, its wheel takes the color."))
        .child(this.setting(t, "Shimmer", "A band of light sweeps the name of a working agent or sub-agent in Workspaces.",
          this.segmented(t, "loader-shimmer", [{ id: "on", name: "On" }, { id: "off", name: "Off" }], shimmerOn() ? "on" : "off", (v) => setShared("loader.shimmer", v === "on"))))
        .when(shimmerOn(), (el) => el.child(h_flex().mt(14).w(320).h(34).px(10).gap(8).items_center().rounded(8).border(1).border_color(t.border).bg(t.background).text_size(12.5)
          .child(shimmerText(t, "cs-shimmer-preview", "Fixing the login redirect", this.shimmerWidths))
          .child(loader(t, 20))))
        .when(shared("loader.style") === "kame", (el) => el.child(this.kamePreview(t))));
  }

  // Kamehameha: a title that's charged at for three ticks (the ball growing, then the ki), then shot, blown apart and rewritten (8 s a round).
  kamePreview(t) {
    this.radarShown = true; // the ticker drives the cycle
    const tick = this.tick ?? 0;
    const key = `cs-kame-${Math.floor(tick / 10)}`;
    const text = "Fixing the login redirect";
    const shot = tick % 10 >= 3 ? kameShot(this, t, key, (this.kameSince ??= {})[key] ??= Date.now(), 8 + (this.kameTitleW ?? 0), 20) : null;
    const title = div().id("cs-kame-title").flex_1().min_w(0).text_color(t.foreground)
      .on_size_change(({ width }, cx) => { if (this.kameTitleW !== width) { this.kameTitleW = width; cx.notify(); } })
      .child(kameTitle(this, key, text, this.kameTitleW, 6.7) ?? div().truncate().child(text));
    return h_flex().mt(14).w(320).h(34).px(10).gap(8).items_center().rounded(8).border(1).border_color(t.border).bg(t.background).text_size(12.5)
      .child(title)
      .child(shot ?? kame(t, 20, loaderColor(t), [2, 4, 6][Math.min(2, tick % 10)]));
  }

  finished(t) {
    return v_flex().gap(18)
      .child(this.heading(t, "Finished dot", "What marks a tab whose agent finished while you weren't looking: in the sidebar, the tab bar and pane headers."))
      .child(this.cards(t, DOTS, "dot.style", "radar", (c) => doneDot(this, t, `cs-${c.id}`, 40, c.id)))
      .child(v_flex()
        .child(this.colorSetting(t, "dot.color", "Default is the theme's blue."))
        .child(this.setting(t, "DONE stamp", "When an agent goes from working to done, a tilted DONE stamps down beside its dot in Workspaces, then fades. Default is green.",
          this.segmented(t, "dot-stamp", [{ id: "off", name: "Off" }, { id: "default", name: "Default" }, { id: "white", name: "White" }], stampMode(), (v) => setShared("dot.stamp", v))))
        // The preview stamps again every fifth tick (4 s): a new key lands anew.
        .when(stampOn(), (el) => el.child(h_flex().mt(14).w(320).h(34).px(10).gap(8).items_center().rounded(8).border(1).border_color(t.border).bg(t.background).text_size(12.5)
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child("Fixing the login redirect"))
          .child(doneStamp(this, `cs-stamp-${Math.floor((this.tick ?? 0) / 5)}`, Date.now()))
          .child(doneDot(this, t, "cs-stamp-dot")))));
  }

  seen(t) {
    return v_flex().gap(18)
      .child(this.heading(t, "Seen dot", "What stays on a tab once you've looked at its finished agent: in the sidebar."))
      .child(this.cards(t, SEEN, "seen.style", "ring", (c) => seenDot(t, 40, c.id)))
      .child(this.colorSetting(t, "seen.color", "Default is the theme's gray."));
  }


  // A choice of a few, as Settings draws System / Light / Dark.
  segmented(t, id, options, value, pick) {
    return h_flex().flex_none().p(3).gap(2).rounded(9).border(1).border_color(t.border).bg(t.background)
      .children(options.map((o) => {
        const on = o.id === value;
        return div().id(`${id}-${o.id}`).px(14).py(6).rounded(7).cursor_pointer().text_size(13)
          .bg(on ? t.raised : "#00000000").text_color(on ? t.foreground : t.muted)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { pick(o.id); cx.notify(); })
          .child(o.name);
      }));
  }

  // A setting's row: its name and a line under it on the left, its control on the right.
  setting(t, title, detail, control, dim = false) {
    return h_flex().py(14).gap(16).items_center().justify_between().border_b(1).border_color(t.border)
      .when(dim, (el) => el.opacity(0.45))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(13.5).text_color(t.foreground).child(title))
        .child(div().text_size(12).text_color(t.muted).child(detail)))
      .child(control);
  }

  sections(t) {
    const f = foldSettings();
    const set = (change) => setShared("fold.anim", { ...f, ...change });
    return v_flex()
      .child(this.heading(t, "Folding", "How a repo's branches and a branch's tabs open and shut in Workspaces. Click a repo or a branch to try it."))
      .child(this.setting(t, "Animation", "Slide them open and shut, or snap them at once.",
        this.segmented(t, "fa-on", [{ id: "on", name: "On" }, { id: "off", name: "Off" }], f.on ? "on" : "off", (v) => set({ on: v === "on" }))))
      .child(this.setting(t, "Speed", `How long a fold takes: ${SPEEDS.map((s) => `${s.name.toLowerCase()} ${s.ms} ms`).join(", ")}.`,
        this.segmented(t, "fa-speed", SPEEDS, f.speed, (v) => set({ speed: v })), !f.on))
      .child(this.setting(t, "Easing", "How it moves: slowing into place, speeding up and slowing down, overshooting a touch, or evenly.",
        this.segmented(t, "fa-ease", EASINGS, f.easing, (v) => set({ easing: v })), !f.on));
  }

  badge(t) {
    const mode = countMode();
    const pill = h_flex().flex_none().h(16).min_w(16).px(5).rounded_full().items_center().justify_center()
      .bg(mode === "grey" ? t.input : t.foreground)
      .text_size(10.5).font_semibold().text_color(mode === "grey" ? t.muted : t.background).child("3");
    return v_flex().gap(18)
      .child(this.heading(t, "Badge", "A folded repo or branch shows, by its name, how many rows it hides: its branches, or its tabs. Only its own rows count, not theirs."))
      .child(v_flex()
        .child(this.setting(t, "Count", "Default is white; grey stays in the background.",
          this.segmented(t, "fold-count", COUNT_MODES, mode, (v) => setShared("fold.count", v))))
        .when(mode !== "off", (el) => el.child(h_flex().mt(14).w(320).h(34).px(10).gap(9).items_center().rounded(8).border(1).border_color(t.border).bg(t.background).text_size(12.5)
          .child(svg("mods/workspace-chrome/git-branch.svg").size(13).text_color(t.dim))
          .child(div().min_w(0).truncate().text_color(t.muted).child("fix-login-redirect"))
          .child(pill))));
  }

  // Workspaces' pages, under tabs across the top as a browser draws them: the chosen
  // one lifts into the page below, thin lines part the others.
  workspaces(t) {
    const at = WORKSPACE_TABS.findIndex((s) => s.id === this.workspaceTab);
    const tabs = [];
    WORKSPACE_TABS.forEach((s, i) => {
      const on = i === at;
      if (i > 0) tabs.push(div().flex_none().w(1).h(16).mb(9).bg(on || i - 1 === at ? "#00000000" : t.border));
      tabs.push(h_flex().id(`cs-ws-${s.id}`).flex_none().h(36).px(12).gap(8).items_center().rounded_t(9).cursor_pointer()
        .bg(on ? t.popover : "#00000000")
        .when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((_e, cx) => { this.workspaceTab = s.id; cx.notify(); })
        .child(svg(s.icon).size(14).flex_none().text_color(on ? t.accent : t.dim))
        .child(div().text_size(13).text_color(on ? t.foreground : t.muted).child(s.title)));
    });
    const strip = h_flex().flex_none().h(44).pt(8).pl(10).pr(56).items_end().bg(t.background).children(tabs);
    return v_flex().child(strip).child(div().px(28).py(22).child(this[this.workspaceTab](t)));
  }

  plain(t) {
    return v_flex().gap(18)
      .child(this.heading(t, "Plain spaces", "The name and icon of a space opened on a folder that is not in a git repo: in Workspaces."))
      .child(this.setting(t, "Name", "Shown on the row in place of the space's own name. Leave it empty to keep that name.",
        h_flex().w(220).h(28).px(8).flex_none().items_center().rounded(6).border(1).border_color(t.border).bg(t.background)
          .child(Input.new(this.plainName).flex_1().text_size(12.5).text_color(t.foreground))))
      .child(this.cards(t, PLAIN_ICONS, "plain.icon", "folder", (c) => svg(c.icon).size(44).text_color(t.muted)));
  }

  render() {
    this.radarShown = false;
    stampFrame(this);
    kameFrame(this);
    const t = theme();
    const nav = v_flex().flex_none().w(190).h_full().p(10).gap(2).border_r(1).border_color(t.border)
      .child(div().px(10).pt(6).pb(12).text_size(16).font_semibold().text_color(t.foreground).child("Custom settings"))
      .children(TABS.map((s) => {
        const on = s.id === this.tab;
        return h_flex().id(`cs-tab-${s.id}`).gap(10).px(10).py(7).items_center().rounded(7).cursor_pointer()
          .bg(on ? t.raised : "#00000000").hover((st) => st.bg(t.raised))
          .on_click((_e, cx) => { this.tab = s.id; cx.notify(); })
          .child(svg(s.icon).size(15).text_color(on ? t.accent : t.dim))
          .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child(s.title));
      }));
    return h_flex().id("custom-settings").size_full().items_start().bg(t.popover)
      .child(nav)
      .child(v_flex().relative().flex_1().min_w(0).h_full()
        .child(div().id("cs-body").size_full().overflow_y_scroll()
          .child(this.tab === "workspaces" ? this.workspaces(t) : div().px(28).py(22).child(this[this.tab](t))))
        .child(div().id("cs-esc").absolute().top(14).right(16).px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay)).child("Esc")));
  }
}
