// What a space shows once its last tab closes: my-tabs opens this instead of letting the space close
// (Herdr closes a space with its last tab), and hides it from the tab bar. The menu in the middle
// starts a terminal or an agent in the folder the closed tab was in; the new tab replaces this one.
// props: { space, folder }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, props, window, keys, shared, setShared, nextCommand } from "herdr";

const BLANK = "blank-tab";
const KNOWN = "new-menu.agents"; // new-menu's list of each machine's agents, shown while knownAgents() checks again

// A tab whose only panes are this mod.
function isBlank(tabId, ps = panes()) {
  const mine = ps.filter((p) => p.tab === tabId);
  return mine.length > 0 && mine.every((p) => p.mod === BLANK);
}

function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  if (!k?.keys.trim() || window()?.platform !== "macos") return "";
  const names = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
  const [, mods, key] = /^(.*-)?(.+)$/.exec(k.keys.trim().split(/\s+/)[0]);
  const held = (mods ?? "").split("-").map((m) => (m === "secondary" ? "cmd" : m));
  return Object.keys(names).filter((m) => held.includes(m)).map((m) => names[m]).join("") + key.toUpperCase();
}

const short = (folder) => (folder ?? "").replace(/^\/(?:Users|home)\/[^/]+/, "~");

export default class BlankTab extends View {
  init(_props, cx) {
    const where = this.space()?.machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: this.space()?.machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      } catch { this.failed = true; }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  space() {
    const sp = spaces();
    return sp.find((s) => s.id === props()?.space) ?? sp.find((s) => s.active);
  }

  // Opens the new tab first, so closing this one never leaves the space without tabs.
  start(agent) {
    const space = this.space();
    if (!space) return;
    const ps = panes();
    const me = space.tabs.find((x) => x.active && isBlank(x.id, ps)) ?? space.tabs.find((x) => isBlank(x.id, ps));
    const folder = props()?.folder || space.folder;
    run("tab.new", { space: space.id, ...(folder ? { folder } : {}), ...(agent ? { name: agent.name, argv: agent.run } : {}) });
    if (me) run("tab.close", { id: me.id, confirmed: true });
  }

  row(t, id, icon, name, hint, action, enabled = true) {
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => { if (enabled) action(); })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }

  render() {
    const t = theme();
    const installed = this.agents.filter((a) => a.installed);
    const folder = short(props()?.folder || this.space()?.folder);
    return v_flex().id("blank-tab").size_full().items_center().justify_center().bg(t.background).text_size(12.8)
      .track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (agent) this.start(agent);
      })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("No tabs open"))
      .when(Boolean(folder), (el) => el.child(div().max_w(420).mt(4).truncate().text_size(12).text_color(t.dim).child(folder)))
      .child(v_flex().w(300).mt(16).p(5).rounded(10).border(1).border_color(t.border).bg(t.chrome)
        .child(this.row(t, "blank-terminal", svg("icons/shell.svg").size(14), "Terminal", shortcut("tab.new"), () => this.start(null)))
        .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
        .children(installed.map((a, i) => this.row(t, `blank-${a.key}`,
          a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name, i < 9 ? String(i + 1) : "", () => this.start(a))))
        .when(installed.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim)
          .child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))));
  }
}
