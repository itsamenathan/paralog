import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const imageMarkdown = /!\[[^\]]*\]\([^)]+\)/;

function cursorTop(view: EditorView, position: number) {
  return view.coordsAtPos(position)?.top ?? null;
}

function stabilizeImageReflow(view: EditorView, position: number, expectedTop: number | null) {
  if (expectedTop === null) return;
  view.requestMeasure({
    read: () => cursorTop(view, position),
    write: (actualTop) => {
      if (actualTop !== null && Math.abs(actualTop - expectedTop) > 1) window.scrollBy({ top: actualTop - expectedTop, behavior: "auto" });
    },
  });
}

export function moveLivePreviewVertically(view: EditorView, direction: -1 | 1, extend = false) {
  const selection = view.state.selection.main;
  if (view.state.selection.ranges.length !== 1 || (!extend && !selection.empty)) return false;

  const line = view.state.doc.lineAt(selection.head);
  let moved = view.moveVertically(selection, direction > 0);
  if (moved.head === selection.head) moved = view.moveToLineBoundary(selection, direction > 0);

  const movedLine = view.state.doc.lineAt(moved.head);
  const expectedNumber = Math.max(1, Math.min(view.state.doc.lines, line.number + direction));
  let head = moved.head;
  let expectedTop = cursorTop(view, moved.head);

  // Replacement decorations can make CodeMirror resolve a vertical move on
  // the far side of an atomic range. Never let one key press cross more than
  // the immediately adjacent document line. Wrapped rows on the current line
  // still use CodeMirror's native goal-column behavior above.
  if (Math.abs(movedLine.number - line.number) > 1) {
    const target = view.state.doc.line(expectedNumber);
    const caret = view.coordsAtPos(selection.head);
    const block = view.lineBlockAt(target.from);
    const targetY = view.documentTop + block.top + Math.min(block.height / 2, 14);
    head = view.posAtCoords({ x: caret?.left ?? view.contentDOM.getBoundingClientRect().left, y: targetY }) ?? target.from;
    head = Math.max(target.from, Math.min(target.to, head));
    expectedTop = targetY;
  }

  const targetLine = view.state.doc.lineAt(head);
  const imageReflow = imageMarkdown.test(line.text) || imageMarkdown.test(targetLine.text);
  view.dispatch({ selection: extend ? { anchor: selection.anchor, head } : { anchor: head } });
  if (imageReflow) stabilizeImageReflow(view, head, expectedTop);
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
