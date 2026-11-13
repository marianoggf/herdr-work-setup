// One pull request row, drawn the same in the PRs panel (mods/prs) and the GitHub sidebar
// section: mods/github/row.js is a hard link to this file (Herdr refuses symlinks out of a mod),
// so edit it in place; a save that replaces the file breaks the link. Avatars: mods/prs/avatars.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, readTextFile } from "herdr";
import { mkdir, exists } from "fs/promises";

export const AVATARS = "mods/prs/avatars";

// The word most repo names here start with ("acme" for acme-api), from the untracked
// ~/.config/herdr-app/local.json: { "repoPrefix": "acme" }. A row leaves it out to save room.
let prefix = null; // null until local.json has been asked for
function repoName(name) {
  if (prefix === null) {
    prefix = "";
    readTextFile(`${appHome()}/local.json`).then((text) => { prefix = String(JSON.parse(text || "{}").repoPrefix ?? "").toLowerCase(); }).catch(() => {});
  }
  return prefix && name.toLowerCase().startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : name;
}

export function age(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const ciState = (pr) => pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;

export function statusWord(pr) {
  const entry = pr.isInMergeQueue ? pr.mergeQueueEntry : null;
  if (entry) {
    if (entry.state === "UNMERGEABLE") return ["Can't merge", "blocked"];
    if (entry.state === "MERGEABLE") return ["Merging", "done"];
    return [entry.position ? `Queued #${entry.position}` : "Queued", "muted"];
  }
  if (pr.merged) return ["Merged", "done"];
  if (pr.isDraft) return ["Draft", "dim"];
  if (pr.mergeable === "CONFLICTING") return ["Conflicts", "blocked"];
  if (pr.reviewDecision === "CHANGES_REQUESTED") return ["Changes requested", "blocked"];
  if (pr.reviewDecision === "APPROVED") return ["Approved", "done"];
  return ["Review required", "muted"];
}

// The PR icon, as GitHub draws it: gray draft, green open, yellow in the
// merge queue, purple merged, red closed, each with its Octicon (gh-<state>.svg,
// from @primer/octicons 19.15.0). Review and CI state stay in the status word
// and the check mark. GitHub's Primer colors, light and dark.
const GITHUB = {
  dark: { draft: "#9198a1", open: "#3fb950", queued: "#d29922", merged: "#ab7df8", closed: "#f85149" },
  light: { draft: "#59636e", open: "#1a7f37", queued: "#9a6700", merged: "#8250df", closed: "#d1242f" },
};

function prState(pr) {
  if (pr.merged) return "merged";
  if (pr.closed) return "closed";
  if (pr.isInMergeQueue) return "queued";
  if (pr.isDraft) return "draft";
  return "open";
}

function isDark(t) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(t.chrome ?? t.background ?? "");
  if (!m) return true;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

const iconColor = (t, pr) => GITHUB[isDark(t) ? "dark" : "light"][prState(pr)];

// Checks by outcome, as GitHub counts them: cancelled and stale runs don't count.
const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAIL = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const WAIT = new Set(["PENDING", "EXPECTED", "IN_PROGRESS", "QUEUED", "WAITING"]);
export function checks(pr) {
  const c = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  const counts = [...(c?.checkRunCountsByState ?? []), ...(c?.statusContextCountsByState ?? [])];
  const sum = (set) => counts.filter((x) => set.has(x.state)).reduce((n, x) => n + x.count, 0);
  const pass = sum(PASS), fail = sum(FAIL), wait = sum(WAIT);
  return { pass, fail, wait, total: pass + fail + wait };
}

// Fetches the authors' avatars not in `known` (login -> true | false) into AVATARS; true when one changed.
export async function fetchAvatars(nodes, known) {
  const dir = `${appHome()}/${AVATARS}`;
  try { await mkdir(dir, { recursive: true }); } catch {}
  let changed = false;
  for (const pr of nodes) {
    const login = pr.author?.login, url = pr.author?.avatarUrl;
    if (!login || login in known) continue;
    const file = `${dir}/${login}.png`;
    try {
      if (!(await exists(file))) {
        if (!url) throw new Error("no url");
        const sep = url.includes("?") ? "&" : "?";
        const r = await exec("curl", ["-fsSL", "--max-time", "10", `${url}${sep}s=64`, "-o", file]);
        if (r.code !== 0) throw new Error(r.stderr);
      }
      known[login] = true;
    } catch {
      known[login] = false;
    }
    changed = true;
  }
  return changed;
}

function avatar(t, login, known) {
  if (login && known[login]) return image(`${AVATARS}/${login}.png`).size(18).flex_none().rounded_full();
  return div().size(18).flex_none().rounded_full().bg(t.raised).border(1).border_color(t.border).flex().items_center().justify_center()
    .text_size(9.5).font_semibold().text_color(t.muted).child((login ?? "?")[0].toUpperCase());
}

// `known` is the avatar cache; `mx` the row's side margin (the panel's list has no padding of its own).
export function prRow(t, pr, known, { mx = 0 } = {}) {
  const [word, tone] = statusWord(pr);
  const ck = checks(pr);
  const comments = pr.totalCommentsCount ?? 0;
  return v_flex()
    .id(`pr-${pr.repository.nameWithOwner}-${pr.number}`)
    .mx(mx).px(10).py(6).gap(3).rounded(8).flex_none().cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => { exec("open", [pr.url]); })
    .child(h_flex().gap(8).items_center()
      .child(svg(`mods/prs/gh-${prState(pr)}.svg`).size(14).flex_none().text_color(iconColor(t, pr)))
      .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).child(pr.title))
      .child(avatar(t, pr.author?.login, known)))
    .child(h_flex().pl(22).gap(8).items_center().text_size(11.5).text_color(t.dim)
      .child(div().min_w(0).truncate().child(`${repoName(pr.repository.name)} · #${pr.number} · ${age(pr.merged ? pr.mergedAt : pr.updatedAt)}`))
      .when(ck.total > 0 && !pr.merged, (el) => el.child(h_flex().flex_none().gap(3).items_center()
        .child(div().text_color(ck.fail ? t.blocked : ck.wait ? "#d29922" : t.done).child(ck.fail ? "✗" : ck.wait ? "•" : "✓"))
        .child(`${ck.pass}/${ck.total}`)))
      .when(comments > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center()
        .child(svg("mods/github/comment.svg").size(11))
        .child(String(comments))))
      .child(div().flex_1())
      .child(div().flex_none().text_color(t[tone] ?? t.muted).child(word)));
}
