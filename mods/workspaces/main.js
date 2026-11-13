// Workspaces (a copy of Herdr's spaces mod; its + opens mods/new-workspace): stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agents too (taken from Herdr's agents mod):
// each row shows its most urgent agent state, and every tab gets a row under it, even a space's only one,
// sub-agents under their parent. Click a row to go to its agent (or the space), right-click for its menu, drag to reorder.

import { View, div, image, svg } from "gpui-kit";
import { loader, workingLoader, kameShot, kameTitle, kameFrame, programIcon } from "./loader.js";
import { doneDot, seenDot, radarTicker, stampFrame, stampOn, doneStamp } from "./radar.js";
import { motion } from "./fold.js";
import { shimmerOn, shimmerText } from "./shimmer.js";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, setAgentOrder, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, appHome, readTextFile, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
// The count on a folded row (Custom settings > Workspaces > Badge): "off", "default" (white) or "grey".
const countMode = () => shared("fold.count") ?? "default";
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Folded, the layout block shrinks to the title bar; the layout file keeps it across restarts.
const BLOCK = "spaces", TITLE = 31;
const folded = () => find(layout(), BLOCK)?.size?.px === TITLE;
const toggleFold = () => run("layout.resize", folded() ? { id: BLOCK, weight: 1 } : { id: BLOCK, px: TITLE });

// "workspaces.fold-all" (option+command+P in keys.json): every sidebar section folds to its title bar, and
// the PRs panel folds its sections on the same signal. With all of them folded, it opens again the ones
// that were open. Each block's folded height is the one its own mod folds it to.
const SECTION_BLOCKS = { spaces: TITLE, github: 41, linear: 41, machines: 41, usage: 41 };
function foldAll() {
  const ids = Object.keys(SECTION_BLOCKS).filter((id) => find(layout(), id));
  const open = ids.filter((id) => find(layout(), id).size?.px !== SECTION_BLOCKS[id]);
  const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
  const prsOpen = Boolean(panel && !panel.hidden && body?.active === "prs" && shared("prs.open"));
  const fold = open.length > 0 || prsOpen;
  if (fold) {
    if (open.length) setShared("sections.reopen", open);
    for (const id of open) run("layout.resize", { id, px: SECTION_BLOCKS[id] });
  } else {
    for (const id of shared("sections.reopen") ?? ids) if (ids.includes(id)) run("layout.resize", { id, weight: 1 });
    setShared("sections.reopen", null);
  }
  setShared("sections.fold", { folded: fold, at: Date.now() });
}

// Whether a layout still shows Herdr's agents list (then it, not this, sets agent.next's order).
const shows = (node, mod) => node?.content?.mod === mod || (node?.children ?? []).some((c) => shows(c, mod));

