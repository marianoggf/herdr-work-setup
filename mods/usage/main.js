// Usage: how much of the Claude and Codex rate limits is used, the way Orca's Usage
// panel shows it: the 5-hour session window, the weekly one and Fable's, each with when
// it resets. Claude is asked of Anthropic with the chosen account's Claude Code sign-in
// (macOS Keychain), Codex of ChatGPT with ~/.codex/auth.json. Asked every five minutes
// while the window is in front, and on the refresh button. An expired sign-in is left
// for the agent itself to renew.
//
// Claude accounts: the system default (~/.claude) plus each account Orca keeps under
// ~/Library/Application Support/orca/claude-profiles. The one picked in the popup is
// written to ~/.config/herdr-app/state/claude-account, and bin/claude-account (the
// `claude` launcher in programs.json) starts new sessions with CLAUDE_CONFIG_DIR set to it.
// Each account keeps its own spaces: switching saves and closes the open ones, and opens the
// ones the new account had when it was left (workspaces.js).

import * as fs from "fs/promises";
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { loader } from "./loader.js";
import { exec, run, home, readTextFile, writeTextFile, theme, window, layout, props, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { working, leave, arrive } from "./workspaces.js";

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
const BLOCK = "usage", TITLE = 41, PAD = 10;
const blockPx = () => find(layout(), BLOCK)?.size?.px;
const folded = () => blockPx() === TITLE;
const toggleFold = () => run("layout.resize", folded() ? { id: BLOCK, weight: 1 } : { id: BLOCK, px: TITLE });
function fit(content) {
  const px = Math.round(Math.min(TITLE + content + PAD, (globalThis.window?.viewport_size?.()?.height ?? Infinity) * 0.4));
  if (Math.abs((blockPx() ?? 0) - px) > 1) run("layout.resize", { id: BLOCK, px });
}

const EVERY = 300000;
const STATE_DIR = () => `${home()}/.config/herdr-app/state`;
const CHOICE = () => `${STATE_DIR()}/claude-account`;
const PROFILES = () => `${home()}/Library/Application Support/orca/claude-profiles`;

// Everything both copies of this mod (the sidebar and the details popup) read and write.
const state = () => shared("usage") ?? {};
const publish = (patch) => setShared("usage", { ...state(), ...patch });
const key = (id, account) => (id === "claude" ? `claude|${account ?? ""}` : id);

// Epoch seconds, epoch milliseconds or an ISO date, as milliseconds.
function when(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e10 ? n : n * 1000;
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : d;
}
const usage = (pct, resets, minutes, name) =>
  typeof pct === "number" && Number.isFinite(pct) ? { pct: Math.min(100, Math.max(0, pct)), resets: when(resets), minutes, name } : null;

// Fable's own weekly limit: a scoped entry in `limits`, or one of the older top-level keys.
function fable(d) {
  const l = (Array.isArray(d.limits) ? d.limits : []).find((l) =>
    l?.kind === "weekly_scoped" && l.scope?.model?.display_name?.trim().toLowerCase() === "fable");
  if (l) return usage(l.percent, l.resets_at, 10080, "F");
  const w = d.fable_weekly ?? d.fable_seven_day ?? d.seven_day_fable;
  return usage(w?.utilization ?? w?.used_percentage, w?.resets_at, 10080, "F");
}

function failure(status, who) {
  if (status === 401 || status === 403) return `Sign-in expired: open ${who} to renew it`;
  if (status === 429) return "Rate limited, trying again later";
  return `${who} usage answered ${status}`;
}

// Claude Code keeps a CLAUDE_CONFIG_DIR's sign-in under its own Keychain name, suffixed with
// the first 8 hex digits of the folder's SHA-256.
async function keychainName(dir) {
  if (!dir) return "Claude Code-credentials";
  const h = await exec("sh", ["-c", 'printf %s "$1" | shasum -a 256', "sh", dir]);
  return `Claude Code-credentials-${h.stdout.trim().slice(0, 8)}`;
}

async function claude(dir) {
  const k = await exec("security", ["find-generic-password", "-s", await keychainName(dir), "-w"]);
  if (k.code !== 0) throw new Error("Not signed in to Claude Code");
  const token = JSON.parse(k.stdout).claudeAiOauth?.accessToken;
  if (!token) throw new Error("Not signed in to Claude Code");
  const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!r.ok) throw new Error(failure(r.status, "Claude Code"));
  const d = await r.json();
  return [usage(d.five_hour?.utilization, d.five_hour?.resets_at, 300), usage(d.seven_day?.utilization, d.seven_day?.resets_at, 10080), fable(d)];
}

