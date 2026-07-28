import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Vim, type MotionFn } from "@replit/codemirror-vim";

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

// Vim keeps the column a vertical run started from, so passing over a short line
// does not drag the cursor left for the rest of the run. Motion identity is the
// only signal Vim exposes, so the memory spans the motions defined here.
const verticalMotions = new Set<MotionFn>();

function goalColumn(vim: Parameters<MotionFn>[3], column: number) {
  if (vim.lastMotion && verticalMotions.has(vim.lastMotion)) return vim.lastHPos;
  vim.lastHPos = column;
  return column;
}

const moveByLines: MotionFn = (cm, head, args, vim) => {
  const repeat = args.repeat + (args.repeatOffset ?? 0);
  const line = Math.max(cm.firstLine(), Math.min(cm.lastLine(), head.line + (args.forward ? repeat : -repeat)));
  if (args.toFirstChar) vim.lastHPos = Math.max(0, cm.getLine(line).search(/\S/));
  return cm.clipPos({ line, ch: args.toFirstChar ? vim.lastHPos : goalColumn(vim, head.ch) });
};

const moveByDisplayLines: MotionFn = (cm, head, args, vim) => {
  let range = EditorSelection.cursor(cm.indexFromPos(head));
  for (let count = 0; count < args.repeat; count += 1) {
    const target = livePreviewVerticalTarget(cm.cm6, range, args.forward ? 1 : -1);
    if (target.head === range.head) break;
    range = EditorSelection.cursor(target.head, 1, undefined, range.goalColumn);
  }
  const position = cm.posFromIndex(range.head);
  vim.lastHPos = position.ch;
  return position;
};

export function configureLivePreviewVimNavigation() {
  if (vimNavigationConfigured) return;
  vimNavigationConfigured = true;

  verticalMotions.add(moveByLines).add(moveByDisplayLines);
  Vim.defineMotion("paralogMoveByLines", moveByLines);
  Vim.defineMotion("paralogMoveByDisplayLines", moveByDisplayLines);

  // Vim expands the arrow keys into `j`/`k` as a non-remappable alias, which
  // resolves to its own motion no matter what `j` and `k` are mapped to. That
  // motion follows visual geometry and steps clean over logical lines whose
  // Markdown markers Live Preview replaced with an atomic widget, so every key
  // that moves by a logical line has to be mapped on its own.
  for (const [keys, motion, args] of [
    ["j", "paralogMoveByLines", { forward: true, linewise: true }],
    ["k", "paralogMoveByLines", { forward: false, linewise: true }],
    ["<Down>", "paralogMoveByLines", { forward: true, linewise: true }],
    ["<Up>", "paralogMoveByLines", { forward: false, linewise: true }],
    ["+", "paralogMoveByLines", { forward: true, toFirstChar: true }],
    ["-", "paralogMoveByLines", { forward: false, toFirstChar: true }],
    ["_", "paralogMoveByLines", { forward: true, toFirstChar: true, repeatOffset: -1 }],
    ["gj", "paralogMoveByDisplayLines", { forward: true }],
    ["gk", "paralogMoveByDisplayLines", { forward: false }],
    ["g<Down>", "paralogMoveByDisplayLines", { forward: true }],
    ["g<Up>", "paralogMoveByDisplayLines", { forward: false }],
  ] as const) Vim.mapCommand(keys, "motion", motion, args, {});
}
