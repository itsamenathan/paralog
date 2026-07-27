import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { propertyIconName } from "../../property-icons.ts";
import { propertyIconConfig } from "./property-icons.ts";
import { collectLivePreviewNodes, frontMatterEndLine, type LivePreviewNode, type PreviewRange } from "./syntax.ts";
import { BulletWidget, ImageWidget, PropertyIconWidget, TaskCheckboxWidget } from "./widgets.ts";

type DecorationResult = { decorations: DecorationSet; atomic: DecorationSet };

export function addNonOverlappingPreviewRange(
  ranges: PreviewRange[],
  candidate: PreviewRange,
) {
  if (
    candidate.to <= candidate.from
    || ranges.some((range) => candidate.from < range.to && candidate.to > range.from)
  ) return false;
  ranges.push(candidate);
  return true;
}

function validNavigationHref(href: string) {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href);
}

function navigationAttributes(href: string) {
  return {
    href,
    ...(/^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {}),
  };
}

export function buildLivePreviewDecorations(view: EditorView): DecorationResult {
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const selection = view.state.selection.main;
  const activeLine = view.state.doc.lineAt(selection.head).number;
  const metadataEnd = frontMatterEndLine(view.state);
  const metadataEditing = Boolean(metadataEnd && activeLine <= metadataEnd && (view.hasFocus || !selection.empty));
  const iconConfig = view.state.facet(propertyIconConfig);
  const nodes = collectLivePreviewNodes(view.state, view.visibleRanges as readonly PreviewRange[], activeLine);
  const lineClasses = new Map<number, Set<string>>();
  const hidden: PreviewRange[] = [];

  const addLineClass = (lineFrom: number, ...classNames: string[]) => {
    const classes = lineClasses.get(lineFrom) ?? new Set<string>();
    for (const className of classNames) if (className) classes.add(className);
    lineClasses.set(lineFrom, classes);
  };
  const addMark = (from: number, to: number, className: string) => {
    if (to > from) decorations.push(Decoration.mark({ class: className }).range(from, to));
  };
  const addHidden = (range: PreviewRange) => {
    if (!addNonOverlappingPreviewRange(hidden, range)) return;
    const replacement = Decoration.replace({}).range(range.from, range.to);
    decorations.push(replacement);
    atomic.push(replacement);
  };
  const addReplacement = (node: LivePreviewNode, replacement: Decoration) => {
    const from = Number(node.attributes?.fullFrom ?? node.from);
    const to = Number(node.attributes?.fullTo ?? node.to);
    if (!addNonOverlappingPreviewRange(hidden, { from, to })) return;
    const range = replacement.range(from, to);
    decorations.push(range);
    atomic.push(range);
  };
  const inactive = (node: LivePreviewNode) => view.state.doc.lineAt(node.lineFrom).number !== activeLine;

  for (const node of nodes) {
    if (node.kind === "metadata") {
      const role = String(node.attributes?.role ?? "line");
      const property = String(node.attributes?.property ?? "");
      addLineClass(
        node.lineFrom,
        "cm-live-metadata",
        metadataEditing ? "cm-live-metadata-editing" : "cm-live-metadata-preview",
        role === "start" ? "cm-live-metadata-start" : role === "end" ? "cm-live-metadata-end" : "",
        !metadataEditing && role === "field" ? "cm-live-metadata-field" : "",
        !metadataEditing && role === "field" && property ? `cm-live-metadata-property-${property}` : "",
      );
      if (role === "start" || role === "end") {
        addMark(node.from, node.to, `cm-live-metadata-delimiter cm-live-metadata-delimiter-${metadataEditing ? "editing" : "preview"}`);
      } else if (role === "field") {
        if (!metadataEditing && property) {
          decorations.push(Decoration.widget({
            widget: new PropertyIconWidget(property, propertyIconName(iconConfig.icons, property), iconConfig.openPicker),
            side: -1,
          }).range(node.lineFrom));
        }
        const keyFrom = Number(node.attributes?.keyFrom ?? node.from);
        const separatorFrom = Number(node.attributes?.separatorFrom ?? keyFrom);
        const separatorTo = Number(node.attributes?.separatorTo ?? separatorFrom);
        addMark(keyFrom, separatorFrom, "cm-live-metadata-key");
        addMark(separatorFrom, separatorTo, "cm-live-metadata-separator");
        addMark(separatorTo, node.to, "cm-live-metadata-value");
      }
      continue;
    }
    if (node.kind === "heading") {
      addLineClass(node.lineFrom, "cm-live-heading", `cm-live-h${Number(node.attributes?.level ?? 1)}`);
    } else if (node.kind === "quote") {
      addLineClass(node.lineFrom, "cm-live-quote");
    } else if (node.kind === "code-block") {
      addLineClass(node.lineFrom, "cm-live-codeblock");
    } else if (node.kind === "strong") {
      addMark(node.from, node.to, "cm-live-bold");
    } else if (node.kind === "emphasis") {
      addMark(node.from, node.to, "cm-live-italic");
    } else if (node.kind === "strike") {
      addMark(node.from, node.to, "cm-live-strike");
    } else if (node.kind === "inline-code") {
      addMark(node.from, node.to, "cm-live-code");
    } else if (node.kind === "task" && inactive(node)) {
      addReplacement(node, Decoration.replace({
        widget: new TaskCheckboxWidget(Boolean(node.attributes?.checked), Number(node.attributes?.checkboxPosition ?? node.from)),
      }));
      continue;
    } else if (node.kind === "list-marker" && inactive(node) && !node.attributes?.ordered) {
      addReplacement(node, Decoration.replace({ widget: new BulletWidget() }));
      continue;
    } else if (node.kind === "image" && inactive(node)) {
      addReplacement(node, Decoration.replace({
        widget: new ImageWidget(String(node.attributes?.href ?? ""), String(node.attributes?.label ?? "")),
      }));
      continue;
    } else if (node.kind === "link") {
      const href = String(node.attributes?.href ?? "");
      if (inactive(node) && validNavigationHref(href)) {
        decorations.push(Decoration.mark({
          tagName: "a",
          class: "cm-live-link cm-live-navigation",
          attributes: navigationAttributes(href),
        }).range(node.from, node.to));
      } else addMark(node.from, node.to, "cm-live-link");
    } else if (node.kind === "raw-url" && inactive(node)) {
      const href = String(node.attributes?.href ?? "");
      decorations.push(Decoration.mark({
        tagName: "a",
        class: "cm-live-link cm-live-navigation",
        attributes: { href, target: "_blank", rel: "noreferrer" },
      }).range(node.from, node.to));
    } else if ((node.kind === "tag" || node.kind === "person") && inactive(node)) {
      const label = String(node.attributes?.label ?? "");
      const collection = node.kind === "tag" ? "tags" : "people";
      decorations.push(Decoration.mark({
        tagName: "a",
        class: `cm-live-reference cm-live-${node.kind} cm-live-navigation`,
        attributes: { href: `/${collection}/${encodeURIComponent(label.normalize("NFC").toLocaleLowerCase())}` },
      }).range(node.from, node.to));
    }

    if (inactive(node)) for (const marker of node.markerRanges ?? []) addHidden(marker);
  }

  for (const [lineFrom, classes] of lineClasses) {
    decorations.push(Decoration.line({ class: [...classes].join(" ") }).range(lineFrom));
  }
  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  };
}

export const livePreviewDecorations: Extension = (() => {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      activeLine: number;
      selectionEmpty: boolean;

      constructor(view: EditorView) {
        ({ decorations: this.decorations, atomic: this.atomic } = buildLivePreviewDecorations(view));
        this.activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
        this.selectionEmpty = view.state.selection.main.empty;
        view.requestMeasure();
      }

      update(update: ViewUpdate) {
        const activeLine = update.state.doc.lineAt(update.state.selection.main.head).number;
        const selectionEmpty = update.state.selection.main.empty;
        const selectionAffectsDecorations = update.selectionSet
          && (activeLine !== this.activeLine || selectionEmpty !== this.selectionEmpty);
        // A compartment reconfigure sets none of the update flags, so the
        // property icon config has to be compared directly.
        const iconConfigChanged = update.state.facet(propertyIconConfig) !== update.startState.facet(propertyIconConfig);
        if (update.docChanged || update.viewportChanged || update.focusChanged || selectionAffectsDecorations || iconConfigChanged) {
          ({ decorations: this.decorations, atomic: this.atomic } = buildLivePreviewDecorations(update.view));
          update.view.requestMeasure();
        }
        this.activeLine = activeLine;
        this.selectionEmpty = selectionEmpty;
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  ];
})();
