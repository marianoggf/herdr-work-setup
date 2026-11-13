import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { loader, workingLoader, kameShot, kameTitle, kameFrame, programIcon } from "./loader.js";
import { doneDot, radarTicker } from "./radar.js";
import { spaces, panes, focused, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, notify } from "herdr";
import { syncNames } from "./names.js";
import { deleteWorktree, undoDelete, resumeDeletes } from "./worktree.js";

// The empty tab a space keeps once its last tab closes: mods/blank-tab, a menu to start a new one.
const BLANK = "blank-tab";
function isBlank(tabId, ps = panes()) {
  const mine = ps.filter((p) => p.tab === tabId);
  return mine.length > 0 && mine.every((p) => p.mod === BLANK);
}

// A space never closes with its last tab or pane (Herdr would close it): the empty tab opens first,
// remembering the folder the closed tab was in.
function keepSpace(tabId) {
  const space = spaces().find((s) => s.tabs.some((x) => x.id === tabId));
  if (space?.tabs.length !== 1) return;
  const folder = panes().find((p) => p.tab === tabId && p.cwd)?.cwd || space.folder;
  run("tab.new", { space: space.id, mod: BLANK, props: { space: space.id, folder } });
}

function closeTabNow(id) {
  keepSpace(id);
  run("tab.close", { id, confirmed: true });
}

// "my-tabs.pane-close" (cmd-shift-w) closes the focused pane, "my-tabs.pane-close:<pane id>" that pane.
export function closePane(id) {
  const pane = id ?? focused()?.pane;
  const p = panes().find((x) => x.pane === pane);
  if (!p || p.mod === BLANK) return;
  const tab = p.tab;
  if (panes().filter((p) => p.tab === tab).length === 1) keepSpace(tab);
  run("pane.close", { pane });
}

// A tab with an agent closes with an undo instead of a confirm. It is put away
// at once (tab.settle: still running, and listed in shared "tabs.closing" so
// the tab bar and the sidebar hide it) and ends UNDO ms later, unless the
// snackbar's Undo ("my-tabs.undo-close:<tab id>", drawn by mods/my-toast)
// brings it back.
const UNDO = 7500;
export const closing = () => shared("tabs.closing") ?? {}; // tab id -> { name, space, until }
function setClosing(id, entry) {
  const next = { ...closing() };
  if (entry) next[id] = entry; else delete next[id];
  setShared("tabs.closing", next);
}
// The pending closes' timers, kept on globalThis so a reload of this file can still cancel them.
const timers = () => (globalThis.myTabsUndoTimers ??= new Map());

function schedule(id, ms, cx) {
  timers().get(id)?.cancel();
  timers().set(id, cx.timer.after(Math.max(0, ms), () => finishClose(id), { owner: null }));
}

function closeLater(tab, cx) {
  const space = spaces().find((s) => s.tabs.some((x) => x.id === tab.id));
  const gone = closing();
  // Its space keeps showing something: the empty tab, when this was the last tab left.
  if (space && !space.tabs.some((x) => x.id !== tab.id && !gone[x.id])) {
    const folder = panes().find((p) => p.tab === tab.id && p.cwd)?.cwd || space.folder;
    run("tab.new", { space: space.id, mod: BLANK, props: { space: space.id, folder } });
  }
  setClosing(tab.id, { name: tab.name, space: space?.id ?? null, until: Date.now() + UNDO });
  run("tab.settle", { id: tab.id });
  schedule(tab.id, UNDO, cx);
  notify({ title: `Closed "${tab.name}"`, timeout: UNDO, action: { name: `my-tabs.undo-close:${tab.id}` } });
}

function finishClose(id) {
  timers().delete(id);
  if (!closing()[id]) return;
  setClosing(id, null);
  if (spaces().some((s) => s.tabs.some((x) => x.id === id))) closeTabNow(id);
}

function undoClose(id) {
  timers().get(id)?.cancel();
  timers().delete(id);
  const entry = closing()[id];
  if (!entry) return;
  setClosing(id, null);
  run("tab.unsettle", { id });
  if (entry.space) run("space.select", { id: entry.space });
  run("tab.select", { id });
}