// Agents, as Herdr's agents mod shows them.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
function lead(tab, all) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}
function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const FULL = 80; // % of the context window from which the sidebar warns
// A branch without its owner's prefix: marianoggf/min is min.
const bare = (branch) => branch.replace(/^[^/]+\//, "");
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as blocked, never done.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = (tree) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// A worktree's PR, by repo and branch, and how often gh is asked again.
const prKey = (g) => `${g.repo}#${g.branch}`;
const PR_EVERY = 120000;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// The icon a worktree row shows, and its color, for each PR state.
const PLAIN_ICON = {
  folder: { icon: "mods/workspace-chrome/folder.svg", size: 15 },
  joker: { icon: "mods/workspaces/joker.svg", size: 18 },
};

const PR_LOOK = {
  none: { icon: "mods/workspace-chrome/branch.svg", color: (t) => t.dim, label: "No PR yet" },
  DRAFT: { icon: "mods/workspaces/pr-draft.svg", color: (t) => t.muted, label: "Draft" },
  OPEN: { icon: "mods/workspaces/pr-open.svg", color: () => "#3fae6a", label: "Ready for review" },
  MERGED: { icon: "mods/workspaces/pr-merged.svg", color: () => "#8b7cf6", label: "Merged" },
  CLOSED: { icon: "mods/workspaces/pr-closed.svg", color: () => "#e5534b", label: "Closed" },
};

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// An avatar's letter: the name's first. When most repos start with the same word (the
// untracked ~/.config/herdr-app/local.json: { "repoPrefix": "acme" }), that word is
// skipped and the last word gives the letter: acme-api -> A, acme-web-client -> C.
let repoPrefix = null; // null until local.json has been asked for
function initial(name) {
  if (repoPrefix === null) {
    repoPrefix = "";
    readTextFile(`${appHome()}/local.json`).then((text) => { repoPrefix = String(JSON.parse(text || "{}").repoPrefix ?? "").toLowerCase(); }).catch(() => {});
  }
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  const pick = words.length > 1 && repoPrefix && words[0].toLowerCase() === repoPrefix ? words[words.length - 1] : name;
  return [...pick][0]?.toUpperCase() ?? "?";
}

// A repo header's avatar color, stored per repo in shared "repo.colors" so a
// repo keeps its color and no two repos share one. A new repo takes the color
// its name hashes to when that one is free, else the first free one in MARK;
// once all six are taken it gets a new hue, as far as possible from every hue
// already in use.
const nameSlot = (name) => [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 0) % 6;
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function hexOf(h, s = 0.6, l = 0.52) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function freshColor(used) {
  const hues = used.map(hueOf);
  const gap = (h) => Math.min(...hues.map((u) => Math.min(Math.abs(h - u), 360 - Math.abs(h - u))));
  let best = 0;
  for (let h = 0; h < 360; h += 5) if (gap(h) > gap(best)) best = h;
  return hexOf(best);
}
function repoFill(repo, name) {
  const colors = shared("repo.colors") ?? {};
  if (colors[repo]) return colors[repo];
  const used = Object.values(colors), mark = Object.values(MARK);
  const pick = [mark[nameSlot(name)], ...mark].find((c) => !used.includes(c)) ?? freshColor(used);
  setShared("repo.colors", { ...colors, [repo]: pick });
  return pick;
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    radarTicker(this, cx);
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    // Spaces whose tab rows are hidden, and repos whose worktrees are hidden under their header.
    this.closed = new Set(JSON.parse(localStorage.getItem("spaces.closed") ?? "[]"));
    this.closedRepos = new Set(JSON.parse(localStorage.getItem("repos.closed") ?? "[]"));
    // Repos that had a header, in sidebar order: the header stays after their last worktree closes.
    this.keptRepos = JSON.parse(localStorage.getItem("repos.kept") ?? "[]"); // [{ repo, name, machine }]
    this.removingRepos = new Set(); // repos whose spaces "Remove project" is closing
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // Each worktree's PR (draft, open, merged, closed), asked of gh now and then.
    this.pr = {}; // prKey -> { state, number, url } or null: no PR
    this.prAsked = {}; // prKey -> when gh was last asked
    cx.timer.every(5000, (cx) => this.refreshPRs(cx));
    this.subs = {}; // agent address -> its Claude Code sub-agents still running (subagents.py)
    this.subAsked = {}; // agent address -> when they were last read
    this.subBusy = new Set(); // agent addresses being read now
    this.pids = {}; // agent address -> { id, at }: the Claude process in front of its terminal
    this.full = {}; // agent address -> % of its context window in use, from my-pane's context.py
    this.agentOf = new Map();
    this.subsClosed = new Set(JSON.parse(localStorage.getItem("subagents.closed") ?? "[]")); // agents whose sub-agents are folded
    cx.timer.every(1500, (cx) => this.refreshSubs(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "fold-all") foldAll();
        const forget = /^forget-repo:(.+)$/.exec(c);
        if (forget) this.keepRepos(this.keptRepos.filter((k) => k.repo !== decodeURIComponent(forget[1])));
        const remove = /^remove-repo:(.+)$/.exec(c);
        if (remove) this.removeRepo(decodeURIComponent(remove[1]));
        cx.notify();
      }
    });
    // Each agent's last state and when it changed (ms), kept across restarts; the times shown move each half minute.
    this.changed = JSON.parse(localStorage.getItem("agents.changed") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    // An agent seen going from working to done gets its DONE stamp (doneStamp), once.
    this.lastStatus ??= {};
    this.finishedAt ??= {};
    for (const a of list) {
      if (this.lastStatus[a.address] === "working" && a.status === "done") this.finishedAt[a.address] = Date.now();
      this.lastStatus[a.address] = a.status;
    }
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("agents.changed", JSON.stringify(this.changed));
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(addr, lead = []) {
    const kids = [...this.all.filter((k) => k.parent === addr && k.state === "live"), ...this.claudeKids(addr)];
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...this.tree(k.address, [...lead, last ? "" : "│"])];
    });
  }

  // Claude Code's own sub-agents (its Agent tool) under an "N sub-agents" line that folds them away, under
  // the agent that started them, or under the sub-agent that did; one whose parent is no longer running
  // moves up. Addressed ccgroup:<agent> (the line) and cc:<agent>:<id>.
  claudeKids(addr) {
    if (!addr.startsWith("cc")) {
      const count = this.subs[addr]?.length;
      return count ? [{ address: `ccgroup:${addr}`, group: true, owner: addr, name: plural(count, "sub-agent"), status: "working", state: "live" }] : [];
    }
    const top = addr.startsWith("ccgroup:");
    const [owner, id] = top ? [addr.slice(8), null] : addr.slice(3).split(":");
    if (top && this.subsClosed.has(owner)) return [];
    const subs = this.subs[owner] ?? [];
    const a = this.agentOf.get(owner);
    const ids = new Set(subs.map((s) => s.id));
    return subs.filter((s) => (id ? s.parent === id : !s.parent || !ids.has(s.parent)))
      .map((s) => ({ address: `cc:${owner}:${s.id}`, claude: true, pane: a?.pane, program: a?.program, name: s.label, activity: s.activity, started: s.started, status: "working", state: "live" }));
  }

  // Each local Claude agent's running sub-agents: read often while it works or has some, else each half minute.
  refreshSubs(cx) {
    const now = Date.now();
    const local = new Set(spaces().filter((s) => !s.machine).map((s) => s.id));
    const live = new Set();
    for (const a of agents()) {
      if ((a.app !== "claude-code" && a.program?.key !== "claude") || !local.has(a.space)) continue;
      live.add(a.address);
      const busy = a.status === "working" || this.subs[a.address]?.length;
      if (this.subBusy.has(a.address) || now - (this.subAsked[a.address] ?? 0) < (busy ? 3000 : 30000)) continue;
      this.subAsked[a.address] = now;
      this.subBusy.add(a.address);
      cx.spawn(async (cx) => {
        try {
          let pid = this.pids[a.address];
          if (!pid || now - pid.at > 60000) {
            const got = await hc(["get", a.address, "--json"]);
            pid = this.pids[a.address] = { id: JSON.parse(got.stdout || "{}").foreground?.pid, at: now };
          }
          if (!pid.id) return;
          const c = await exec("python3", ["-I", `${appHome()}/mods/my-pane/context.py`, String(pid.id)]);
          const ctx = c.code === 0 ? JSON.parse(c.stdout || "null") : null;
          const full = ctx ? Math.round((100 * ctx.tokens) / ctx.window) : undefined;
          if (full !== this.full[a.address]) { this.full[a.address] = full; cx.notify(); }
          const r = await exec("python3", ["-I", `${appHome()}/mods/workspaces/subagents.py`, String(pid.id)]);
          if (r.code !== 0) return;
          const subs = JSON.parse(r.stdout || "[]");
          if (JSON.stringify(subs) !== JSON.stringify(this.subs[a.address] ?? [])) {
            this.subs[a.address] = subs;
            cx.notify();
          }
        } catch {} finally {
          this.subBusy.delete(a.address);
        }
      });
    }
    for (const k of Object.keys(this.subs)) if (!live.has(k)) delete this.subs[k];
    for (const k of Object.keys(this.full)) if (!live.has(k)) delete this.full[k];
    // A terminal's address comes back for another agent later: it starts unfolded.
    const kept = [...this.subsClosed].filter((k) => live.has(k));
    if (live.size && kept.length !== this.subsClosed.size) {
      this.subsClosed = new Set(kept);
      localStorage.setItem("subagents.closed", JSON.stringify(kept));
    }
  }

  // The most urgent state among a space's agents and their sub-agents, or null.
  urgent(mine) {
    const sts = mine.flatMap((a) => [a.status, ...this.tree(a.address).map((s) => kidStatus(s.t, this.listed))]);
    return sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
  }

  // The most urgent state among the agents of every space on `repo` (its main checkout and worktrees).
  // `skip`: a space whose tabs are in view, so its own rows already say it.
  repoUrgent(repo, skip = null) {
    const ps = panes();
    return this.urgent(spaces().filter((w) => w.id !== skip && this.git[where(w, ps)]?.repo === repo).flatMap((w) => this.mine[w.id] ?? []));
  }

  // A clean list: some details (a tab's time, a repo's buttons, a branch name) show
  // only while the pointer is on their row. `hovered` is that row's id.
  hoverable(el, id) {
    return el.on_hover((h, cx) => {
      const next = h ? id : this.hovered === id ? null : this.hovered;
      if (next === this.hovered) return;
      this.hovered = next;
      cx.notify();
    });
  }

  // compact: a ! instead of "Needs you", where room is short. `key`: unique per row, for the radar's rings.
  status(t, status, compact = false, key = "") {
    if (status === "working") return key ? workingLoader(this, t, key) : loader(t);
    if (status === "done") return doneDot(this, t, key);
    if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (status === "idle") return seenDot(t);
    return div().size(7).mx(3).flex_none().rounded(4).bg(status === "done" ? (t.done ?? t.dim) : t.dim + "00");
  }

  // Whether status() draws anything: an idle tab with the seen ring off, or no state at all, is an empty box
  // that would only hold a blank gap at the row's right end.
  shows(status) {
    if (status === "idle") return shared("seen.style") !== "none";
    return ["working", "done", "blocked"].includes(status);
  }

  // What an agent is on: a tab someone named or the agent's own title, never a bare tab number.
  label(a) {
    const tab = this.tabs.find((x) => x.id === a.tab);
    const s = tab ? title(tab, lead(tab, this.ps)) : a.title;
    return !s || /^\d+$/.test(s) ? a.program?.name || "" : s;
  }

  // An agent whose context is nearly full: its % in the warning color, the exact use in the pane header.
  fullBadge(t, a) {
    return div().id(`ws-full-${a.address}`).flex_none().text_size(11).font_semibold().text_color(t.blocked)
      .tooltip("Context nearly full").child(`${this.full[a.address]}%`);
  }

  // One agent of a space that has several: icon, what it's on, since when, its state. Click goes to it.
  // A tree line runs down from the space's icon to each agent, so they read as the space's tabs.
