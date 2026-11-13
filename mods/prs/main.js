// Pull requests: the open PRs on github.com that involve me (last 30 days),
// sorted into what needs my review (mine or my team's), and where my own PRs stand
// (including the ones in a merge queue).
// Data comes from `gh api graphql`; avatars are cached under mods/prs/avatars.
// Adapted from lucasprag's prs mod: the GitHub sidebar section can show one of its
// groups here (shared "prs.filter" = { id, label, prs }); × goes back to the full view.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, shared, setShared, layout } from "herdr";
import { prRow, fetchAvatars, ciState } from "./row.js";

const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { issueCount nodes { ... on PullRequest {
  number title url isDraft updatedAt createdAt reviewDecision mergeable merged mergedAt closed totalCommentsCount
  isInMergeQueue mergeQueueEntry { position state }
  repository { nameWithOwner name } author { login avatarUrl }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 1) {
    checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug combinedSlug } } } }
  latestReviews(first: 20) { nodes { state author { login } } } } } } }`;

const SECTIONS = [
  ["review", "Needs your review"],
  ["action", "Needs action"],
  ["merge", "Ready to merge"],
  ["queue", "In merge queue"],
  ["waiting", "Waiting for review"],
  ["drafts", "Your drafts"],
  ["mergedToday", "Merged today"],
];
const REFRESH_MS = 300000;

// The panel and the GitHub sidebar section refresh together: see REQUEST in mods/github.
// The panel only fetches while it's the one shown.
const REQUEST = "gh.request";
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const shown = () => {
  const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === "prs");
};
const SPIN_MS = 900;

function sinceDate() {
  const d = new Date(Date.now() - 30 * 86400000);
  return d.toISOString().slice(0, 10);
}

// Local midnight as an ISO time with this machine's offset, so "today" is
// today here and not in UTC.
function localMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { ms: d.getTime(), iso: `${ymd}T00:00:00${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}` };
}

// Which section a PR belongs to, or null when it isn't mine to act on.
function classify(pr, me, teams) {
  const mine = pr.author?.login === me;
  const requests = pr.reviewRequests?.nodes?.map((n) => n.requestedReviewer).filter(Boolean) ?? [];
  const ci = ciState(pr);
  if (mine) {
    if (pr.isInMergeQueue) return "queue";
    if (pr.isDraft) return "drafts";
    if (pr.reviewDecision === "CHANGES_REQUESTED" || pr.mergeable === "CONFLICTING" || ci === "FAILURE" || ci === "ERROR") return "action";
    if (pr.reviewDecision === "APPROVED") return "merge";
    return "waiting";
  }
  if (requests.some((r) => r.__typename === "User" && r.login === me)) return "review";
  const myReview = pr.latestReviews?.nodes?.find((r) => r.author?.login === me)?.state;
  if (requests.some((r) => r.__typename === "Team" && teams.has(r.slug)) && myReview !== "APPROVED") return "review";
  return null;
}

export default class PullRequests extends View {
  init(_props, cx) {
    this.sections = null; // { key: [pr, ...] } after the first load
    this.error = null;
    this.loading = true;
    this.folded = new Set();
    this.avatars = {}; // login -> true (cached) | false (failed)
    this.asked = 0;
    this.handled = shared(REQUEST) ?? 0;
    setShared("gh.loading.prs", false);
    cx.timer.every(1000, (cx) => {
      const r = shared(REQUEST) ?? 0;
      if (r > this.handled) {
        this.handled = r;
        if (shown()) this.refresh(cx, false);
      } else if (shown() && Date.now() - this.asked > REFRESH_MS) this.refresh(cx);
    });
    // option+command+P folds or opens every section (mods/workspaces, foldAll); it asks here whether any is open.
    this.foldSeen = shared("sections.fold")?.at ?? 0;
    cx.timer.every(300, (cx) => {
      const sig = shared("sections.fold");
      if (sig && sig.at > this.foldSeen) {
        this.foldSeen = sig.at;
        this.folded = new Set(sig.folded ? SECTIONS.map(([k]) => k) : []);
        cx.notify();
      }
      const open = SECTIONS.some(([k]) => (this.sections?.[k]?.length ?? 0) > 0 && !this.folded.has(k));
      if (open !== shared("prs.open")) setShared("prs.open", open);
    });
    // A group from the sidebar can bring authors the full view hasn't seen.
    cx.timer.every(1500, (cx) => {
      const f = shared("prs.filter");
      if (f?.prs?.some((pr) => pr.author?.login && !(pr.author.login in this.avatars))) cx.spawn((cx) => this.fetchAvatars(f.prs, cx));
    });
  }

  async gh(args) {
    const r = await exec("gh", args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || `gh exited ${r.code}`);
    return r.stdout;
  }

  refresh(cx, announce = true) {
    if (this.busy) return;
    this.busy = true;
    this.asked = Date.now();
    if (announce) {
      this.handled = this.asked;
      setShared(REQUEST, this.asked);
    }
    setShared("gh.loading.prs", true);
    cx.notify(); // start the refresh icon spinning now, not when the data lands
    const started = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (!this.me) {
          this.me = (await this.gh(["api", "user", "--jq", ".login"])).trim();
          const teams = (await this.gh(["api", "user/teams", "--jq", ".[].slug"])).split("\n").map((s) => s.trim()).filter(Boolean);
          this.teams = new Set(teams);
        }
        const q = `is:pr is:open involves:@me archived:false updated:>=${sinceDate()}`;
        const midnight = localMidnight();
        const mq = `is:pr is:merged author:@me archived:false merged:>=${midnight.iso}`;
        const [out, mout] = await Promise.all([q, mq].map(async (query) =>
          JSON.parse(await this.gh(["api", "graphql", "-F", `q=${query}`, "-F", `query=${QUERY}`]))));
        const nodes = (out.data?.search?.nodes ?? []).filter((n) => n && n.number);
        const merged = (mout.data?.search?.nodes ?? []).filter((n) => n && n.number && Date.parse(n.mergedAt) >= midnight.ms);
        const sections = Object.fromEntries(SECTIONS.map(([k]) => [k, []]));
        for (const pr of nodes) {
          const key = classify(pr, this.me, this.teams);
          if (key) sections[key].push(pr);
        }
        for (const list of Object.values(sections)) list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        sections.mergedToday = merged.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
        // The queue and today's merges fill up during the day, so open them when PRs land in them.
        for (const k of ["queue", "mergedToday"]) if (this.sections && this.sections[k].length === 0 && sections[k].length > 0) this.folded.delete(k);
        this.sections = sections;
        this.error = null;
        this.loading = false;
        cx.notify();
        await this.fetchAvatars([...nodes, ...merged], cx);
      } catch (e) {
        this.error = String(e.message ?? e);
        this.loading = false;
      } finally {
        // At least one full turn, so a quick refresh still shows it happened.
        const left = SPIN_MS - (Date.now() - started);
        if (left > 0) await cx.sleep(left);
        this.busy = false;
        setShared("gh.loading.prs", false);
      }
      cx.notify();
    });
  }

  async fetchAvatars(nodes, cx) {
    if (await fetchAvatars(nodes, this.avatars)) cx.notify();
  }

  row(t, pr) {
    return prRow(t, pr, this.avatars, { mx: 8 });
  }

  header(t, key, label, count) {
    const open = !this.folded.has(key);
    return h_flex()
      .id(`sec-${key}`)
      .h(30).px(18).gap(7).items_center().flex_none().cursor_pointer()
      .bg("#ffffff06") // white ~2.5%: a faint band over the panel
      .text_color(count ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { open ? this.folded.add(key) : this.folded.delete(key); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
      .child(div().text_size(13).font_medium().child(label))
      .child(div().text_size(12).text_color(t.muted).child(String(count)));
  }

  syncButton(t) {
    const spinning = this.busy || Boolean(shared("gh.loading.github"));
    return div().id("pr-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(spinning ? "Refreshing…" : "Refresh")
      .on_click((_e, cx) => this.refresh(cx))
      .child(spinning ? svg("mods/prs/refresh.svg").size(13).spin(SPIN_MS) : svg("mods/prs/refresh.svg").size(13));
  }

  // One sidebar group's PRs, as a flat list.
  filtered(t, f) {
    const pill = (text) => div().h(20).px(7).rounded(5).border(1).border_color(t.border).flex().items_center().text_size(10.5).text_color(t.muted).child(text);
    return v_flex()
      .size_full().min_h(0)
      .bg(t.chrome).overflow_hidden()
      .text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_color(t.foreground).child("Pull requests"))
        .child(pill(`${f.label} · ${f.prs.length}`))
        .child(div().flex_1())
        .child(div().id("pr-all").h(24).px(7).gap(5).flex_none().flex().items_center().rounded(6).text_size(11.5).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Show all pull requests")
          .on_click(() => setShared("prs.filter", null))
          .child(svg("mods/workspace-chrome/x.svg").size(12)).child("All"))
        .child(this.syncButton(t)))
      .child(v_flex().id("pr-filtered").flex_1().min_h(0).pt(6).overflow_y_scrollbar()
        .when(!f.prs.length, (el) => el.child(div().px(14).py(10).text_size(12).text_color(t.dim).child("No pull requests in this group.")))
        .children(f.prs.map((pr) => this.row(t, pr))));
  }

  render() {
    const t = theme();
    const f = shared("prs.filter");
    if (f?.prs) return this.filtered(t, f);
    const sections = this.sections ?? {};
    const total = SECTIONS.reduce((n, [k]) => n + (k === "mergedToday" ? 0 : sections[k]?.length ?? 0), 0);
    const pill = (text) => div().h(20).px(7).rounded(5).border(1).border_color(t.border).flex().items_center().text_size(10.5).text_color(t.muted).child(text);
    const body = [];
    for (const [key, label] of SECTIONS) {
      const list = sections[key] ?? [];
      if (!list.length) continue;
      body.push(header(this, t, key, label, list.length));
      if (!this.folded.has(key)) for (const pr of list) body.push(this.row(t, pr));
    }
    return v_flex()
      .size_full().min_h(0)
      .bg(t.chrome).overflow_hidden()
      .text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_color(t.foreground).child("Pull requests"))
        .when(this.sections !== null, (el) => el.child(pill(`${total} open · last 30d`)))
        .child(div().flex_1())
        .child(div().text_size(11.5).text_color(t.dim).child("github.com"))
        .child(this.syncButton(t)))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).border_b(1).border_color(t.border).child(this.error)))
      .when(this.loading && this.sections === null, (el) => el.child(div().px(14).py(10).text_size(12).text_color(t.dim).child("Loading…")))
      .when(this.sections !== null && !body.length, (el) => el.child(div().px(14).py(10).text_size(12).text_color(t.dim).child("No pull requests waiting on you.")))
      .when(this.sections !== null, (el) => el.child(v_flex().id("pr-list").flex_1().min_h(0).overflow_y_scrollbar().children(body)));
  }
}

const header = (view, t, key, label, count) => view.header(t, key, label, count);
