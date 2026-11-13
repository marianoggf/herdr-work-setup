// "Delete worktree and branch" with an undo instead of a confirm, like closing a tab with an agent.
// The space menu's item runs "my-tabs.delete-worktree:<space id>". The space is hidden at once
// (listed in shared "spaces.deleting", which mods/workspaces leaves out), and its terminals, its
// worktree folder and its local branch go UNDO ms later, unless the snackbar's Undo
// ("my-tabs.undo-delete:<space id>", drawn by mods/my-toast) brings it back.
// When it can't be deleted (the main checkout, no branch checked out), mods/my-worktree's dialog
// opens instead and says why. The git helpers are copies of my-worktree's: mods can't import
// each other's files.

import { spaces, panes, run, openOverlay, exec, shared, setShared, notify } from "herdr";

const UNDO = 7500;
export const deleting = () => shared("spaces.deleting") ?? {}; // space id -> { name, branch, top, main, machine, space, until }
function setDeleting(id, entry) {
  const next = { ...deleting() };
  if (entry) next[id] = entry; else delete next[id];
  setShared("spaces.deleting", next);
}
// The pending deletes' timers, kept on globalThis so a reload of this file can still cancel them.
const timers = () => (globalThis.myTabsDeleteTimers ??= new Map());

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// The repo a folder belongs to: its main checkout, and whether the folder is a linked worktree.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, linked: main !== top.out };
}

// The submodule repos git keeps for a checkout, nested ones too: { name, dir, pinned }.
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out;
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue;
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist nowhere else.
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (local.ok && local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

function dialog(spaceId) {
  openOverlay({ mod: "my-worktree", kind: "dialog", width: 460, height: 280, props: { space: spaceId, action: "delete" } });
}

// What goes with it that exists nowhere else, for the snackbar.
async function risks(top, branch, on) {
  const out = [];
  const status = await git(top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
  if (status.ok && status.out) out.push("uncommitted changes");
  const local = Number((await git(top, ["rev-list", "--count", branch, "--not", "--remotes"], on)).out) || 0;
  if (local) out.push(`${local} unpushed commit${local === 1 ? "" : "s"}`);
  const { unpushed } = await submodules(top, on).catch(() => ({ unpushed: [] }));
  if (unpushed.length) out.push(`unpushed commits in ${unpushed.join(", ")}`);
  return out;
}

// The space shown instead while it waits: the one above it, else the one below.
function selectAnother(id) {
  const gone = deleting();
  const sp = spaces();
  const i = sp.findIndex((s) => s.id === id);
  const other = [...sp.slice(0, i).reverse(), ...sp.slice(i + 1)].find((s) => !gone[s.id] && s.id !== id);
  if (other) run("space.select", { id: other.id });
}

export function scheduleDelete(id, ms, cx) {
  timers().get(id)?.cancel();
  timers().set(id, cx.timer.after(Math.max(0, ms), (cx) => { cx.spawn(() => finishDelete(id), { owner: null }); }, { owner: null }));
}

export function deleteWorktree(id, cx) {
  const space = spaces().find((s) => s.id === id);
  if (!space || deleting()[id]) return;
  const on = space.machine ?? null;
  cx.spawn(async (cx) => {
    try {
      const folder = place(space);
      const repo = folder && (await repoOf(folder, on));
      const head = repo?.linked && (await git(repo.top, ["symbolic-ref", "--short", "-q", "HEAD"], on));
      if (!head?.ok || !head.out) return dialog(id);
      const branch = head.out;
      const warn = await risks(repo.top, branch, on);
      if (!spaces().some((s) => s.id === id) || deleting()[id]) return;
      if (space.active || spaces().find((s) => s.id === id)?.active) selectAnother(id);
      setDeleting(id, { name: space.name, branch, top: repo.top, main: repo.main, machine: on, until: Date.now() + UNDO });
      scheduleDelete(id, UNDO, cx);
      notify({
        title: `Deleted ${branch}${warn.length ? ` · ${warn.join(", ")}` : ""}`,
        timeout: UNDO,
        action: { name: `my-tabs.undo-delete:${id}` },
      });
    } catch {
      dialog(id);
    }
  }, { owner: null });
}

async function finishDelete(id) {
  timers().delete(id);
  const entry = deleting()[id];
  if (!entry) return;
  const { branch, top, main, machine: on } = entry;
  const fail = (message) => notify({ title: `Couldn't delete ${branch}`, body: message, level: "error", timeout: 10000 });
  try {
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    if (spaces().some((s) => s.id === id)) run("space.close", { id, confirmed: true });
    const status = await git(top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
    const { mods } = await submodules(top, on).catch(() => ({ mods: [] }));
    // git refuses a dirty worktree, or one with submodules, unless forced; the snackbar named what goes.
    const force = !status.ok || status.out !== "" || mods.length > 0;
    const r = await git(main, ["worktree", "remove", ...(force ? ["--force"] : []), top], on, 600_000);
    if (!r.ok) return fail(r.err || "git worktree remove failed.");
    const b = await git(main, ["branch", "-D", branch], on);
    if (!b.ok) fail(`The worktree is gone, but the branch stays: ${b.err || "git branch -D failed."}`);
  } catch (error) {
    fail(String(error));
  } finally {
    setDeleting(id, null);
  }
}

export function undoDelete(id) {
  timers().get(id)?.cancel();
  timers().delete(id);
  if (!deleting()[id]) return;
  setDeleting(id, null);
  if (spaces().some((s) => s.id === id)) run("space.select", { id });
}

// Deletes still pending from before a restart or reload: finish them when due, else wait on.
export function resumeDeletes(cx) {
  for (const [id, entry] of Object.entries(deleting())) if (!timers().has(id)) scheduleDelete(id, entry.until - Date.now(), cx);
}
