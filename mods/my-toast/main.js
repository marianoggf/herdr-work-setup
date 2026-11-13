// How notifications look (a copy of Herdr's toast mod, chosen by the layout's
// "toast"). Click one to run its action (e.g. go to the agent) and dismiss it.
//
// A notification whose action is "my-tabs.undo-close:<tab>" or
// "my-tabs.undo-delete:<space>" is an undo snackbar instead: the message, an
// amber Undo, and a 2 px amber bar along the bottom that drains over its
// timeout. Only Undo runs the action.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const UNDO = /^my-tabs\.undo-(close|delete):/;

export default class Toast extends View {
  render(cx) {
    const p = props() ?? {};
    return UNDO.test(p.action?.name ?? "") ? this.snackbar(p) : this.toast(p);
  }

  snackbar(p) {
    const t = theme();
    const amber = t.ansi3;
    const undo = (_e, cx) => {
      cx.stop_propagation();
      run(p.action.name, p.action.args ?? {});
      closeOverlay(p.overlay);
    };
    return v_flex().id("snackbar").size_full().relative().overflow_hidden().bg(t.popover)
      .on_size_change(({ width }, cx) => {
        if (this.drain !== undefined) return;
        this.drain = -width; // the transition slides it out to the left over the timeout
        cx.notify();
      })
      .child(h_flex().flex_1().min_h(0).pl(18).pr(10).gap(12).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(p.title ?? ""))
        .child(div().id("snackbar-undo").flex_none().px(10).py(5).rounded(6).cursor_pointer()
          .text_size(13).font_bold().text_color(amber).hover((s) => s.bg(t.hover))
          .on_click(undo).child("Undo")))
      .child(div().absolute().bottom(0).left(this.drain ?? 0).w_full().h(2).bg(amber)
        .transition("left", { duration: p.timeout ?? 10000, easing: "linear" }));
  }

  toast(p) {
    const t = theme();
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }
}
