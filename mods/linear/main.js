// Linear: the issues assigned to me that aren't done (completed, canceled or
// duplicate), grouped by their workflow state, as a sidebar list. The API key is
// the macOS Keychain item `herdr-linear-api-key`. Asked every two minutes while
// the window is in front, and on the refresh button. Click an issue to open it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { loader } from "./loader.js";
import { exec, run, theme, window, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Folded, the layout block is just the title bar. Open, it fits its list (up to 40% of the
// window) and Workspaces takes the rest. Herdr keeps the block size across restarts.
const BLOCK = "linear", TITLE = 41, PAD = 10;
const blockPx = () => find(layout(), BLOCK)?.size?.px;
const folded = () => blockPx() === TITLE;
const toggleFold = () => run("layout.resize", folded() ? { id: BLOCK, weight: 1 } : { id: BLOCK, px: TITLE });
function fit(content) {
  const px = Math.round(Math.min(TITLE + content + PAD, (globalThis.window?.viewport_size?.()?.height ?? Infinity) * 0.4));
  if (Math.abs((blockPx() ?? 0) - px) > 1) run("layout.resize", { id: BLOCK, px });
}

// Refreshed every 5 minutes while open; folded, nothing is asked until it opens again.
const EVERY = 300000;
const DONE = ["completed", "canceled", "duplicate"];
const QUERY = `query { viewer { assignedIssues(first: 50, filter: { state: { type: { nin: ${JSON.stringify(DONE)} } } }) { nodes {
  identifier title url priority updatedAt
  state { name type color position }
  project { name }
  attachments(first: 5) { nodes { url } }
  relations(first: 10) { nodes { type relatedIssue { state { type } } } }
  inverseRelations(first: 10) { nodes { type issue { state { type } } } }
} } } }`;

// Groups go by how far along their state is: in progress first, then todo, backlog, triage.
const TYPE_ORDER = { started: 0, unstarted: 1, backlog: 2, triage: 3 };
const live = (s) => s && !DONE.includes(s.type);

function groups(nodes) {
  const by = new Map();
  for (const n of nodes) {
    const k = n.state.name;
    if (!by.has(k)) by.set(k, { state: n.state, issues: [] });
    by.get(k).issues.push(n);
  }
  return [...by.values()].sort((a, b) =>
    (TYPE_ORDER[a.state.type] ?? 9) - (TYPE_ORDER[b.state.type] ?? 9) || b.state.position - a.state.position);
}

function ago(iso) {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class Linear extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.loading = false;
    this.asked = 0;
    this.open = JSON.parse(localStorage.getItem("open") ?? "{}");
    if (!folded()) this.refresh(cx);
    cx.timer.every(15000, (cx) => {
      if (window().active && !folded() && Date.now() - this.asked > EVERY) this.refresh(cx);
    });
    cx.timer.every(60000, (cx) => cx.notify());
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.asked = Date.now();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const k = await exec("security", ["find-generic-password", "-s", "herdr-linear-api-key", "-w"]);
        const key = k.stdout.trim();
        if (k.code !== 0 || !key) throw new Error("No Linear API key in the Keychain (herdr-linear-api-key)");
        const r = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: { Authorization: key, "Content-Type": "application/json" },
          body: JSON.stringify({ query: QUERY }),
        });
        const d = await r.json();
        if (!r.ok || d.errors) throw new Error(d.errors?.[0]?.message ?? `Linear answered ${r.status}`);
        this.data = groups(d.data.viewer.assignedIssues.nodes);
        this.error = null;
      } catch (e) {
        this.error = String(e.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  isOpen(id) {
    return this.open[id] ?? true;
  }

  header(g, t) {
    const id = g.state.name;
    const open = this.isOpen(id);
    return h_flex().id(`ln-sec-${id}`).h(32).mt(4).px(8).flex_none().gap(8).items_center().rounded(6).text_size(12.5).text_color(t.muted)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => {
        this.open[id] = !open;
        localStorage.setItem("open", JSON.stringify(this.open));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().size(9).flex_none().rounded(5).border(2).border_color(g.state.color))
      .child(div().flex_1().min_w(0).truncate().child(g.state.name))
      .child(div().flex_none().px(6).h(18).rounded(9).bg(t.raised).text_size(11).flex().items_center().child(String(g.issues.length)));
  }

  row(n, t) {
    const pr = n.attachments.nodes.map((a) => a.url.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)).find(Boolean);
    // Blocks: active issues this one holds up. Blocked by: active issues holding it up.
    const blocks = n.relations.nodes.filter((r) => r.type === "blocks" && live(r.relatedIssue?.state)).length;
    const blockedBy = n.inverseRelations.nodes.filter((r) => r.type === "blocks" && live(r.issue?.state)).length;
    const meta = [n.identifier, n.project?.name].filter(Boolean).join(" · ");
    return v_flex().id(`ln-${n.identifier}`).px(8).py(8).my(1).flex_none().gap(5).rounded(8)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click(() => exec("open", [n.url]))
      .child(h_flex().gap(8).items_center()
        .child(div().size(10).flex_none().rounded(5).border(2).border_color(n.state.color))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(n.title)))
      .child(h_flex().pl(18).gap(10).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(meta))
        .when(Boolean(pr), (el) => el.child(h_flex().flex_none().gap(3).items_center()
          .child(svg("mods/workspaces/pr-open.svg").size(11).text_color("#3fae6a"))
          .child(`#${pr[1]}`)))
        .when(blockedBy > 0, (el) => el.child(h_flex().id(`ln-bb-${n.identifier}`).flex_none().gap(3).items_center().text_color(t.blocked)
          .tooltip(`Blocked by ${blockedBy}`)
          .child(svg("mods/linear/blocked.svg").size(11)).child(String(blockedBy))))
        .when(blocks > 0, (el) => el.child(h_flex().id(`ln-bl-${n.identifier}`).flex_none().gap(3).items_center().text_color("#e5734b")
          .tooltip(`Blocks ${blocks}`)
          .child(svg("mods/linear/blocks.svg").size(11)).child(String(blocks))))
        .child(div().flex_none().child(ago(n.updatedAt))));
  }

  rail(t) {
    const n = this.data ? this.data.reduce((s, g) => s + g.issues.length, 0) : 0;
    return v_flex().size_full().bg(t.chrome).items_center().pt(10).gap(4)
      .child(svg("mods/linear/linear.svg").size(14).text_color(t.dim))
      .when(n > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(n))));
  }

  render() {
    const t = theme();
    if (narrow()) return this.rail(t);
    const body = this.error
      ? [div().px(8).text_size(12).text_color(t.blocked).child(this.error)]
      : !this.data
        ? [div().px(8).text_size(12).text_color(t.dim).child("Loading…")]
        : !this.data.length
          ? [div().px(8).text_size(12).text_color(t.dim).child("Nothing assigned to you.")]
          : this.data.flatMap((g) => [this.header(g, t), ...(this.isOpen(g.state.name) ? g.issues.map((n) => this.row(n, t)) : [])]);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(41).px(16).flex_none().items_center().justify_between()
        .child(h_flex().id("ln-fold").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
          .text_size(11.5).font_medium().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            // Folding the section folds its groups too, so it opens again compact.
            if (!folded()) {
              for (const g of this.data ?? []) this.open[g.state.name] = false;
              localStorage.setItem("open", JSON.stringify(this.open));
              cx.notify();
            } else this.refresh(cx);
            toggleFold();
          })
          .child(svg(`mods/workspace-chrome/chevron-${folded() ? "right" : "down"}.svg`).size(10).flex_none())
          .child("Linear"))
        .when(!folded(), (el) => el.child(div().id("ln-refresh").flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(this.loading ? "Refreshing…" : "Refresh")
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading
            ? loader(theme(), 20)
            : svg("mods/github/refresh.svg").size(13)))))
      .when(!folded(), (el) => el.child(v_flex().id("ln-list").flex_1().min_h(0).px(8).pb(10).overflow_y_scrollbar().mode("always")
        .child(v_flex().id("ln-content").flex_none().on_size_change((s) => fit(s.height)).children(body))));
  }
}