async function codex() {
  const text = await readTextFile(`${home()}/.codex/auth.json`);
  const tokens = text ? JSON.parse(text).tokens : null;
  if (!tokens?.access_token) throw new Error("Not signed in to Codex");
  const headers = { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "codex-cli", "OpenAI-Beta": "codex-1" };
  if (tokens.account_id) headers["ChatGPT-Account-Id"] = tokens.account_id;
  const r = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (!r.ok) throw new Error(failure(r.status, "Codex"));
  const d = await r.json();
  const win = (w) => usage(w?.used_percent, w?.reset_at, w?.limit_window_seconds ? Math.ceil(w.limit_window_seconds / 60) : null);
  return [win(d.rate_limit?.primary_window), win(d.rate_limit?.secondary_window)];
}

// The signed-in email, as /which-account reads it, of each Claude account there is.
async function claudeEmail(file) {
  try {
    const text = await readTextFile(file);
    return text ? JSON.parse(text).oauthAccount?.emailAddress ?? null : null;
  } catch {
    return null;
  }
}

async function claudeAccounts() {
  const list = [{ dir: null, email: await claudeEmail(`${home()}/.claude.json`) }];
  const names = await fs.readdir(PROFILES()).catch(() => []);
  for (const name of names.sort()) {
    const dir = `${PROFILES()}/${name}/home`;
    const email = await claudeEmail(`${dir}/.claude.json`);
    if (email) list.push({ dir, email });
  }
  return list;
}

async function chosenAccount(accounts) {
  const dir = (await readTextFile(CHOICE()).catch(() => null))?.trim() || null;
  return accounts.some((a) => a.dir === dir) ? dir : null;
}

// The window's background follows the Claude account, by its email, from the untracked
// ~/.config/herdr-app/local.json: { "accountBackgrounds": { "me@work.example": null, "me@home.example": "#1b1a4a" } }.
// null keeps the theme's own, an account that isn't listed gets black, and without the map
// nothing is painted. Written as settings.json `colors`, which Herdr applies live.
const SETTINGS = () => `${home()}/.config/herdr-app/settings.json`;
const LOCAL = () => `${home()}/.config/herdr-app/local.json`;
const PAINTED = ["background", "canvas", "chrome"];

async function paint(dir) {
  let backgrounds = null;
  try { backgrounds = JSON.parse((await readTextFile(LOCAL())) || "{}").accountBackgrounds ?? null; } catch {}
  if (!backgrounds) return;
  const email = (state().accounts ?? []).find((a) => a.dir === dir)?.email;
  const color = email in backgrounds ? backgrounds[email] : "#000000";
  const text = await readTextFile(SETTINGS());
  const settings = text ? JSON.parse(text) : {};
  const colors = { ...(settings.colors ?? {}) };
  for (const k of PAINTED) {
    if (color) colors[k] = color;
    else delete colors[k];
  }
  if (JSON.stringify(colors) === JSON.stringify(settings.colors ?? {})) return;
  if (Object.keys(colors).length) settings.colors = colors;
  else delete settings.colors;
  await writeTextFile(SETTINGS(), JSON.stringify(settings, null, 2), text);
}

// Makes `dir` the Claude account: for the row, for bin/claude-account, for the background, and
// for its usage, asked unless a fresh answer is kept.
async function commit(dir) {
  publish({ account: dir });
  await paint(dir);
  await fs.mkdir(STATE_DIR(), { recursive: true });
  await fs.writeFile(CHOICE(), dir ?? "");
  const kept = state().results?.[key("claude", dir)];
  if (!kept || Date.now() - (kept.at ?? 0) > EVERY) await load("claude", dir);
}

// Leaves the current account's spaces saved and closed, then opens `dir`'s. One switch at a time.
async function switchTo(dir) {
  if (state().switching) return;
  publish({ switching: true });
  try {
    await leave(state().account ?? null, state().accounts ?? []);
    await commit(dir);
    await arrive(dir);
  } finally {
    publish({ switching: false });
  }
}

