// New workspace dialog: pick a repo from the projects folder, type a name, a
// branch, a GitHub PR (link or #123) or a Linear ticket (ENG-123 or its link),
// and get a worktree with Claude running in it. New branches start from a
// freshly fetched origin default branch. A branch already checked out somewhere
// opens that checkout instead of making another one.
//
// Settings live in config.json next to this file, read again every time the
// dialog opens. The Linear API key is the macOS Keychain item
// "herdr-linear-api-key".

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home, appHome, readTextFile, focused } from "herdr";

const KEYCHAIN_ITEM = "herdr-linear-api-key";
const ROOT = () => `${home()}/.herdr/worktrees`;
const expand = (path) => path.replace(/^~(?=\/|$)/, home());
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

async function git(cwd, args) {
  const r = await exec("git", args, { cwd });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// What the typed text points at. Anything that isn't a PR or a ticket is a
// branch name (used as is when it exists) or a name for a new branch.
function parse(text) {
  const s = text.trim();
  let m;
  if ((m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/))) return { kind: "pr", owner: m[1], repo: m[2], number: m[3] };
  if ((m = s.match(/^#(\d+)$/))) return { kind: "pr", number: m[1] };
  if ((m = s.match(/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/))) return { kind: "linear", id: m[1].toUpperCase() };
  if ((m = s.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/))) return { kind: "linear", id: m[1].toUpperCase(), maybeName: true };
  return { kind: "name", text: s };
}

// The space showing a checkout: its first terminal is inside it.
function spaceAt(path) {
  const ps = panes();
  return spaces().find((s) => {
    if (s.machine) return false;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    return at === path || at?.startsWith(path + "/");
  });
}

export default class NewWorkspace extends View {
  init(_props, cx) {
    this.config = null;
    this.projects = undefined; // [{ name, path, pinned }], undefined while reading
    this.project = null;
    this.base = "origin/main";
    this.refs = new Set(); // local and origin branch names of the chosen project
    this.listOpen = false;
    this.at = 0;
    this.text = "";
    this.busy = false;
    this.step = "";
    this.error = "";
    this.input = InputState.new({ placeholder: "Name, branch, PR link or #123, Linear ticket or link" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => (this.listOpen ? this.pick(this.rows()[this.at], cx) : this.go(cx)));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try { await this.load(); } catch (error) { this.projects = []; this.error = String(error); }
      cx.notify();
    });
  }

  // Everything is read fresh on every open: the config, the projects folder,
  // the branches. Nothing is cached between opens.
  async load() {
    const raw = await readTextFile(`${appHome()}/mods/new-workspace/config.json`);
    this.config = raw ? JSON.parse(raw) : {};
    const dir = expand(this.config.projects ?? "~/Projects");
    const ls = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -d "$d.git" ] && basename "$d"; done; true', "sh", dir]);
    const names = (ls.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    const pinned = (this.config.pinned ?? []).filter((n) => names.includes(n));
    const rest = names.filter((n) => !pinned.includes(n)).sort((a, b) => a.localeCompare(b));
    this.projects = [...pinned.map((name) => ({ name, path: `${dir}/${name}`, pinned: true })), ...rest.map((name) => ({ name, path: `${dir}/${name}`, pinned: false }))];
    if (!this.projects.length) throw new Error(`No git repositories in ${dir}.`);
    // Start on the repo it was opened for (a repo header's +), else the repo of the terminal in front, else the first pinned one.
    let current = props()?.repo ? this.projects.find((p) => p.path === props().repo) : null;
    const cwd = focused()?.cwd;
    if (!current && cwd) {
      const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (common.ok) current = this.projects.find((p) => p.path === common.out.replace(/\/\.git$/, ""));
    }
    await this.choose(current ?? this.projects[0]);
  }

  async choose(project) {
    this.project = project;
    this.at = Math.max(0, this.rows().indexOf(project));
    const head = await git(project.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    this.base = head.ok && head.out ? head.out : "origin/main";
    const refs = await git(project.path, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"]);
    this.refs = new Set(refs.out.split("\n").map((r) => r.replace(/^refs\/heads\/|^refs\/remotes\/origin\//, "")).filter(Boolean));
  }

  // The pinned projects are buttons; the list holds only the rest.
  pinned() {
    return (this.projects ?? []).filter((p) => p.pinned);
  }

  rows() {
    return (this.projects ?? []).filter((p) => !p.pinned);
  }

  pick(project, cx) {
    if (!project) return;
    this.listOpen = false;
    this.input.focus();
    cx.spawn(async (cx) => { await this.choose(project); cx.notify(); });
    cx.notify();
  }

  newBranch(text) {
    return `${this.config?.branchPrefix ?? ""}${slug(text)}`;
  }

  // The live line under the field: what Enter would do, as far as is known
  // without the network.
  hint() {
    const p = parse(this.text);
    if (!this.text.trim()) return `A new branch from ${this.base}, or an existing one.`;
    if (p.kind === "pr") return `GitHub PR #${p.number}${p.repo ? ` in ${p.repo}` : ""}: its branch.`;
    if (p.kind === "linear") return `Linear ${p.id}: the branch Linear names for it.`;
    const name = p.text;
    if (!/\s/.test(name) && this.refs.has(name)) return `Existing branch ${name}.`;
    return `New branch ${this.newBranch(name)} from ${this.base}.`;
  }

  go(cx) {
    if (this.busy || !this.project) return;
    cx.spawn(async (cx) => {
      this.busy = true;
      this.error = "";
      cx.notify();
      try {
        const done = await this.create((step) => { this.step = step; cx.notify(); });
        if (done) closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      this.busy = false;
      this.step = "";
      cx.notify();
    });
  }

  // Which branch to check out: { branch, fetch? } where fetch is a refspec
  // that brings it (a PR from a fork has no branch on origin).
  async resolve(p, say) {
    const repo = this.project;
    if (p.kind === "pr") {
      if (p.repo && p.repo !== repo.name) {
        const other = this.projects.find((x) => x.name === p.repo);
        if (!other) throw new Error(`${p.repo} isn't in ${this.config.projects ?? "~/Projects"}.`);
        await this.choose(other);
      }
      say(`Reading PR #${p.number}…`);
      const args = ["pr", "view", p.number, "--json", "headRefName,isCrossRepository"];
      if (p.owner) args.push("--repo", `${p.owner}/${p.repo}`);
      const r = await exec("gh", args, { cwd: this.project.path });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || "gh pr view failed.").trim());
      const pr = JSON.parse(r.stdout);
      if (pr.isCrossRepository) return { branch: `pr-${p.number}`, fetch: `+refs/pull/${p.number}/head:refs/heads/pr-${p.number}` };
      return { branch: pr.headRefName };
    }
    if (p.kind === "linear") {
      say(`Reading ${p.id} from Linear…`);
      const key = await exec("security", ["find-generic-password", "-s", KEYCHAIN_ITEM, "-w"]);
      if (key.code !== 0) throw new Error(`No Linear API key: add it to the Keychain as "${KEYCHAIN_ITEM}".`);
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key.stdout.trim() },
        body: JSON.stringify({ query: "query($id: String!) { issue(id: $id) { branchName } }", variables: { id: p.id } }),
      });
      const body = await res.json();
      const branch = body?.data?.issue?.branchName;
      if (branch) return { branch };
      // "pr-123" looks like a ticket too: when Linear has no such issue, it's a name.
      if (p.maybeName) return this.resolve({ kind: "name", text: this.text.trim() }, say);
      throw new Error(body?.errors?.[0]?.message ?? `Linear has no ${p.id}.`);
    }
    const name = p.text;
    if (!name) throw new Error("Type a name, a branch, a PR or a Linear ticket.");
    if (!/\s/.test(name)) {
      if ((await git(repo.path, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).ok) return { branch: name };
      say("Looking for the branch on origin…");
      if ((await git(repo.path, ["ls-remote", "--exit-code", "--heads", "origin", name])).ok) return { branch: name };
    }
    return { branch: this.newBranch(name) };
  }

  // Returns true when the dialog can close.
  async create(say) {
    const { branch, fetch: refspec } = await this.resolve(parse(this.text), say);
    const repo = this.project;

    // Already checked out (an older worktree, Orca's, the main checkout): open that.
    const list = await git(repo.path, ["worktree", "list", "--porcelain"]);
    for (const block of list.out.split(/\n\n+/)) {
      const lines = block.split("\n");
      if (!lines.includes(`branch refs/heads/${branch}`)) continue;
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      if (path) { this.open(path, false); return true; }
    }

    say(`Fetching ${this.base}…`);
    const baseBranch = this.base.replace(/^origin\//, "");
    const fetched = await git(repo.path, ["fetch", "--quiet", "origin", `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`]);
    if (!fetched.ok) throw new Error(fetched.err || "git fetch failed.");
    say(`Fetching ${branch}…`);
    await git(repo.path, ["fetch", "--quiet", "origin", refspec ?? `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);

    const local = (await git(repo.path, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
    const remote = (await git(repo.path, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`])).ok;

    let path = `${ROOT()}/${repo.name}/${slug(branch.split("/").pop()) || "workspace"}`;
    for (let n = 2; (await exec("test", ["-e", path])).code === 0; n++) path = `${ROOT()}/${repo.name}/${slug(branch.split("/").pop())}-${n}`;

    say("Creating the worktree…");
    let add;
    if (local) {
      // An old local copy of a branch that moved on origin catches up, when that loses nothing.
      if (remote && (await git(repo.path, ["merge-base", "--is-ancestor", branch, `origin/${branch}`])).ok) {
        await git(repo.path, ["branch", "-f", branch, `origin/${branch}`]);
      }
      add = ["worktree", "add", path, branch];
    } else if (remote) {
      add = ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`];
    } else {
      add = ["worktree", "add", "--no-track", "-b", branch, path, this.base];
    }
    const made = await git(repo.path, add);
    if (!made.ok) throw new Error(made.err || "git worktree add failed.");

    // Git-ignored local files the repo needs, copied from the main checkout.
    const setup = this.config.setup?.[repo.name] ?? {};
    for (const file of setup.copy ?? []) {
      await exec("sh", ["-c", 'if [ -f "$1/$3" ] && [ ! -e "$2/$3" ]; then mkdir -p "$(dirname "$2/$3")" && cp "$1/$3" "$2/$3"; fi', "sh", repo.path, path, file]);
    }
    this.open(path, true, setup.run);
    return true;
  }

  // Shows the space on that checkout, making one (with Claude) when none does.
  open(path, fresh, setupCommand) {
    closeOverlay(props().overlay);
    const there = spaceAt(path);
    if (there && !fresh) return run("space.select", { id: there.id });
    // A new worktree's space is named after its folder, with no status emoji.
    const name = fresh ? { name: path.split("/").pop() } : {};
    run("space.new", { ...name, folder: path, argv: this.config?.agent ?? ["claude"] });
    if (setupCommand) {
      run("tab.new", { name: "setup", folder: path, argv: ["sh", "-c", setupCommand] });
      run("tab.select", { index: 1 });
    }
  }

  key(e, cx) {
    const n = this.rows().length;
    if (e.key === "escape" && this.listOpen) {
      this.listOpen = false;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && e.modifiers?.platform) {
      cx.stop_propagation();
      return this.go(cx);
    }
    if (!this.listOpen || !n) return;
    if (e.key === "down" || e.key === "up") {
      this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      cx.stop_propagation();
      cx.notify();
    }
  }

  renderList(t) {
    const rows = this.rows();
    const items = [];
    rows.forEach((p, i) => {
      const on = i === this.at;
      items.push(
        h_flex().id(`project-${p.name}`).flex_none().h(30).px(10).gap(8).items_center().rounded(6).cursor_pointer()
          .when(on, (el) => el.bg(t.selected))
          .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click((_e, cx) => this.pick(p, cx))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(p.name))
          .when(p === this.project, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("✓"))),
      );
    });
    // Under the Project button, never over it; a click anywhere outside the list
    // (the button included) lands on the backdrop and closes it.
    const backdrop = div().id("project-backdrop").absolute().inset_0()
      .on_click((_e, cx) => { this.listOpen = false; this.input.focus(); cx.notify(); });
    const list = div().absolute().top(this.pinned().length ? 152 : 112).left(16).right(16).h(200).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg().p(4)
      .child(v_flex().id("project-list").size_full().overflow_y_scroll().children(items))
      .child(Scrollbar.vertical("project-list").absolute().inset_0());
    return [backdrop, list];
  }

  render() {
    const t = theme();
    const label = (text) => div().text_size(11.5).text_color(t.muted).child(text);
    const loading = this.projects === undefined;
    const field = (el) => el.h(34).px(10).items_center().rounded(7).border(1).bg(t.background).text_color(t.foreground);
    return v_flex()
      .id("new-workspace")
      .relative()
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .child(div().pb(4).font_semibold().text_color(t.foreground).child("New workspace"))
      .child(h_flex().justify_between().items_center()
        .child(label("Project"))
        .child(h_flex().gap(5).items_center().px(6).h(20).rounded(5).border(1).border_color(t.border).text_size(11).text_color(t.muted)
          .child(svg("mods/workspace-chrome/git-branch.svg").size(11))
          .child(this.base)))
      .when(this.pinned().length > 0, (el) => el.child(h_flex().gap(6).children(this.pinned().map((p) => {
        const on = p === this.project;
        return div().id(`pinned-${p.name}`).flex_1().min_w(0).h(32).px(8).flex().items_center().justify_center().rounded(7).border(1).cursor_pointer()
          .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
          .when(!on, (b) => b.hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => this.pick(p, cx))
          .child(div().truncate().child(p.name));
      }))))
      .when(loading || this.rows().length > 0, (el) => el.child(field(h_flex().id("project").gap(8).cursor_pointer().border_color(this.listOpen ? t.accent : t.input).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { if (!loading) { this.listOpen = !this.listOpen; cx.notify(); } })
        .child(div().flex_1().min_w(0).truncate().text_color(this.project && !this.project.pinned ? t.foreground : t.dim)
          .child(loading ? "Reading projects…" : this.project && !this.project.pinned ? this.project.name : "Other repo…"))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.muted))))
      .child(div().pt(4).child(label("Create from")))
      .child(field(Input.new(this.input)).border_color(this.inputFocused && !this.listOpen ? t.accent : t.input))
      .child(div().text_size(11.5).text_color(this.error ? t.blocked : t.dim).child(this.error || this.step || (loading ? "" : this.hint())))
      .child(div().flex_1())
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("Opens with Claude · esc closes"))
        .child(h_flex().id("create").h(30).px(12).gap(8).items_center().rounded(7)
          .bg(this.busy || !this.project ? t.raised : t.solid)
          .text_color(this.busy || !this.project ? t.dim : t.solid_foreground)
          .when(!this.busy && Boolean(this.project), (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)))
          .on_click((_e, cx) => this.go(cx))
          .child(this.busy ? "Working…" : "Create workspace")
          .child(div().text_size(11).opacity(0.7).child("⌘↵"))))
      .when(this.listOpen, (el) => el.children(this.renderList(t)));
  }
}
