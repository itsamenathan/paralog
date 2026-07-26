import type { ChangeDesc } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function mapPointerAnchor(anchor: number, changes: ChangeDesc) {
  return changes.mapPos(anchor, 1);
}

function belongsToEditor(view: EditorView, node: Node) {
  return node === view.contentDOM || view.contentDOM.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

function mappedDOMPosition(view: EditorView, node: Node | null, offset: number) {
  if (!node || !belongsToEditor(view, node)) return null;
  try {
    return Math.max(0, Math.min(view.state.doc.length, view.posAtDOM(node, offset)));
  } catch {
    return null;
  }
}

export function documentPositionAtPointer(view: EditorView, x: number, y: number) {
  const ownerDocument = view.contentDOM.ownerDocument;
  if (typeof ownerDocument.caretPositionFromPoint === "function") {
    const caret = ownerDocument.caretPositionFromPoint(x, y);
    const position = mappedDOMPosition(view, caret?.offsetNode ?? null, caret?.offset ?? 0);
    if (position !== null) return position;
  }
  if (typeof ownerDocument.caretRangeFromPoint === "function") {
    const range = ownerDocument.caretRangeFromPoint(x, y);
    const position = mappedDOMPosition(view, range?.startContainer ?? null, range?.startOffset ?? 0);
    if (position !== null) return position;
  }
  const fallback = view.posAtCoords({ x, y });
  return fallback === null ? null : Math.max(0, Math.min(view.state.doc.length, fallback));
}