// While its sub-agents are listed and working under it, it leaves the loader to them.
  // Only the selection and the rows above it read bright: the focused tab of the active space.
  agentRow(a, t, indent, last, spaceActive) {
    const when = this.changed[a.address]?.at;
    const selected = a.focused && spaceActive;
    const pic = programIcon(a.program, 14, t.foreground, a.status === "working", a.address);
    const branch = div().relative().w(20).h(26).mr(-4).flex_none()
      .child(div().absolute().top(-9).left(0).w(20).h(22).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input))
      .when(!last, (el) => el.child(div().absolute().top(13).bottom(-3).left(0).border_l(1.5).border_color(t.input)));
    // The highlight starts just before the tree line and stops short of the block's right side, with a gap above each tab.
    const rowId = `ws-ag-${a.address}`;
    // Working while its sub-agents work in plain view under it: their loaders say so; folded, its own does.
    const busyBelow = a.status === "working" && this.tree(a.address).some((s) => !s.t.group && kidStatus(s.t, this.listed) === "working");
    const since = a.status === "done" ? this.finishedAt?.[a.address] : null;
    const stamp = since && stampOn() ? doneStamp(this, a.address, since) : null;
    // Kamehameha: the shot back across the stamp (when one shows) and the title, 8 px gaps.
    const shot = since ? kameShot(this, t, a.address, since, 8 + (this.titleW?.[a.address] ?? 0) + (stamp ? Math.round(Math.round(20 * 0.8) * 2.7) + 8 : 0), 20) : null;
    return this.hoverable(h_flex().id(rowId), rowId).ml(indent - 14).mr(4).mt(3).when(last, (el) => el.mb(4)).pl(6).pr(4).h(26).flex_none().gap(8).items_center().rounded(6).text_size(12.5)
      .when(a.focused, (el) => el.bg(t.raised))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(branch)
      .when(Boolean(pic), (el) => el.child(pic))
      .child(a.status === "working" && shimmerOn()
        ? shimmerText(t, `shim-${a.address}`, this.label(a), this.shimmerWidths ??= {})
        : div().id(`ws-title-${a.address}`).flex_1().min_w(0).text_color(selected ? t.foreground : t.muted)
          .on_size_change(({ width }) => { (this.titleW ??= {})[a.address] = width; })
          // A Kamehameha shot blows the letters out of the box, so it isn't clipped then.
          .child(kameTitle(this, a.address, this.label(a), this.titleW?.[a.address], 6.7) ?? div().truncate().child(this.label(a))))
      .when(this.full[a.address] >= FULL, (el) => el.child(this.fullBadge(t, a)))
      .when(Boolean(when) && this.hovered === rowId, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(this.now - when))))
      // Hovered, a trash can closes its tab, with the undo (and the ask, when an agent runs there) my-tabs gives.
      .when(this.hovered === rowId, (el) => el.child(div().id(`trash-${rowId}`).size(20).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(PR_LOOK.CLOSED.color(t)))
        .tooltip("Close tab")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); run(`my-tabs.close:${a.tab}`); })
        .child(svg("mods/my-menu/trash-2.svg").size(12))))
      .when(Boolean(stamp), (el) => el.child(stamp))
      .when(!busyBelow && this.shows(a.status), (el) => el.child(shot ?? this.status(t, a.status, false, a.address)));
  }

  // A sub-agent, under its parent with tree lines. Click peeks at it; a Claude sub-agent shows what it is
  // doing on hover and how long it has run, and its click goes to the agent that started it.
  // The "N sub-agents" line folds them away; folded (only then), its loader says they run.
  subRow(s, t, indent) {
    const k = s.t;
    const pic = k.group
      ? svg(`mods/workspace-chrome/chevron-${this.subsClosed.has(k.owner) ? "right" : "down"}.svg`).size(11).mx(1.5).flex_none().text_color(t.dim)
      : programIcon(k.program, 14, t.foreground, k.status === "working", k.address);
    const rowId = `ws-sub-${k.address}`;
    return this.hoverable(h_flex().id(rowId), rowId).pl(8 + indent).pr(8).h(26).flex_none().items_center().rounded(8).text_size(12.5)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => (k.group ? this.toggle(this.subsClosed, k.owner, "subagents.closed", cx)
        : k.claude ? run("pane.focus", { pane: k.pane }) : run("terminal.peek", { terminal: k.address })))
      .when(Boolean(k.activity), (el) => el.tooltip(k.activity))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(!k.group && kidStatus(k, this.listed) === "working" && shimmerOn()
        ? shimmerText(t, `shim-${k.address}`, k.name || k.template || k.program?.name || k.address, this.shimmerWidths ??= {})
        : div().flex_1().min_w(0).truncate().text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
      .when(Boolean(k.started) && this.hovered === rowId, (el) => el.child(div().flex_none().ml(6).text_size(11).text_color(t.dim).child(duration(this.now - k.started))))
      // The "N sub-agents" line repeats its sub-agents' state only while they're folded away.
      .when((!k.group || this.subsClosed.has(k.owner)) && this.shows(kidStatus(k, this.listed)), (el) => el.child(this.status(t, kidStatus(k, this.listed), false, k.address)));
  }

  // A space's row, then a row per agent when it has several, then sub-agents.
  spaceRows(r, t) {
    const mine = this.mine[r.w.id] ?? [];
    // Under the space's name: past the avatar, or past a worktree's tree and PR icon.
    const indent = r.tree ? 44 : 27;
    // With tabs or sub-agents under it, the space is a block that hovers and highlights as one.
    // Clicking such a space folds its tabs away.
    const foldable = mine.length > 0;
    if (!foldable) return [this.row({ ...r, grouped: false, foldable }, t)];
    const open = r.heads ? !this.closedRepos.has(r.heads) : !this.closed.has(r.w.id);
    const tabs = [];
    for (const [i, a] of mine.entries()) {
      tabs.push(this.agentRow(a, t, indent, i === mine.length - 1, r.w.active));
      tabs.push(...this.tree(a.address).map((s) => this.subRow(s, t, indent + 22)));
    }
    // The space and its tabs are one block: hovering any of it lights up all of it, as Orca's cards do,
    // and the active space highlights all of it. Folded, the space's row stands alone and its tabs
    // slide shut under it.
    return [v_flex().id(`space-group-${r.w.id}`).flex_none().rounded(8)
      .when(open && r.w.active, (el) => el.bg(t.selected))
      .when(open && !r.w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .child(this.row({ ...r, grouped: open, foldable }, t))
      .child(this.slide(`tabs-slide-${r.w.id}`, open, tabs))];
  }

  refreshPRs(cx) {
    const ps = panes();
    const now = Date.now();
    for (const w of spaces()) {
      const g = this.git[where(w, ps)];
      if (!g?.linked || !g.branch) continue;
      const key = prKey(g);
      if (now - (this.prAsked[key] ?? 0) < PR_EVERY) continue;
      this.prAsked[key] = now;
      cx.spawn(async (cx) => {
        try {
          const r = await exec("gh", ["pr", "list", "--head", g.branch, "--state", "all", "--limit", "1", "--json", "state,isDraft,number,url"], { cwd: place(w, ps), on: w.machine });
          if (r.code !== 0) return;
          const pr = JSON.parse(r.stdout || "[]")[0];
          this.pr[key] = pr ? { state: pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state, number: pr.number, url: pr.url } : null;
          cx.notify();
        } catch {}
      });
    }
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "my-menu", kind: "popup", width: 220, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // The spaces showing a repo's checkouts.
  repoSpaces(repo) {
    const ps = panes();
    return spaces().filter((w) => this.git[where(w, ps)]?.repo === repo);
  }

  repoMenu(header, repo, machine) {
    const [, path] = JSON.parse(repo);
    openOverlay({ mod: "my-menu", kind: "popup", width: 200, height: 120, props: { tab: "repo", target: {
      repo, name: header, machine, folder: path.replace(/\/\.git$/, ""), spaces: this.repoSpaces(repo).length,
    } } });
  }

  // Closes every space of a repo and drops its header. It stays hidden until
  // those spaces are gone, so the header isn't kept again meanwhile.
  removeRepo(repo) {
    this.removingRepos.add(repo);
    for (const w of this.repoSpaces(repo)) run("space.close", { id: w.id, confirmed: true });
    this.keepRepos(this.keptRepos.filter((k) => k.repo !== repo));
  }

  // Spaces in order: a space outside any repo on its own row; every repo under a
  // row with its name, its checkouts (the main one first) as branch rows under it.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    let list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    for (const repo of this.removingRepos) if (!list.some((r) => r.g?.repo === repo)) this.removingRepos.delete(repo);
    list = list.filter((r) => !this.removingRepos.has(r.g?.repo));
    // Not a worktree waiting out its undo before it's deleted (mods/my-tabs, shared "spaces.deleting").
    const deleting = shared("spaces.deleting") ?? {};
    list = list.filter((r) => !deleting[r.w.id]);
    const out = [];
    const placed = new Set(); // repos whose checkouts are listed (under the first of its spaces)
    for (const r of list) {
      const repo = r.g?.repo;
      if (!r.g) {
        out.push({ ...r, tree: null });
        continue;
      }
      if (placed.has(repo)) continue;
      const kids = list.filter((k) => k.g?.repo === repo).sort((a, b) => Number(a.g.linked) - Number(b.g.linked));
      out.push({ header: r.g.name, repo, count: kids.length, w: { id: `repo-${repo}`, machine: r.w.machine ?? null } });
      placed.add(repo);
      // Under their repo's header (`under`), they slide shut with it; folded, they're `hidden`.
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─",
        under: repo, hidden: this.closedRepos.has(repo) }));
    }
    // Until every space's git is known, a kept header could show empty above its own worktrees.
    if (!list.every((r) => where(r.w, ps) in this.git)) return out;
    for (const [n, k] of this.keptRepos.entries()) {
      if (placed.has(k.repo) || this.removingRepos.has(k.repo)) continue;
      const next = this.keptRepos.slice(n + 1).find((later) => placed.has(later.repo));
      const at = next ? out.findIndex((r) => r.header && r.repo === next.repo) : -1;
      out.splice(at < 0 ? out.length : at, 0, { header: k.name, repo: k.repo, empty: true, w: { id: `repo-${k.repo}`, machine: k.machine } });
    }
    this.keepRepos(out.filter((r) => r.header).map((r) => ({ repo: r.repo, name: r.header, machine: r.w.machine ?? null })));
    return out;
  }

  // A space on a folder outside any repo: git said so, it isn't just unanswered.
  isPlain(w) {
    const spot = where(w, panes());
    return this.git[spot] === null && !this.unsure.has(spot);
  }

  keepRepos(list) {
    const text = JSON.stringify(list);
    if (text === JSON.stringify(this.keptRepos)) return;
    this.keptRepos = list;
    localStorage.setItem("repos.kept", text);
    // A repo whose header is gone frees its color for the next one.
    const colors = shared("repo.colors") ?? {};
    const live = Object.fromEntries(Object.entries(colors).filter(([repo]) => list.some((k) => k.repo === repo)));
    if (Object.keys(live).length !== Object.keys(colors).length) setShared("repo.colors", live);
  }

  // A repo's name over its checkouts. Click it to fold them away.
  // One with no worktrees left stays, its name muted, until "Remove project" in its menu.
  repoHeader({ header, repo, w, empty, count }, t, collapsed) {
    if (collapsed) return div().id(w.id).flex_none().h(1).my(4).mx(6).bg(t.border);
    const shown = this.hovered === w.id;
    return this.hoverable(h_flex().id(w.id), w.id).px(8).h(30).mb(4).flex_none().gap(9).items_center().rounded(8)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(this.closedRepos, repo, "repos.closed", cx))
      .on_mouse_down("right", () => this.repoMenu(header, repo, w.machine ?? null))
      .child(h_flex().size(18).flex_none().rounded(5).bg(repoFill(repo, header)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child(initial(header)))
      .child(div().min_w(0).truncate().text_color(empty ? t.dim : this.repoSpaces(repo).some((s) => s.active) ? t.foreground : t.muted).child(header))
      // Folded, how many checkouts it hides, by its name.
      .when(this.closedRepos.has(repo) && count > 0 && countMode() !== "off", (el) => el.child(this.countBadge(t, count)))
      .child(div().flex_1())
      // Folded, the most urgent state of their agents.
      .when(!shown && this.closedRepos.has(repo), (el) => { const top = this.repoUrgent(repo); return top ? el.child(this.status(t, top, true, w.id)) : el; })
      // Its buttons only while hovered.
      .when(shown, (el) => el.children(this.repoButtons(t, w.id, header, repo, w.machine ?? null)))
      // With no worktrees left, a quiet trash can drops it from the sidebar: nothing closes, nothing leaves the disk.
      .when(Boolean(empty), (el) => el.child(div().id(`trash-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(PR_LOOK.CLOSED.color(t)))
        .tooltip("No worktrees · Remove project from the sidebar")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.removeRepo(repo); cx.notify(); })
        .child(svg("mods/my-menu/trash-2.svg").size(12))));
  }

  // A repo's ⋯ (its menu) and + (a new worktree): on its header, or on the
  // row of a space on its main checkout, which stands in for the header.
  repoButtons(t, id, header, repo, machine) {
    const button = (key, icon, action) => div().id(`${id}-${key}`).size(22).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(icon).size(12));
    return [
      button("more", "mods/my-menu/ellipsis.svg", () => this.repoMenu(header, repo, machine)),
      button("new", "mods/workspace-chrome/plus.svg", () => {
        const [, path] = JSON.parse(repo);
        openOverlay({ mod: "new-workspace", kind: "dialog", width: 480, height: 370, props: { repo: path.replace(/\/\.git$/, "") } });
      }),
    ];
  }

  // The rows, under a header per machine once one isn't this computer.
  // Rows drawn in order; a repo's branches go in one container that slides shut and
  // open under its header, or under the row of a space on its main checkout.
  drawRows(rows, draw, t) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // A little air between one space (or repo, with its worktrees) and the next.
      if (out.length) out.push(div().id(`space-gap-${r.w.id}`).h(4).flex_none());
      out.push(...[].concat(draw(r)));
      const repo = r.header ? r.repo : r.g && !r.g.linked && !r.tree ? r.g.repo : null;
      if (!repo) continue;
      const kids = [];
      while (rows[i + 1] && !rows[i + 1].header && rows[i + 1].tree && rows[i + 1].under === repo) kids.push(rows[++i]);
      if (kids.length) out.push(this.slide(`repo-slide-${repo}`, !this.closedRepos.has(repo), kids.flatMap((k) => [].concat(draw(k)))));
    }
    return out;
  }

  // Rows that fold under the row above: a container that clips them, its height
  // their measured height or 0, changed with the motion set in Custom settings.
  // They stay laid out while folded, so they can slide open again.
  slide(id, open, children) {
    this.slideHeights ??= {};
    const h = this.slideHeights[id];
    const inner = v_flex().id(`${id}-in`).flex_none()
      .on_size_change(({ height }, cx) => {
        if (Math.abs((this.slideHeights[id] ?? -1) - height) < 0.5) return;
        this.slideHeights[id] = height;
        cx.notify();
      })
      .children(children);
    const box = v_flex().id(id).flex_none().overflow_hidden();
    // Until measured, an open one just takes its content's height.
    if (open && h === undefined) return box.child(inner);
    return motion(box.h(open ? h : 0)).child(inner);
  }

  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (r.header ? this.repoHeader(r, t, collapsed) : collapsed ? this.compact(r, t) : this.spaceRows(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : this.drawRows(rows, draw, t);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? this.drawRows(mine, draw, t) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch).
  // `shown`: the row is hovered, so its repo and branch names show. Ahead/behind
  // belong to a branch: they show on a worktree's row (`tree`), never on a repo's.
  gitTail(g, tree, name, t, shown = true, w = null) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    // A worktree's row is already named after its branch: hovered, it adds only the branch's owner (candidogomes/… shows candidogomes).
    const owner = raw.includes("/") ? raw.split("/")[0] : "";
    const branch = tree && same(bare(raw)) ? owner : same(raw) ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    // The row's name takes all the room it needs; hovered, a space's keeps 150 px and its branch gets the rest.
    // A worktree's tail (owner, ahead, behind) keeps its own width instead: the branch name truncates to make room for it.
    return h_flex()
      .flex_1()
      .min_w(0)
      .when(Boolean(tree), (el) => el.flex_none())
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where) && shown, (el) => el.child(div().min_w(0).truncate().when(tree, (d) => d.flex_none()).child(where)))
      .when(tree && shown && g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(tree && shown && g.behind > 0, (el) => el.child(w ? this.behindButton(t, g, w) : div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // A branch's ↓N: clicked, a new tab in its space starts Claude to bring it up to date.
  behindButton(t, g, w) {
    const branch = g.branch ?? "this checkout";
    const task = `This checkout is on ${branch}, ${g.behind} commit${g.behind === 1 ? "" : "s"} behind its upstream. ` +
      "Bring it up to date: fetch, fast-forward when it can, and merge the upstream in when the branch has commits of its own. " +
      "Never rebase, never force-push, and never discard or overwrite local changes: stash them around the update and put them back. " +
      "When a conflict needs a decision about which side wins, stop and ask me. Finish by saying how far it moved.";
    return div().id(`behind-${w.id}`).flex_none().px(3).rounded(4).cursor_pointer().text_color(t.ansi1)
      .hover((s) => s.bg(t.hover))
      .tooltip(`${g.behind} behind · Click to have Claude update it`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("tab.new", { name: `Update ${bare(branch)}`, space: w.id, argv: [`${appHome()}/bin/claude-account`], task });
      })
      .child(`\u2193${g.behind}`);
  }

  toggle(set, key, store, cx) {
    set.has(key) ? set.delete(key) : set.add(key);
    localStorage.setItem(store, JSON.stringify([...set]));
    cx.notify();
  }

  row({ w, i, g, tree, grouped, foldable, heads }, t) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    // A main checkout heading its folded repo speaks for the worktrees folded under it too.
    const top = heads && this.closedRepos.has(heads) ? this.repoUrgent(heads, this.closed.has(w.id) ? null : w.id) : this.urgent(this.mine[w.id] ?? []);
    const rowId = `space-${w.id}`;
    // A worktree's row is named after its branch, without its owner's prefix (marianoggf/min reads min).
    const plain = this.isPlain(w);
    // A space outside any repo reads the name typed in Custom settings > Plain spaces, when there is one.
    const rowName = tree && g?.branch ? bare(g.branch) : (!tree && plain && shared("plain.name")) || w.name;
    const merged = Boolean(g?.linked) && Boolean(g?.branch) && this.pr[prKey(g)]?.state === "MERGED";
    // No tab left under a worktree: nothing runs there any more.
    // The same for any space with no worktrees under it either: its name goes muted.
    const childless = !(this.mine[w.id]?.length) && !heads;
    const tabless = Boolean(g?.linked) && childless;
    const counted = foldable && this.closed.has(w.id) && countMode() !== "off";
    const closable = Boolean(g) && !g?.linked && Boolean(tree) && (childless || this.hovered === rowId);
    return this.hoverable(v_flex().id(rowId), rowId)
      .relative()
      .px(8)
      .h(rowHeight(tree))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on && !grouped, (el) => el.bg(t.selected))
      .when(!on && !grouped, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i && heads) {
          // The second click of a double-click undoes the first one's fold and opens the space.
          this.toggle(this.closedRepos, heads, "repos.closed", cx);
          if (e.click_count > 1) run("space.select", { id: w.id });
        }
        else if (from === i && foldable) this.toggle(this.closed, w.id, "spaces.closed", cx);
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => {
            const pr = g?.branch ? this.pr[prKey(g)] : null;
            const look = PR_LOOK[pr?.state] ?? PR_LOOK.none;
            return el.pl(22).child(div().id(`pr-${w.id}`).flex_none().tooltip(pr ? `PR #${pr.number} · ${look.label}` : g?.linked ? look.label : "Main checkout")
              .child(svg(look.icon).size(13).text_color(look.color(t))));
          })
          // A folder outside any repo: an icon (Custom settings > Plain spaces), no repo avatar.
          .when(!tree && plain, el => {
            const look = PLAIN_ICON[shared("plain.icon")] ?? PLAIN_ICON.folder;
            return el.child(h_flex().size(18).flex_none().items_center().justify_center().child(svg(look.icon).size(look.size).text_color(t.muted)));
          })
          .when(!tree && !plain, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child(initial(w.name))))
          .child(div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).when(this.hovered === rowId && !tree, (el) => el.flex_shrink(0).max_w(150)).when(Boolean(tree) && Boolean(g) && !counted, (el) => el.flex_1()).when(plain && !tree, (el) => el.font_family("Courier New").text_size(15)).child(rowName))
          // Folded, how many tabs it hides, by its name.
          .when(counted, (el) => el.child(this.countBadge(t, this.mine[w.id].length)))
          .when(counted && Boolean(tree) && Boolean(g), (el) => el.child(div().flex_1()))
          .child(g ? this.gitTail(g, tree, rowName, t, this.hovered === rowId, w) : div().flex_1())
          .when(merged || tabless, (el) => el.child(this.trash(t, w, merged ? "Merged" : "No tabs")))
          // A main checkout's row closes only its space, never the checkout: with no tabs left, or while hovered.
          .when(closable, (el) => el.child(this.closeButton(t, w)))
          // An agent's state (working, needs you, done) shows on its tab's row; the space's own row
          // shows the most urgent one only while those rows are folded away, at the right end, in the
          // X's or trash's slot when neither shows, so ahead/behind keep their place.
          .when(Boolean(top) && !closable && !merged && !tabless && (heads ? this.closedRepos.has(heads) : foldable && this.closed.has(w.id)),
            (el) => el.child(div().w(20).flex_none().flex().items_center().justify_center().child(this.status(t, top, true, w.id))))
          // A space on a repo's main checkout is that repo's header too: its buttons while hovered.
          .when(!tree && Boolean(g) && !g?.linked && this.hovered === rowId, (el) => el.children(
            this.repoButtons(t, rowId, g.name, g.repo, w.machine ?? null))),
      );
  }

  // Closes a space as its menu's Close does; the folder and branch stay on disk.
  closeButton(t, w) {
    return div().id(`close-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Close")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.close", { id: w.id }); })
      .child(svg("mods/workspace-chrome/x.svg").size(12));
  }

  // A pill with how many rows a folded row hides: its direct children, not their own.
  countBadge(t, n) {
    return h_flex().flex_none().h(16).min_w(16).px(5).rounded_full().items_center().justify_center()
      .bg(countMode() === "grey" ? t.input : t.foreground)
      .text_size(10.5).font_semibold().text_color(countMode() === "grey" ? t.muted : t.background).child(String(n));
  }

  // A worktree whose PR was merged, or with no tab left, has done its job: a quiet trash can on
  // its row deletes the worktree and its branch, with the undo my-tabs gives the menu's item.
  trash(t, w, why) {
    return div().id(`trash-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(PR_LOOK.CLOSED.color(t)))
      .tooltip(`${why} · Delete worktree and branch`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run(`my-tabs.delete-worktree:${w.id}`); })
      .child(svg("mods/my-menu/trash-2.svg").size(12));
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    this.radarShown = false;
    stampFrame(this);
    kameFrame(this);
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // Agents by space, for the rows; read once per render.
    const list = agents();
    this.now = Date.now();
    this.track(list, this.now);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.agentOf = new Map(list.map((a) => [a.address, a]));
    this.all = terminals();
    this.ps = panes();
    this.tabs = sp.flatMap((s) => s.tabs ?? []);
    // Every tab gets a row, in tab order: its agents, or its main terminal when no agent runs there.
    // Not a tab waiting out its undo before closing (mods/my-tabs, shared "tabs.closing").
    this.mine = {};
    const gone = shared("tabs.closing") ?? {};
    for (const s of sp) {
      for (const tab of s.tabs ?? []) {
        if (gone[tab.id]) continue;
        const here = list.filter((a) => a.tab === tab.id);
        const l = here.length ? null : lead(tab, this.ps);
        if (l) here.push({ address: l.terminal, pane: l.pane, space: s.id, tab: tab.id, status: null, program: l.program, title: l.title, focused: l.focused && tab.active && s.active });
        if (here.length) (this.mine[s.id] ??= []).push(...here);
      }
    }
    const body = this.grouped(t, collapsed);
    // agent.next / agent.prev go down this list, unless Herdr's agents list is still shown and sets it.
    if (!shows(layout(), "agents")) setAgentOrder(this.ordered().flatMap((r) => (r.header || r.hidden ? [] : (this.mine[r.w.id] ?? []).filter((a) => this.listed.has(a.address)).map((a) => a.address))));
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      // Its + (a new workspace) only while the title bar is hovered.
      .child(this.hoverable(h_flex().id("space-title"), "space-title").h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .child(h_flex().id("space-fold").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
          .hover(s => s.text_color(t.foreground))
          .on_click(toggleFold)
          .child(svg(`mods/workspace-chrome/chevron-${folded() ? "right" : "down"}.svg`).size(10).flex_none())
          .when(!collapsed, el => el.child("Workspaces")))
        .when(this.hovered === "space-title", el => el.child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ mod: "new-workspace", kind: "dialog", width: 480, height: 370 })).child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .when(!folded(), el => el.child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(body)))
      // On macOS the title bar hides its sidebar button on the rail: this one opens it again.
      .when(collapsed && window()?.platform === "macos", (el) => el.child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("expand").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("\u00bb"))));
  }
}