// Codex's email is in its sign-in's id_token.
async function codexEmail() {
  const text = await readTextFile(`${home()}/.codex/auth.json`);
  const part = (text ? JSON.parse(text).tokens?.id_token : null)?.split(".")[1];
  if (!part) return null;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let bits = 0, value = 0, json = "";
  for (const c of part.replace(/\+/g, "-").replace(/\//g, "_")) {
    const i = chars.indexOf(c);
    if (i < 0) continue;
    value = ((value << 6) | i) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      json += String.fromCharCode((value >> bits) & 255);
    }
  }
  const claims = JSON.parse(json);
  return claims.email ?? claims["https://api.openai.com/profile"]?.email ?? null;
}

const PROVIDERS = [
  { id: "claude", name: "Claude", icon: "icons/claude.svg" },
  { id: "codex", name: "Codex", icon: "icons/codex.svg" },
];

// One provider's usage for the current account, merged into the shared results. A failed ask
// keeps the last numbers it had.
async function load(id, account) {
  const k = key(id, account);
  const before = state().results?.[k];
  const email = id === "codex" ? await codexEmail().catch(() => before?.email ?? null) : null;
  let next;
  try {
    next = { windows: (await (id === "claude" ? claude(account) : codex())).filter(Boolean), email, error: null, at: Date.now() };
  } catch (e) {
    next = { windows: before?.windows ?? [], email, error: String(e.message ?? e), at: Date.now() };
  }
  publish({ results: { ...state().results, [k]: next } });
}

function emailOf(id) {
  const s = state();
  if (id === "codex") return s.results?.codex?.email ?? null;
  return (s.accounts ?? []).find((a) => a.dir === (s.account ?? null))?.email ?? null;
}

// "w" for a weekly window, "m" for a monthly one (Codex's 30 days), "d" for any other, the
// 5-hour session included.
const label = (minutes) => (minutes === 10080 ? "w" : minutes >= 40320 ? "m" : "d");

