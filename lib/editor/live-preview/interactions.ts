import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { documentPositionAtPointer, mapPointerAnchor } from "./dom-position";

type PointerAnchor = { position: number; x: number; y: number; time: number };

const lastPointerAnchors = new WeakMap<EditorView, PointerAnchor>();

function isSameClickSequence(previous: PointerAnchor | undefined, event: MouseEvent) {
  return Boolean(previous
    && event.timeStamp - previous.time < 1_000
    && Math.abs(event.clientX - previous.x) < 8
    && Math.abs(event.clientY - previous.y) < 8);
}

function interceptedTarget(view: EditorView, event: MouseEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const line = target?.closest<HTMLElement>(".cm-line");
  if (!line || !view.contentDOM.contains(line)) return true;
  return line.classList.contains("cm-live-metadata") || Boolean(target?.closest("a.cm-live-navigation, .cm-live-task-checkbox"));
}

export const livePreviewPointerSelection: Extension = EditorView.mouseSelectionStyle.of((view, event) => {
  if (
    event.button !== 0
    || event.detail > 2
    || event.altKey
    || event.metaKey
    || event.ctrlKey
    || interceptedTarget(view, event)
  ) return null;

  const previousAnchor = lastPointerAnchors.get(view);
  const pointerPosition = documentPositionAtPointer(view, event.clientX, event.clientY);
  const initialAnchor = event.detail === 2 && isSameClickSequence(previousAnchor, event)
    ? previousAnchor!.position
    : pointerPosition;
  if (initialAnchor === null) return null;
  lastPointerAnchors.set(view, {
    position: initialAnchor,
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
  });

  if (event.detail === 2) {
    const word = view.state.wordAt(initialAnchor);
    if (!word) return null;
    return {
      get() { return EditorSelection.single(word.from, word.to); },
      update() { return false; },
    };
  }

  let anchor: number = initialAnchor;
  let startSelection: EditorState["selection"] = view.state.selection;
  const extend = event.shiftKey;

  return {
    get(curEvent) {
      const head = documentPositionAtPointer(view, curEvent.clientX, curEvent.clientY) ?? anchor;
      if (extend) return startSelection.replaceRange(startSelection.main.extend(head, head));
      return EditorSelection.single(anchor, head);
    },
    update(update) {
      if (update.docChanged) {
        anchor = mapPointerAnchor(anchor, update.changes);
        startSelection = startSelection.map(update.changes);
      }
      return false;
    },
  };
});

export const livePreviewReferenceNavigation: Extension = EditorView.domEventHandlers({
  mousedown(event) {
    if (event.button !== 0) return false;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.cm-live-navigation");
    if (!link) return false;
    event.preventDefault();
    if (link.target === "_blank") window.open(link.href, "_blank", "noopener,noreferrer");
    else window.location.assign(link.href);
    return true;
  },
});
