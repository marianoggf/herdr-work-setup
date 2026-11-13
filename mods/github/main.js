// GitHub: my pull request inbox, like github.com/pulls/inbox, as a sidebar list.
// Sections: needs my review, needs my teams' review, my drafts, mine waiting for
// review or checks, mine that need action, mine ready to merge. Asked of `gh`
// every two minutes while the window is in front, and on the refresh button.
// Click a PR to open it in the browser.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { loader } from "./loader.js";
import { exec, run, theme, window, layout, shared, setShared, props, openOverlay, closeOverlay, appHome, readTextFile } from "herdr";
import { prRow, fetchAvatars, checks } from "./row.js";

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
const BLOCK = "github", TITLE = 41, PAD = 10;
const blockPx = () => find(layout(), BLOCK)?.size?.px;
const folded = () => blockPx() === TITLE;
const toggleFold = () => run("layout.resize", folded() ? { id: BLOCK, weight: 1 } : { id: BLOCK, px: TITLE });
function fit(content) {
  const px = Math.round(Math.min(TITLE + content + PAD, (globalThis.window?.viewport_size?.()?.height ?? Infinity) * 0.4));
  if (Math.abs((blockPx() ?? 0) - px) > 1) run("layout.resize", { id: BLOCK, px });
}

// Refreshed every 5 minutes while open; folded, nothing is asked until it opens again.
const EVERY = 300000;

// The sidebar and the PRs panel (mods/prs) refresh together. A refresh on either side, from its
// button or its 5-minute timer, sets "gh.request"; the other side sees it and refreshes too. Each
// side sets "gh.loading.<side>" while it fetches, and both refresh buttons spin while either does.
const REQUEST = "gh.request";
const drafts = () => shared("github.drafts") !== false;
const busyElsewhere = () => Boolean(shared("gh.loading.prs"));
const panelShowsGroup = () => {
  const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === "prs" && shared("prs.filter"));
};
// My team ("org/slug") and the name its section goes by, from the untracked
// ~/.config/herdr-app/local.json: { "github": { "team": "acme/platform", "teamName": "Platform" } }.
// Without a team there is no team section.
let TEAM = null;
async function readTeam() {
  try {
    const gh = JSON.parse((await readTextFile(`${appHome()}/local.json`)) || "{}").github ?? {};
    TEAM = /^[\w.-]+\/[\w.-]+$/.test(gh.team ?? "") ? gh.team : null;
    if (gh.teamName) SECTIONS.find((s) => s.id === "squad").label = String(gh.teamName);
  } catch {
    TEAM = null;
  }
}
const TEAM_QUERY = () => `query { viewer { login } organization(login: "${TEAM.split("/")[0]}") { team(slug: "${TEAM.split("/")[1]}") { members(first: 100) { nodes { login } } } } }`;
// The team section only lists PRs opened in the last two weeks.
const SQUAD_DAYS = 14;
const squadSince = () => new Date(Date.now() - SQUAD_DAYS * 86400000).toISOString().slice(0, 10);
const QUERY = (teammates) => `
fragment P on PullRequest {
  number title url isDraft updatedAt reviewDecision mergeable totalCommentsCount merged mergedAt closed
  isInMergeQueue mergeQueueEntry { position state }
  repository { nameWithOwner name } author { login avatarUrl }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 1) {
    checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }
}
query {
  mine: search(query: "is:pr is:open author:@me archived:false", type: ISSUE, first: 50) { nodes { ...P } }
  user: search(query: "is:pr is:open user-review-requested:@me archived:false", type: ISSUE, first: 50) { nodes { ...P } }
  team: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 50) { nodes { ...P } }
  ${teammates.length ? `squad: search(query: "is:pr is:open archived:false org:${TEAM.split("/")[0]} sort:updated-desc created:>=${squadSince()} ${teammates.map((l) => `author:${l}`).join(" ")}", type: ISSUE, first: 50) { nodes { ...P } }` : ""}
  ${TEAM ? `squadReview: search(query: "is:pr is:open archived:false sort:updated-desc created:>=${squadSince()} team-review-requested:${TEAM}", type: ISSUE, first: 50) { nodes { ...P } }` : ""}
}`;

const SECTIONS = [
  { id: "review", label: "Needs your review", info: "Someone asked you for a review" },
  { id: "team", label: "Needs your teams' review", info: "One of your teams was asked for a review" },
  { id: "drafts", label: "Your drafts", info: "Your draft pull requests" },
  { id: "waiting", label: "Waiting for review or checks", info: "Yours, waiting on reviewers or CI" },
  { id: "action", label: "Needs action", info: "Yours, with changes requested or failing checks" },
  { id: "ready", label: "Ready to merge", info: "Yours, approved with checks passing" },
  { id: "squad", label: "Your team", info: "Open pull requests from the last two weeks, from your teammates or asking your team for a review" },
];

