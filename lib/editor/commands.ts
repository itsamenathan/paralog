import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function exitEmptyMarkdownBlock({
  state,
  dispatch,
}: {
  state: EditorState;
  dispatch: (transaction: ReturnType<EditorState["update"]>) => void;
}) {
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const afterCursor = state.doc.sliceString(selection.head, line.to);
  if (!/^\s*$/.test(afterCursor) || !/^\s*(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?|>\s*)$/.test(line.text)) return false;
  dispatch(state.update({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } }));
  return true;
}

export function keepMobileCursorVisible(view: EditorView) {
  const viewport = window.visualViewport;
  if (!viewport || window.innerWidth > 720 || !view.hasFocus) return;
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
  const trackedInset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-keyboard-height")) || 0;
  if (Math.max(trackedInset, layoutHeight - viewport.height - viewport.offsetTop) <= 80) return;
  window.requestAnimationFrame(() => {
    const selection = view.state.selection.main;
    const cursor = view.coordsAtPos(selection.head);
    if (!cursor) return;
    const visibleTop = viewport.offsetTop + 170;
    const visibleBottom = viewport.offsetTop + viewport.height - (selection.empty ? 28 : 82);
    if (cursor.bottom > visibleBottom) window.scrollBy({ top: cursor.bottom - visibleBottom, behavior: "auto" });
    else if (cursor.top < visibleTop) window.scrollBy({ top: cursor.top - visibleTop, behavior: "auto" });
  });
}
