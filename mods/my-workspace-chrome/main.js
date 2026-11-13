import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
// A copy of Herdr's workspace-chrome: the sidebar's header and footer. Adds "Custom settings"
// under Settings, and its search opens my-picker like cmd-p.
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// The footer is a "Settings" section: folded, its layout block is just the title
// bar; open, it fits its three rows. Herdr keeps the block size across restarts.
const FOOTER = "sidebar-footer", FOOTER_TITLE = 41, FOOTER_OPEN = 41 + 3 * 28 + 8;
const footerFolded = () => (find(layout(), FOOTER)?.size?.px ?? FOOTER_OPEN) <= FOOTER_TITLE;
const toggleFooter = () => run("layout.resize", { id: FOOTER, px: footerFolded() ? FOOTER_OPEN : FOOTER_TITLE });

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/my-workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const update = Boolean(updates().app.ready);
      const ready = div().size(6).rounded_full().bg(t.accent);
      const herdr = row("settings", "settings", "Herdr Settings", false, () => run("app.settings"))
        .when(update, el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready));
      // The rail has no room for a title: its icons, or just Herdr's gear while folded.
      if (collapsed) {
        return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).pt(4).pb(8).items_center().text_size(13)
          .child(herdr)
          .when(!footerFolded(), el => el
            .child(row("custom-settings", "sliders", "Custom settings", false, () => run("mod.open", { name: "my-settings" })))
            .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" }))));
      }
      // A section like GitHub and Linear: its title folds it to the title bar.
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
        .child(h_flex().h(FOOTER_TITLE - 1).px(16).flex_none().items_center()
          .child(h_flex().id("settings-fold").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
            .text_size(11.5).font_medium().text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click(toggleFooter)
            .child(svg(`mods/my-workspace-chrome/chevron-${footerFolded() ? "right" : "down"}.svg`).size(10).flex_none())
            .child("Settings")
            // Folded, an update waiting still shows.
            .when(footerFolded() && update, el => el.child(ready))))
        .when(!footerFolded(), el => el.child(v_flex().px(8).pb(8)
          .child(herdr)
          // Settings for the mods made here (mods/my-settings), beside Herdr's own.
          .child(row("custom-settings", "sliders", "Custom settings", false, () => run("mod.open", { name: "my-settings" })))
          .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })))));
    }
    // A clean header: search and the sidebar toggle show only while it's hovered
    // (on the rail the toggle always shows: it's the way back out).
    const shown = Boolean(this.hovered);
    return h_flex().id("sidebar-header").size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .on_hover((h, cx) => { if (Boolean(this.hovered) !== h) { this.hovered = h; cx.notify(); } })
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed && shown, el => el.child(this.button("search", svg("mods/my-workspace-chrome/search.svg").size(15), () => run("mod.open", { name: "my-picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos") && (collapsed || shown), el => el.child(this.button("sidebar-toggle", svg("mods/my-workspace-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