function sections(data) {
  const out = Object.fromEntries(SECTIONS.map((s) => [s.id, []]));
  const user = data.user.nodes.filter(Boolean);
  const mineIds = new Set(user.map((p) => p.url));
  out.review = user;
  out.team = data.team.nodes.filter((p) => p && !mineIds.has(p.url));
  for (const p of data.mine.nodes.filter(Boolean)) {
    const ck = checks(p);
    if (p.isDraft) out.drafts.push(p);
    else if (p.reviewDecision === "CHANGES_REQUESTED" || ck.fail) out.action.push(p);
    else if (p.reviewDecision === "APPROVED" && !ck.wait && p.mergeable !== "CONFLICTING") out.ready.push(p);
    else out.waiting.push(p);
  }
  // Teammates' PRs and the team's review requests the sections above don't already show.
  const shown = new Set(Object.values(out).flat().map((p) => p.url));
  const squad = [...(data.squad?.nodes ?? []), ...(data.squadReview?.nodes ?? [])].filter((p) => {
    if (!p || shown.has(p.url)) return false;
    shown.add(p.url);
    return true;
  });
  out.squad = squad.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return out;
}

export default class GitHub extends View {
  init(_props, cx) {
    if (props()?.menu) return;
    this.data = null;
    this.error = null;
    this.loading = false;
    this.asked = 0;
    this.me = null;
    this.teammates = null;
    this.avatars = {}; // login -> true (cached) | false (failed)
    this.open = JSON.parse(localStorage.getItem("open") ?? "{}");
    setShared("github.drafts", localStorage.getItem("drafts") !== "hidden");
    this.drafts = drafts();
    this.handled = shared(REQUEST) ?? 0;
    setShared("gh.loading.github", false);
    if (!folded()) this.refresh(cx);
    // A refresh asked on the panel side. Folded, the sidebar only follows it for the group the panel shows.
    cx.timer.every(1000, (cx) => {
      if (drafts() !== this.drafts) this.applyDrafts(cx);
      const r = shared(REQUEST) ?? 0;
      if (r <= this.handled) return;
      this.handled = r;
      if (!folded() || panelShowsGroup()) this.refresh(cx, false);
    });
    cx.timer.every(15000, (cx) => {
      if (window().active && !folded() && Date.now() - this.asked > EVERY) this.refresh(cx);
    });
    // The "4d" ages move on their own.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  refresh(cx, announce = true) {
    if (this.loading) return;
    this.loading = true;
    this.asked = Date.now();
    if (announce) {
      this.handled = this.asked;
      setShared(REQUEST, this.asked);
    }
    setShared("gh.loading.github", true);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (!this.teammates) {
          await readTeam();
          if (TEAM) {
            const m = await exec("gh", ["api", "graphql", "-f", `query=${TEAM_QUERY()}`]);
            if (m.code !== 0) throw new Error((m.stderr || m.stdout).trim().split("\n")[0] || "gh failed");
            const d = JSON.parse(m.stdout).data;
            this.teammates = (d.organization?.team?.members?.nodes ?? []).map((n) => n.login).filter((l) => l !== d.viewer.login);
          } else this.teammates = [];
        }
        const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY(this.teammates)}`]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || "gh failed");
        this.data = sections(JSON.parse(r.stdout).data);
        // Keep the group shown in the PRs panel current.
        const f = shared("prs.filter");
        const sec = f && SECTIONS.find((x) => x.id === f.id);
        if (sec) setShared("prs.filter", { id: sec.id, label: sec.label, prs: this.shown(sec.id) });
        this.error = null;
      } catch (e) {
        this.error = String(e.message ?? e);
      }
      this.loading = false;
      setShared("gh.loading.github", false);
      cx.notify();
      if (this.data && (await fetchAvatars(Object.values(this.data).flat(), this.avatars))) cx.notify();
    });
  }

  // A section is open unless folded; an empty one has nothing to open.
  isOpen(id) {
    return this.open[id] ?? true;
  }

  header(s, prs, t) {
    const open = this.isOpen(s.id) && prs.length > 0;
    return h_flex().id(`gh-sec-${s.id}`).h(32).mt(4).px(8).flex_none().gap(8).items_center().rounded(6).text_size(12.5)
      .text_color(prs.length ? t.muted : t.dim)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .tooltip(s.info)
      .on_click((_e, cx) => {
        if (!prs.length) return;
        this.open[s.id] = !open;
        localStorage.setItem("open", JSON.stringify(this.open));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().min_w(0).truncate().child(s.label))
      .child(this.panelButton(s, prs, t))
      .child(div().flex_1())
      .child(div().flex_none().px(6).h(18).rounded(9).bg(t.raised).text_size(11).flex().items_center().child(String(prs.length)));
  }

  // Shows this group in the PRs panel (mods/prs); a second click closes the panel.
  panelButton(s, prs, t) {
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    const on = panel && !panel.hidden && body?.active === "prs" && shared("prs.filter")?.id === s.id;
    return div().id(`gh-panel-${s.id}`).flex_none().p(3).rounded(4).text_color(on ? t.foreground : t.dim)
      .when(on, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .tooltip(on ? "Close the PRs panel" : "Show in the PRs panel")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (on) return run("layout.hide", { id: "panel" });
        setShared("prs.filter", { id: s.id, label: s.label, prs });
        run("layout.select", { stack: "panel-body", child: "prs" });
        run("layout.show", { id: "panel" });
      })
      .child(svg("mods/workspace-chrome/panel-right.svg").size(12));
  }

  // The same row as the PRs panel (row.js is a hard link to mods/prs/row.js).
  row(pr, t) {
    return prRow(t, pr, this.avatars);
  }

  rail(t) {
    const n = this.data ? this.data.review.length + this.data.team.length : 0;
    return v_flex().size_full().bg(t.chrome).items_center().pt(10).gap(4)
      .child(svg("mods/github/github.svg").size(14).text_color(t.dim))
      .when(n > 0, (el) => el.child(div().text_size(11).text_color(t.blocked).child(String(n))));
  }

  // A group's PRs, without drafts while they're hidden.
  shown(id) {
    return (this.data?.[id] ?? []).filter((p) => drafts() || !p.isDraft);
  }

  applyDrafts(cx) {
    this.drafts = drafts();
    localStorage.setItem("drafts", this.drafts ? "shown" : "hidden");
    const f = shared("prs.filter");
    const sec = f && SECTIONS.find((x) => x.id === f.id);
    if (sec) setShared("prs.filter", { id: sec.id, label: sec.label, prs: this.shown(sec.id) });
    cx.notify();
  }

  // The ▾ menu: view options for the section.
  menu(t) {
    const option = (id, label, on, toggle) => h_flex().id(id).h(31).px(12).gap(9).items_center().flex_none()
      .text_color(t.foreground).hover((s) => s.bg(t.selected)).cursor_pointer()
      .on_click(() => { toggle(); closeOverlay(props().overlay); })
      .child(div().size(14).flex_none().child(on ? svg("mods/workspace-chrome/check.svg").size(14) : div()))
      .child(div().flex_1().child(label));
    return v_flex().w_full().py(5).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_lg().text_size(12.8)
      .child(option("gh-opt-drafts", "Show drafts", drafts(), () => setShared("github.drafts", !drafts())));
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    if (narrow()) return this.rail(t);
    const body = this.error
      ? [div().px(8).text_size(12).text_color(t.blocked).child(this.error)]
      : !this.data
        ? [div().px(8).text_size(12).text_color(t.dim).child("Loading…")]
        : !SECTIONS.some((s) => this.shown(s.id).length)
          ? [div().px(8).text_size(12).text_color(t.dim).child(drafts() ? "No pull requests waiting on you." : "No pull requests besides drafts.")]
          : SECTIONS.filter((s) => this.shown(s.id).length).flatMap((s) => {
          const prs = this.shown(s.id);
          return [this.header(s, prs, t), ...(this.isOpen(s.id) ? prs.map((p) => this.row(p, t)) : [])];
        });
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(41).px(16).flex_none().items_center().justify_between()
        .child(h_flex().id("gh-fold").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
          .text_size(11.5).font_medium().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            // Folding the section folds its groups too, so it opens again compact.
            if (!folded()) {
              for (const sec of SECTIONS) this.open[sec.id] = false;
              localStorage.setItem("open", JSON.stringify(this.open));
              cx.notify();
            } else this.refresh(cx);
            toggleFold();
          })
          .child(svg(`mods/workspace-chrome/chevron-${folded() ? "right" : "down"}.svg`).size(10).flex_none())
          .child("GitHub"))
        .when(!folded(), (el) => el.child(div().id("gh-menu").flex_none().mr(8).p(2).rounded(4).text_color(t.dim)
          .hover((d) => d.bg(t.hover).text_color(t.foreground))
          .tooltip("View options")
          .on_click(() => openOverlay({ frame: "none", mod: "github", kind: "popup", width: 190, height: 44, props: { menu: true } }))
          .child(svg("mods/workspace-chrome/chevron-down.svg").size(12))))
        .when(!folded(), (el) => el.child(div().id("gh-refresh").flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(this.loading || busyElsewhere() ? "Refreshing…" : "Refresh")
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading || busyElsewhere()
            ? loader(theme(), 20)
            : svg("mods/github/refresh.svg").size(13)))))
      .when(!folded(), (el) => el.child(v_flex().id("gh-list").flex_1().min_h(0).px(8).pb(10).overflow_y_scrollbar().mode("always")
        .child(v_flex().id("gh-content").flex_none().on_size_change((s) => fit(s.height)).children(body))));
  }
}
