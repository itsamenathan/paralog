import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

export function continueMarkdownList(view: EditorView) {
  // The Markdown parser is incremental. It may not yet have parsed a just
  // loaded entry when the writer presses Enter, which makes its built-in list
  // continuation command decline the keypress.
  ensureSyntaxTree(view.state, view.state.doc.length, 50);
  if (insertNewlineContinueMarkup(view)) return true;

  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;
  const bullet = line.text.match(/^(\s*)((?:[-+*])\s+(?:\[[ xX]\]\s*)?)(\S.*)$/);
  const ordered = line.text.match(/^(\s*)(\d+)([.)]\s+)(\S.*)$/);
  const continuation = bullet
    ? `${bullet[1]}${bullet[2]}`
    : ordered
      ? `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}`
      : null;
  if (!continuation) return false;

  view.dispatch({
    changes: { from: selection.head, insert: `${view.state.lineBreak}${continuation}` },
    selection: { anchor: selection.head + view.state.lineBreak.length + continuation.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

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

// Rewriting the whole document maps every cursor onto the start of the change,
// which drops the writer at the top of the entry. Synchronizing an entry loaded
// from elsewhere therefore only replaces the span that actually differs, so the
// cursor and scroll position survive updates that land while the user is typing.
export function externalDocumentChange(current: string, next: string) {
  const shortest = Math.min(current.length, next.length);
  let from = 0;
  while (from < shortest && current[from] === next[from]) from += 1;
  let tail = 0;
  while (tail < shortest - from && current[current.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  return { from, to: current.length - tail, insert: next.slice(from, next.length - tail) };
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