// Closing a tab ends its terminals: when one runs an agent, even an idle one, it waits for an undo.
// "my-tabs.close" (cmd-w in keys.json) closes the active tab, "my-tabs.close:<tab id>" that tab.
// The empty tab stays: it is what an emptied space shows.
export function closeTab(id, cx) {
  const tab = id ? spaces().flatMap((s) => s.tabs).find((x) => x.id === id) : spaces().find((s) => s.active)?.tabs.find((x) => x.active);
  if (!tab || isBlank(tab.id) || closing()[tab.id]) return;
  const agents = panes().filter((p) => p.tab === tab.id && p.program?.agent);
  if (!agents.length) return closeTabNow(tab.id);
  closeLater(tab, cx);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    radarTicker(this, cx);
    // Tabs name themselves with tab.rename; see names.js.
    // Tidying runs here too: a hidden window doesn't render, and scripts open tabs then as well.
    cx.timer.every(3000, () => { syncNames(); this.tidyBlanks(panes()); });
    this.pressed = null;
    this.tidied = new Set();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Closes still pending from before a restart or reload: finish them when due, else wait on.
    for (const [id, entry] of Object.entries(closing())) if (!timers().has(id)) schedule(id, entry.until - Date.now(), cx);
    resumeDeletes(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const m = /^(close|close-now|pane-close|undo-close|delete-worktree|undo-delete)(?::(.+))?$/.exec(c);
        if (m?.[1] === "close") closeTab(m[2], cx);
        else if (m?.[1] === "close-now" && m[2]) closeTabNow(m[2]);
        else if (m?.[1] === "pane-close") closePane(m[2]);
        else if (m?.[1] === "undo-close" && m[2]) undoClose(m[2]);
        else if (m?.[1] === "delete-worktree" && m[2]) deleteWorktree(m[2], cx);
        else if (m?.[1] === "undo-delete" && m[2]) undoDelete(m[2]);
      }
    });
  }

  // Once a space has something else (a tab from + or cmd-t, a split beside it), its empty tab or
  // pane has done its job: close it. Each one once, since panes() can lag a render behind.
  tidyBlanks(ps) {
    const close = (key, command, args) => {
      if (this.tidied.has(key)) return;
      this.tidied.add(key);
      run(command, args);
    };
    const gone = closing(); // tabs waiting out their undo don't count as something else
    for (const s of spaces()) {
      const live = s.tabs.filter((x) => !gone[x.id]);
      const blanks = live.filter((x) => isBlank(x.id, ps));
      for (const x of blanks.slice(blanks.length === live.length ? 1 : 0)) close(x.id, "tab.close", { id: x.id, confirmed: true });
    }
    for (const p of ps) if (p.mod === BLANK && ps.some((o) => o.tab === p.tab && o.mod !== BLANK)) close(p.pane, "pane.close", { pane: p.pane });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    this.radarShown = false;
    kameFrame(this);
    const t = theme();
    const space = spaces().find(p => p.active);
    const ps = panes();
    this.tidyBlanks(ps);
    // The empty tab is not a tab to show: its space reads as having none.
    const gone = closing();
    // When each tab's agent went from working to done, for the Kamehameha shot.
    this.lastStatus ??= {};
    this.finishedAt ??= {};
    for (const tab of space?.tabs ?? []) {
      if (this.lastStatus[tab.id] === "working" && tab.status === "done") this.finishedAt[tab.id] = Date.now();
      this.lastStatus[tab.id] = tab.status;
    }
    const shown = (space?.tabs ?? []).filter((x) => !isBlank(x.id, ps) && !gone[x.id]);
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      // Kamehameha: the shot across the title (7 px gap + its width), which blows its letters away.
      const shot = c.status === "done" ? kameShot(this, t, c.id, this.finishedAt?.[c.id], 7 + (this.titleW?.[c.id] ?? 0), 20) : null;
      const title = c.zoomed ? `${name} Z` : name;
      const blast = kameTitle(this, c.id, title, 170, 6.9);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "my-menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(programIcon(program, 14, t.muted, c.status === "working", c.id)))
        .child(blast
          ? div().id(`title-${c.id}`).max_w(170).child(blast) // the letters fly out of its box: no clipping
          : div().id(`title-${c.id}`).max_w(170).truncate()
            .on_size_change(({ width }) => { (this.titleW ??= {})[c.id] = width; })
            .child(title))
        .when(c.status === "working", el => el.child(workingLoader(this, t, c.id, 20)))
        .when(c.status === "blocked", el => el.child(div().size(6).rounded(3).bg(t.blocked)))
        .when(c.status === "done", el => el.child(shot ?? doneDot(this, t, c.id, 18)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id, cx); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "prs", "automations"];
    this.syncPanel(space, panel, body, enabled);
    // A clean bar: the panel buttons show while their zone is hovered (the open panel's always does),
    // sliding in from the right and fading up, the rightmost first. Hidden, they keep their
    // place, so + doesn't move, and they don't take clicks.
    const panels = [enabled.includes("files") && "files", enabled.includes("changes") && "changes", "prs", "automations"].filter(Boolean);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      const visible = Boolean(this.barHovered) || on;
      const fromRight = panels.length - 1 - panels.indexOf(id);
      const move = { duration: 260, easing: "ease-out", delay: visible ? fromRight * 40 : 0 };
      return h_flex().id(`panel-${id}`).relative().left(visible ? 0 : 16).opacity(visible ? 1 : 0)
        .transition("left", move).transition("opacity", move)
        .h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(visible, el => el.hover(s => s.bg(t.hover)).on_mouse_down("left", stop))
        .when(visible, el => el.on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else {
            // The PRs button shows every PR; the GitHub sidebar's group buttons show one group.
            if (id === "prs") setShared("prs.filter", null);
            run("layout.select", { stack: "panel-body", child: id });
            run("layout.show", { id: "panel" });
          }
        })).child(svg(icon).size(14)).child(label);
    };
    return h_flex().id("tab-bar").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // + right after the last tab, as Chrome has it (with many tabs it scrolls with them).
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item))
        .child(button("tab-new", "+", () => openOverlay({ mod: "my-new-menu", kind: "popup", width: 250, height: 180 }))))
      // They show while the pointer is over where they sit (from the leftmost one to the bar's
      // right end, the bar's full height), not anywhere on the bar.
      .child(h_flex().id("panel-zone").h_full().flex_none().gap(3).items_center()
        .on_hover((h, cx) => { if (Boolean(this.barHovered) !== h) { this.barHovered = h; cx.notify(); } })
        .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
        .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
        .child(panelButton("prs", "PRs", "mods/prs/git-pull-request.svg"))
        .child(panelButton("automations", "Automations", "mods/automate-everything/automations.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/my-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/my-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
