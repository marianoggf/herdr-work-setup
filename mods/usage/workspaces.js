// Each Claude account keeps its own workspace. Leaving an account saves the spaces open on
// this computer (names, colors, tabs, panes, folders and each pane's Claude conversation)
// to state/claude-workspaces.json and closes them; coming back to it opens them again, every
// Claude pane resuming its conversation. Conversations live in ~/.claude/projects, which the
// Orca profiles link to, so any account can resume them. Other programs come back as a shell
// in their folder, and a tab's extra panes come back side by side.

import * as fs from "fs/promises";
import { exec, home, readTextFile, spaces, shared, setShared, run } from "herdr";

const HERDR = "/Users/mariano/.local/bin/herdr-app";
const HC = "/Users/mariano/.local/bin/hc";
const FILE = () => `${home()}/.config/herdr-app/state/claude-workspaces.json`;
const LAUNCHER = () => `${home()}/.config/herdr-app/bin/claude-account`;
const slot = (dir) => dir ?? "default";

const json = async (command, args) => JSON.parse((await exec(command, args)).stdout);
const listed = async () => ((await json(HERDR, ["ls"])).spaces ?? []).filter((s) => !s.machine);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

// Runs an app command and returns the IDs it made.
async function make(command, args) {
  const r = await json(HERDR, ["do", command, JSON.stringify(clean(args))]);
  if (r.error) throw new Error(`${command}: ${r.error}`);
  return r;
}

const readAll = async () => JSON.parse((await readTextFile(FILE()).catch(() => null)) || "{}");
const writeAll = (all) => fs.writeFile(FILE(), JSON.stringify(all, null, 2));

// How many Claude sessions in this computer's spaces are mid-turn.
export async function working() {
  let n = 0;
  for (const s of await listed())
    for (const t of s.tabs ?? []) for (const e of t.terminals ?? []) if (e.status === "working") n++;
  return n;
}

// The conversation a Claude process runs: it writes sessions/<pid>.json into its account's folder.
async function sessionOf(pid, accounts) {
  for (const a of accounts) {
    const text = await readTextFile(`${a.dir ?? `${home()}/.claude`}/sessions/${pid}.json`).catch(() => null);
    if (text) return JSON.parse(text).sessionId ?? null;
  }
  return null;
}

async function pane(entry, accounts) {
  const t = await json(HC, ["get", entry.terminal, "--json"]).catch(() => null);
  const cwd = t?.foreground?.cwd ?? t?.cwd ?? null;
  if (entry.app !== "claude-code") return { cwd };
  return { cwd, claude: t?.foreground?.pid ? await sessionOf(t.foreground.pid, accounts) : null };
}

async function snapshot(accounts) {
  const info = new Map(spaces().map((s) => [s.id, s]));
  const colors = shared("space.colors") ?? {};
  // my-tabs names tabs after their conversation; only a name someone typed is kept.
  const auto = shared("tab-titles.set") ?? {};
  const out = [];
  for (const s of await listed()) {
    const own = new Map((info.get(s.id)?.tabs ?? []).map((t) => [t.id, t.named && auto[t.id] !== t.name]));
    const tabs = [];
    for (const t of s.tabs ?? []) {
      const panes = [];
      for (const e of t.terminals ?? []) panes.push(await pane(e, accounts));
      if (panes.length) tabs.push({ name: own.get(t.id) ? t.name : null, active: t.active, settled: t.settled, panes });
    }
    out.push({ id: s.id, name: info.get(s.id)?.named ? s.name : null, folder: s.folder, color: colors[s.id] ?? null, active: s.active, tabs });
  }
  return out;
}

// A Claude pane resumes its conversation (or starts a new one when none was found); others get a shell.
const argv = (p) => ("claude" in p ? [LAUNCHER(), ...(p.claude ? ["--resume", p.claude] : [])] : null);

async function paneOf(terminal) {
  for (const s of await listed())
    for (const t of s.tabs ?? []) for (const e of t.terminals ?? []) if (e.terminal === terminal) return e.pane;
  return null;
}

async function splits(tab, made) {
  let pane = await paneOf(made.terminal);
  for (const p of tab.panes.slice(1)) {
    if (!pane) return;
    const r = await make("pane.split", { direction: "right", pane, argv: argv(p) });
    pane = (await paneOf(r.terminal)) ?? pane;
  }
}

async function reopen(saved) {
  const colors = { ...(shared("space.colors") ?? {}) };
  let shown = null;
  for (const s of saved) {
    const [first, ...rest] = s.tabs;
    if (!first) continue;
    const made = await make("space.new", { name: s.name, folder: first.panes[0].cwd ?? s.folder, tab: first.name, argv: argv(first.panes[0]), machine: "" });
    const tabs = [{ saved: first, id: made.tab }];
    await splits(first, made);
    for (const t of rest) {
      const r = await make("tab.new", { space: made.space, name: t.name, folder: t.panes[0].cwd ?? s.folder, argv: argv(t.panes[0]) });
      tabs.push({ saved: t, id: r.tab });
      await splits(t, r);
    }
    for (const t of tabs) if (t.saved.settled) run("tab.settle", { id: t.id });
    const active = tabs.find((t) => t.saved.active && !t.saved.settled);
    if (active) run("tab.select", { id: active.id });
    if (s.color) colors[made.space] = s.color;
    if (s.active) shown = made.space;
  }
  setShared("space.colors", colors);
  if (shown) run("space.select", { id: shown });
}

// Saves the open spaces as `dir`'s workspace, then closes them. Nothing closes when saving fails.
export async function leave(dir, accounts) {
  const saved = await snapshot(accounts);
  const all = await readAll();
  all[slot(dir)] = saved;
  await writeAll(all);
  for (const s of saved) run("space.close", { id: s.id, confirmed: true });
}

// Opens `dir`'s saved workspace, and forgets it once it's open again.
export async function arrive(dir) {
  const all = await readAll();
  const saved = all[slot(dir)];
  if (saved?.length) await reopen(saved);
  delete all[slot(dir)];
  await writeAll(all);
}