function until(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Hours or days with one decimal, the way the row has room for: 3:30 is "3,5h".
function short(ms) {
  const m = Math.max(0, (ms - Date.now()) / 60000);
  const one = (v, unit) => `${String(Math.round(v * 10) / 10).replace(".", ",")}${unit}`;
  if (m < 60) return `${Math.round(m)}m`;
  return m < 1440 ? one(m / 60, "h") : one(m / 1440, "d");
}

// What the details popup calls a window.
function title(w) {
  if (w.name === "F") return "Fable";
  if (w.minutes === 300) return "Session";
  if (w.minutes === 10080) return "Weekly";
  if (w.minutes >= 40320) return "Monthly";
  return w.minutes ? `${Math.round(w.minutes / 1440)}-day` : "Limit";
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : `${m}m ago`;
}

const tone = (pct, t, normal) => (pct >= 90 ? t.blocked : pct >= 75 ? "#d29922" : normal);

export default class Usage extends View {
  init(_props, cx) {
    // The details popup and the switch dialog are other copies of this mod: they work on what
    // the sidebar copy shares.
    if (props()?.detail || props()?.switched) return;
    // The last answers and when they were asked survive reloads, which would otherwise ask again
    // and run into the endpoints' rate limits.
    this.loading = false;
    const results = JSON.parse(localStorage.getItem("results") ?? "{}");
    // Saved before accounts existed: that answer was the system default's.
    if (results.claude && !results["claude|"]) results["claude|"] = results.claude;
    delete results.claude;
    publish({
      results,
      asked: Number(localStorage.getItem("asked") ?? 0),
      // Shared values persist, so a switch cut short by a restart mustn't block the next one.
      switching: false,
    });
    cx.spawn(async (cx) => {
      const accounts = await claudeAccounts();
      publish({ accounts, account: await chosenAccount(accounts) });
      await paint(state().account ?? null);
      if (!folded() && Date.now() - state().asked > EVERY) this.refresh(cx);
      cx.notify();
    });
    cx.timer.every(15000, (cx) => {
      this.save();
      // The saved choice is what bin/claude-account starts with, so the row follows the file.
      cx.spawn(async (cx) => {
        const account = await chosenAccount(state().accounts ?? []);
        if (account !== (state().account ?? null)) {
          publish({ account });
          await paint(account);
          cx.notify();
        }
      });
      // Folded, nothing is asked until it opens again.
      if (window().active && !folded() && Date.now() - state().asked > EVERY) this.refresh(cx);
    });
    // The "Resets in" times move on their own.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  save() {
    localStorage.setItem("results", JSON.stringify(state().results ?? {}));
    localStorage.setItem("asked", String(state().asked ?? 0));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    publish({ asked: Date.now() });
    cx.notify();
    cx.spawn(async (cx) => {
      const accounts = await claudeAccounts();
      publish({ accounts });
      await Promise.all(PROVIDERS.map((p) => load(p.id, state().account)));
      this.save();
      this.loading = false;
      cx.notify();
    });
  }

  bar(id, w, t) {
    return h_flex().id(id).flex_none().gap(3).items_center()
      .tooltip(w.resets ? `${Math.round(w.pct)}% used, resets in ${until(w.resets)}` : `${Math.round(w.pct)}% used`)
      .child(div().text_color(t.dim).child(w.name ?? label(w.minutes)))
      .child(div().text_color(tone(w.pct, t, t.foreground)).child(`${Math.round(w.pct)}%`))
      .when(Boolean(w.resets), (el) => el.child(div().text_color(t.dim).child(short(w.resets))));
  }

  row(p, t) {
    const s = state();
    const r = s.results?.[key(p.id, s.account)];
    const sub = r?.error ?? (r ? null : "Loading…");
    const accounts = p.id === "claude" ? (s.accounts ?? []).length : 0;
    const height = 56 + (r?.windows.length ?? 0) * 64 + (r?.error ? 36 : 0) + (accounts > 1 ? 48 + accounts * 34 : 0);
    return h_flex().id(`use-${p.id}`).pl(8).pr(4).py(8).my(1).flex_none().gap(4).items_center().rounded(8)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click(() => openOverlay({ mod: "usage", kind: "popup", width: 280, height, props: { detail: p.id } }))
      .child(v_flex().flex_1().min_w(0).gap(6)
        .child(h_flex().gap(8).items_center()
          .child(image(p.icon).w(16).h(16).flex_none())
          .child(div().flex_none().text_size(13).text_color(t.foreground).child(p.name))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(emailOf(p.id) ?? "")))
        .when(Boolean(sub), (el) => el.child(div().pl(24).truncate().text_size(11.5).text_color(r?.error ? t.blocked : t.dim).child(sub)))
        .when(Boolean(r?.windows.length), (el) => el.child(h_flex().flex_wrap().pl(24).gap_x(9).gap_y(4).items_center().text_size(11.5)
          .children(r.windows.map((w, i) => this.bar(`use-${p.id}-${i}`, w, t))))))
      .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim));
  }

  rail(t) {
    const s = state();
    return v_flex().size_full().bg(t.chrome).items_center().pt(10).gap(6)
      .children(PROVIDERS.map((p) => {
        const pct = s.results?.[key(p.id, s.account)]?.windows[0]?.pct;
        return v_flex().items_center().gap(2)
          .child(image(p.icon).w(14).h(14))
          .when(pct != null, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`${Math.round(pct)}%`)));
      }));
  }

  // Picking an account switches at once when no Claude session is mid-turn. Otherwise it asks
  // first: closing a space would cut the turn short, so the dialog waits for them to finish.
  choose(dir, cx) {
    if ((state().account ?? null) === dir || state().switching) return;
    cx.spawn(async (cx) => {
      const busy = await working().catch(() => 0);
      if (!busy) {
        await switchTo(dir);
      } else {
        const name = (d) => (d ? (state().accounts ?? []).find((a) => a.dir === d)?.email : null) ?? "System default";
        openOverlay({ mod: "usage", kind: "dialog", width: 460, height: 230,
          props: { switched: { dir, email: name(dir), from: name(state().account ?? null), busy } } });
      }
      cx.notify();
    });
  }

  switched(sw, t) {
    const left = this.left ?? sw.busy;
    const one = left === 1;
    const button = (id, primary) => h_flex().id(id).h(34).px(14).gap(6).items_center().rounded(8).cursor_pointer()
      .border(1).border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.popover)
      .text_color(primary ? t.solid_foreground : t.foreground).hover((el) => el.opacity(0.9));
    return v_flex().size_full().p(22).gap(14).bg(t.popover).text_size(13)
      .child(div().text_size(16).font_medium().text_color(t.foreground).child(`Switch to ${sw.email}?`))
      .child(div().text_color(t.muted).child(this.waiting
        ? `Waiting for ${left} Claude session${one ? "" : "s"} to finish…`
        : `${left} Claude session${one ? " is" : "s are"} still working. Switching closes every space and opens them again when you come back to ${sw.from}, so it waits for ${one ? "it" : "them"} to finish first.`))
      .child(h_flex().pt(6).justify_between()
        .child(button("use-cancel", false).child("Cancel")
          .on_click(() => { this.cancelled = true; closeOverlay(props().overlay); }))
        .when(!this.waiting, (el) => el.child(button("use-switch", true)
          .on_click((_e, cx) => {
            this.waiting = true;
            cx.notify();
            cx.spawn(async (cx) => {
              for (;;) {
                this.left = await working().catch(() => 0);
                if (this.cancelled) return;
                cx.notify();
                if (!this.left) break;
                await exec("sleep", ["3"]);
              }
              await switchTo(sw.dir);
              closeOverlay(props().overlay);
            });
          })
          .child("Switch when they finish"))));
  }

  accountRow(a, t) {
    const s = state();
    const picked = (s.account ?? null) === a.dir;
    const r = s.results?.[key("claude", a.dir)];
    const glance = (r?.windows ?? []).slice(0, 2).map((w) => `${label(w.minutes)} ${Math.round(w.pct)}%`).join("  ");
    return h_flex().id(`use-acct-${a.dir ?? "default"}`).h(30).px(8).gap(8).items_center().rounded(6)
      .cursor_pointer().when(picked, (el) => el.bg(t.selected)).hover((el) => el.bg(picked ? t.selected : t.hover))
      .on_click((_e, cx) => this.choose(a.dir, cx))
      .child(div().w(12).flex_none().child(picked ? svg("mods/workspace-chrome/check.svg").size(12).text_color(t.foreground) : ""))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.email ?? "Not signed in"))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(a.dir ? glance : "default"));
  }

  detail(id, t) {
    const p = PROVIDERS.find((p) => p.id === id);
    const s = state();
    const r = s.results?.[key(id, s.account)];
    const accounts = id === "claude" ? s.accounts ?? [] : [];
    return v_flex().size_full().p(14).gap(12).bg(t.popover).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(image(p.icon).w(16).h(16).flex_none())
        .child(div().flex_none().text_size(14).text_color(t.foreground).child(p.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(emailOf(id) ?? ""))
        .child(div().text_size(11.5).text_color(t.dim).child(r?.at ? `Updated ${ago(r.at)}` : "")))
      .when(Boolean(r?.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(r.error)))
      .children((r?.windows ?? []).map((w) => v_flex().gap(5)
        .child(div().text_color(t.foreground).child(title(w)))
        .child(div().h(4).rounded(2).bg(t.raised).child(div().h_full().rounded(2).bg(tone(w.pct, t, t.muted)).w(`${Math.max(1, w.pct)}%`)))
        .child(h_flex().justify_between().text_size(11.5).text_color(t.dim)
          .child(`${Math.round(w.pct)}% used`)
          .child(w.resets ? `Resets in ${until(w.resets)}` : ""))))
      .when(accounts.length > 1, (el) => el.child(v_flex().gap(2).pt(10).border_t(1).border_color(t.border)
        .child(div().pb(4).text_size(11.5).font_medium().text_color(t.dim).child("Claude account"))
        .children(accounts.map((a) => this.accountRow(a, t)))));
  }

  render() {
    const t = theme();
    if (props()?.switched) return this.switched(props().switched, t);
    if (props()?.detail) return this.detail(props().detail, t);
    if (narrow()) return this.rail(t);
    const asked = state().asked;
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(41).px(16).flex_none().items_center().justify_between()
        .child(h_flex().id("use-fold").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
          .text_size(11.5).font_medium().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            // Opening asks again, unless the last answer is under a minute old (the usage endpoint rate limits).
            if (folded() && Date.now() - (state().asked ?? 0) > 60000) this.refresh(cx);
            toggleFold();
          })
          .child(svg(`mods/workspace-chrome/chevron-${folded() ? "right" : "down"}.svg`).size(10).flex_none())
          .child("Usage"))
        .when(!folded(), (el) => el.child(div().id("use-refresh").flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(this.loading ? "Refreshing…" : asked ? `Updated ${ago(asked)}` : "Refresh")
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.loading
            ? loader(theme(), 20)
            : svg("mods/github/refresh.svg").size(13)))))
      .when(!folded(), (el) => el.child(v_flex().id("use-list").flex_1().min_h(0).px(8).pb(10).overflow_y_scrollbar().mode("always")
        .child(v_flex().id("use-content").flex_none().on_size_change((s) => fit(s.height)).children(PROVIDERS.map((p) => this.row(p, t))))));
  }
}
