import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";

const imageMarkdown = /!\[[^\]]*\]\([^)]+\)/;
let vimNavigationConfigured = false;

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

export function livePreviewVerticalTarget(view: EditorView, selection: SelectionRange, direction: -1 | 1) {
  const line = view.state.doc.lineAt(selection.head);
  let moved = view.moveVertically(selection, direction > 0);
  if (moved.head === selection.head) moved = view.moveToLineBoundary(selection, direction > 0);

  const movedLine = view.state.doc.lineAt(moved.head);
  const expectedNumber = Math.max(1, Math.min(view.state.doc.lines, line.number + direction));
  let head = moved.head;
  let expectedTop = cursorTop(view, moved.head);

  // Atomic marker and widget ranges may place CodeMirror's native target on
  // the far side of more than one document line. One key press may traverse
  // wrapped rows, but it must never skip an adjacent logical Markdown line.
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
  return { head, expectedTop, imageReflow: imageMarkdown.test(line.text) || imageMarkdown.test(targetLine.text) };
}

export function moveLivePreviewVertically(view: EditorView, direction: -1 | 1, extend = false) {
  const selection = view.state.selection.main;
  if (view.state.selection.ranges.length !== 1 || (!extend && !selection.empty)) return false;
  const { head, expectedTop, imageReflow } = livePreviewVerticalTarget(view, selection, direction);
  view.dispatch({ selection: extend ? { anchor: selection.anchor, head } : { anchor: head } });
  if (imageReflow) stabilizeImageReflow(view, head, expectedTop);
  return true;
}

export function configureLivePreviewVimNavigation() {
  if (vimNavigationConfigured) return;
  vimNavigationConfigured = true;

  Vim.defineMotion("paralogMoveByLines", (cm, head, args) => {
    const line = Math.max(cm.firstLine(), Math.min(cm.lastLine(), head.line + (args.forward ? args.repeat : -args.repeat)));
    return cm.clipPos({ line, ch: head.ch });
  });
  Vim.defineMotion("paralogMoveByDisplayLines", (cm, head, args) => {
    let range = EditorSelection.cursor(cm.indexFromPos(head));
    for (let count = 0; count < args.repeat; count += 1) {
      const target = livePreviewVerticalTarget(cm.cm6, range, args.forward ? 1 : -1);
      if (target.head === range.head) break;
      range = EditorSelection.cursor(target.head, 1, undefined, range.goalColumn);
    }
    return cm.posFromIndex(range.head);
  });
  for (const [keys, motion, forward] of [
    ["j", "paralogMoveByLines", true],
    ["k", "paralogMoveByLines", false],
    ["gj", "paralogMoveByDisplayLines", true],
    ["gk", "paralogMoveByDisplayLines", false],
  ] as const) Vim.mapCommand(keys, "motion", motion, { forward }, {});
}
