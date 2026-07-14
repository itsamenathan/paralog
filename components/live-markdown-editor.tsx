"use client";

import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

class ImageWidget extends WidgetType {
  constructor(private src: string, private alt: string) { super(); }
  eq(widget: ImageWidget) { return widget.src === this.src && widget.alt === this.alt; }
  toDOM() {
    const figure = document.createElement("figure");
    figure.className = "cm-live-image";
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    figure.append(image);
    if (this.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.alt;
      figure.append(caption);
    }
    return figure;
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-live-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

function liveDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const fencedLines = new Set<number>();
  let fence: { character: string; length: number } | null = null;
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const marker = line.text.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      fencedLines.add(lineNumber);
      if (marker?.[0] === fence.character && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = { character: marker[0], length: marker.length };
      fencedLines.add(lineNumber);
    }
  }
  const addMark = (from: number, to: number, className: string) => {
    if (to > from) decorations.push(Decoration.mark({ class: className }).range(from, to));
  };
  const hide = (from: number, to: number) => {
    if (to > from) decorations.push(Decoration.replace({}).range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const active = line.number === activeLine;

      if (fencedLines.has(line.number)) {
        decorations.push(Decoration.line({ class: "cm-live-codeblock" }).range(line.from));
        if (line.to >= to) break;
        position = line.to + 1;
        continue;
      }

      const heading = text.match(/^(#{1,6})\s+/);
      if (heading) {
        decorations.push(Decoration.line({ class: `cm-live-heading cm-live-h${heading[1].length}` }).range(line.from));
        if (!active) hide(line.from, line.from + heading[0].length);
      }

      const quote = text.match(/^\s*>\s?/);
      if (quote) {
        decorations.push(Decoration.line({ class: "cm-live-quote" }).range(line.from));
        if (!active) hide(line.from, line.from + quote[0].length);
      }

      const bullet = text.match(/^(\s*)[-+*]\s+/);
      if (bullet && !active) {
        const markerFrom = line.from + bullet[1].length;
        decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(markerFrom, line.from + bullet[0].length));
      }

      const images = /!\[([^\]]*)\]\(([^)]+)\)/g;
      for (let match = images.exec(text); match; match = images.exec(text)) {
        if (!active) {
          decorations.push(
            Decoration.replace({ widget: new ImageWidget(match[2], match[1]) })
              .range(line.from + match.index, line.from + match.index + match[0].length),
          );
        }
      }

      const bold = /\*\*([^*\n]+)\*\*/g;
      for (let match = bold.exec(text); match; match = bold.exec(text)) {
        const start = line.from + match.index;
        addMark(start + 2, start + match[0].length - 2, "cm-live-bold");
        if (!active) { hide(start, start + 2); hide(start + match[0].length - 2, start + match[0].length); }
      }
      const boldMarkers = [...text.matchAll(/\*\*/g)];
      if (active && boldMarkers.length % 2 === 1) {
        const start = line.from + (boldMarkers.at(-1)?.index ?? 0) + 2;
        addMark(start, line.to, "cm-live-bold");
      }

      const italic = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
      for (let match = italic.exec(text); match; match = italic.exec(text)) {
        const marker = line.from + match.index + match[1].length;
        addMark(marker + 1, marker + match[0].length - match[1].length - 1, "cm-live-italic");
        if (!active) { hide(marker, marker + 1); hide(marker + match[0].length - match[1].length - 1, marker + match[0].length - match[1].length); }
      }

      const strike = /~~([^~\n]+)~~/g;
      for (let match = strike.exec(text); match; match = strike.exec(text)) {
        const start = line.from + match.index;
        addMark(start + 2, start + match[0].length - 2, "cm-live-strike");
        if (!active) { hide(start, start + 2); hide(start + match[0].length - 2, start + match[0].length); }
      }

      const code = /`([^`\n]+)`/g;
      for (let match = code.exec(text); match; match = code.exec(text)) {
        const start = line.from + match.index;
        addMark(start + 1, start + match[0].length - 1, "cm-live-code");
        if (!active) { hide(start, start + 1); hide(start + match[0].length - 1, start + match[0].length); }
      }

      const links = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
      for (let match = links.exec(text); match; match = links.exec(text)) {
        const start = line.from + match.index;
        addMark(start + 1, start + 1 + match[1].length, "cm-live-link");
        if (!active) { hide(start, start + 1); hide(start + 1 + match[1].length, start + match[0].length); }
      }

      if (!active) {
        const protectedRanges = [...text.matchAll(/`[^`\n]*`|!?\[[^\]]*\]\([^)]+\)|https?:\/\/\S+/g)]
          .map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
        const hashtags = /(^|[\s([{"'.,!?;:>])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
        for (const match of text.matchAll(hashtags)) {
          const start = (match.index ?? 0) + match[1].length;
          const end = start + match[2].length + 1;
          if (protectedRanges.some(([from, to]) => start < to && end > from)) continue;
          decorations.push(Decoration.mark({
            tagName: "a",
            class: "cm-live-tag",
            attributes: { href: `/tags/${encodeURIComponent(match[2].normalize("NFC").toLocaleLowerCase())}` },
          }).range(line.from + start, line.from + end));
        }
      }

      if (line.to >= to) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

const livePreview: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = liveDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = liveDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const hashtagNavigation = EditorView.domEventHandlers({
  mousedown(event) {
    if (event.button !== 0) return false;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.cm-live-tag");
    if (!link) return false;
    event.preventDefault();
    window.location.assign(link.href);
    return true;
  },
});

export default function LiveMarkdownEditor({ markdown: value, onChange }: { markdown: string; onChange: (markdown: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const externalUpdate = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        placeholder("What’s on your mind?"),
        livePreview,
        hashtagNavigation,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate.current) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    editor.current = new EditorView({ state, parent: host.current });
    return () => { editor.current?.destroy(); editor.current = null; };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    externalUpdate.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    externalUpdate.current = false;
  }, [value]);

  function wrap(prefix: string, suffix = prefix, placeholderText = "text") {
    const view = editor.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const selected = view.state.doc.sliceString(selection.from, selection.to);
    const content = selected || placeholderText;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${prefix}${content}${suffix}` },
      selection: { anchor: selection.from + prefix.length, head: selection.from + prefix.length + content.length },
    });
    view.focus();
  }

  function prefixLine(prefix: string) {
    const view = editor.current;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    view.dispatch({ changes: { from: line.from, insert: prefix }, selection: { anchor: view.state.selection.main.head + prefix.length } });
    view.focus();
  }

  return <div className="live-markdown-editor">
    <div className="live-toolbar" role="toolbar" aria-label="Markdown formatting">
      <button type="button" aria-label="Undo" title="Undo" onClick={() => editor.current && undo(editor.current)}>↶</button>
      <button type="button" aria-label="Redo" title="Redo" onClick={() => editor.current && redo(editor.current)}>↷</button>
      <span className="toolbar-divider" />
      <button type="button" aria-label="Heading" title="Heading" onClick={() => prefixLine("## ")}>H</button>
      <button type="button" aria-label="Bold" title="Bold" className="toolbar-bold" onClick={() => wrap("**")}>B</button>
      <button type="button" aria-label="Italic" title="Italic" className="toolbar-italic" onClick={() => wrap("*")}>I</button>
      <button type="button" aria-label="Inline code" title="Inline code" onClick={() => wrap("`")}>{"<>"}</button>
      <button type="button" aria-label="Link" title="Link" onClick={() => wrap("[", "](https://)", "link text")}>↗</button>
      <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() => prefixLine("- ")}>•≡</button>
      <button type="button" aria-label="Quote" title="Quote" onClick={() => prefixLine("> ")}>❞</button>
      <span className="toolbar-hint">Markdown stays Markdown</span>
    </div>
    <div ref={host} className="live-editor-host" />
  </div>;
}
