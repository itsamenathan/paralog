"use client";

import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec, type Extension, type Range } from "@codemirror/state";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  placeholder,
  keymap,
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

const exitEmptyMarkdownBlock = ({ state, dispatch }: { state: EditorState; dispatch: (transaction: ReturnType<EditorState["update"]>) => void }) => {
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const afterCursor = state.doc.sliceString(selection.head, line.to);
  if (!/^\s*$/.test(afterCursor) || !/^\s*(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?|>\s*)$/.test(line.text)) return false;
  dispatch(state.update({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } }));
  return true;
};

function keepMobileCursorVisible(view: EditorView) {
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

type LiveMarkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  onUpload: (file: File) => Promise<string | null>;
  template: string;
  jumpToLine: number | null;
  onJumpHandled: () => void;
  vimMode: boolean;
};

export default function LiveMarkdownEditor({ markdown: value, onChange, onUpload, template, jumpToLine, onJumpHandled, vimMode }: LiveMarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const vimCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onUploadRef = useRef(onUpload);
  const externalUpdate = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  onChangeRef.current = onChange;
  onUploadRef.current = onUpload;

  async function insertUploads(files: File[], position?: number) {
    const view = editor.current;
    if (!view || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const results = (await Promise.all(files.map((file) => onUploadRef.current(file)))).filter((result): result is string => Boolean(result));
      if (results.length === 0) throw new Error("Upload failed");
      const target = Math.min(position ?? view.state.selection.main.head, view.state.doc.length);
      const before = target > 0 ? view.state.doc.sliceString(target - 1, target) : "";
      const insert = `${before && before !== "\n" ? "\n" : ""}${results.join("\n")}\n`;
      view.dispatch({ changes: { from: target, insert }, selection: { anchor: target + insert.length } });
      view.focus();
    } catch {
      setUploadError("Could not upload attachment");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!host.current) return;
    const editorEvents = EditorView.domEventHandlers({
      paste(event, view) {
        const files = [...event.clipboardData?.files || []];
        if (files.length > 0) {
          event.preventDefault();
          void insertUploads(files, view.state.selection.main.head);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain").trim() || "";
        const selection = view.state.selection.main;
        if (!selection.empty && /^(https?:\/\/|mailto:)/i.test(text)) {
          event.preventDefault();
          const selected = view.state.doc.sliceString(selection.from, selection.to);
          const trailing = selected.match(/\s+$/)?.[0] ?? "";
          const label = selected.slice(0, selected.length - trailing.length) || "link text";
          view.dispatch({ changes: { from: selection.from, to: selection.to, insert: `[${label}](${text})${trailing}` } });
          return true;
        }
        return false;
      },
      drop(event, view) {
        const files = [...event.dataTransfer?.files || []];
        if (files.length === 0) return false;
        event.preventDefault();
        void insertUploads(files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head);
        return true;
      },
      dragover(event) {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        return false;
      },
      focus(_event, view) {
        keepMobileCursorVisible(view);
        return false;
      },
    });
    const state = EditorState.create({
      doc: value,
      extensions: [
        vimCompartment.current.of([]),
        basicSetup,
        markdown(),
        Prec.high(keymap.of([{ key: "Enter", run: exitEmptyMarkdownBlock }, { key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess }])),
        EditorView.lineWrapping,
        placeholder("What’s on your mind?"),
        livePreview,
        hashtagNavigation,
        editorEvents,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate.current) onChangeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const selection = update.state.selection.main;
            setHasSelection(!selection.empty);
            const line = update.state.doc.lineAt(selection.head);
            const beforeCursor = line.text.slice(0, selection.head - line.from);
            setSlashQuery(beforeCursor.match(/^\/([a-z-]*)$/i)?.[1].toLowerCase() ?? null);
            keepMobileCursorVisible(update.view);
          }
        }),
      ],
    });
    editor.current = new EditorView({ state, parent: host.current });
    return () => { editor.current?.destroy(); editor.current = null; };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 721px) and (pointer: fine)");
    const configureVim = () => {
      const view = editor.current;
      if (!view) return;
      view.dispatch({ effects: vimCompartment.current.reconfigure(vimMode && desktop.matches ? vim({ status: true }) : []) });
    };
    configureVim();
    desktop.addEventListener("change", configureVim);
    return () => desktop.removeEventListener("change", configureVim);
  }, [vimMode]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const revealCursor = () => { if (editor.current) keepMobileCursorVisible(editor.current); };
    viewport.addEventListener("resize", revealCursor);
    viewport.addEventListener("scroll", revealCursor);
    window.addEventListener("paralog:keyboard-viewport", revealCursor);
    return () => {
      viewport.removeEventListener("resize", revealCursor);
      viewport.removeEventListener("scroll", revealCursor);
      window.removeEventListener("paralog:keyboard-viewport", revealCursor);
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    externalUpdate.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    externalUpdate.current = false;
  }, [value]);

  useEffect(() => {
    const view = editor.current;
    if (!view || jumpToLine === null) return;
    const line = view.state.doc.line(Math.max(1, Math.min(jumpToLine, view.state.doc.lines)));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus();
    onJumpHandled();
  }, [jumpToLine, onJumpHandled]);

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

  function applyLink() {
    const view = editor.current;
    const raw = linkUrl.trim();
    if (!view || !raw) return;
    const url = /^(https?:\/\/|mailto:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
    const selection = view.state.selection.main;
    const selected = view.state.doc.sliceString(selection.from, selection.to);
    const trailing = selected.match(/\s+$/)?.[0] ?? "";
    const label = selected.slice(0, selected.length - trailing.length) || "link text";
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `[${label}](${url})${trailing}` },
      selection: { anchor: selection.from + 1, head: selection.from + 1 + label.length },
    });
    setShowLinkInput(false);
    setLinkUrl("");
    view.focus();
  }

  function clearSlash() {
    const view = editor.current;
    if (!view) return null;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    view.dispatch({ changes: { from: line.from, to: selection.head, insert: "" }, selection: { anchor: line.from } });
    setSlashQuery(null);
    return line.from;
  }

  function runSlash(insert: string, cursorOffset = insert.length) {
    const view = editor.current;
    const position = clearSlash();
    if (!view || position === null) return;
    view.dispatch({ changes: { from: position, insert }, selection: { anchor: position + cursorOffset } });
    view.focus();
  }

  const slashCommands = [
    { label: "Heading", hint: "Section heading", run: () => runSlash("## ") },
    { label: "List", hint: "Bulleted list", run: () => runSlash("- ") },
    { label: "Task", hint: "Markdown checkbox", run: () => runSlash("- [ ] ") },
    { label: "Quote", hint: "Block quote", run: () => runSlash("> ") },
    { label: "Code block", hint: "Fenced code", run: () => runSlash("```\n\n```", 4) },
    { label: "Image", hint: "Upload an image", run: () => { clearSlash(); imageInput.current?.click(); } },
    { label: "Attachment", hint: "Upload any file", run: () => { clearSlash(); attachmentInput.current?.click(); } },
    ...(template ? [{ label: "Template", hint: "Insert your entry template", run: () => runSlash(template) }] : []),
  ].filter((command) => slashQuery === null || command.label.toLowerCase().includes(slashQuery));

  return <div className="live-markdown-editor">
    <div className="live-toolbar" role="toolbar" aria-label="Markdown formatting">
      <button type="button" aria-label="Undo" title="Undo" onClick={() => editor.current && undo(editor.current)}>↶</button>
      <button type="button" aria-label="Redo" title="Redo" onClick={() => editor.current && redo(editor.current)}>↷</button>
      <span className="toolbar-divider" />
      <button type="button" aria-label="Heading" title="Heading" onClick={() => prefixLine("## ")}>H</button>
      <button type="button" aria-label="Bold" title="Bold" className="toolbar-bold" onClick={() => wrap("**")}>B</button>
      <button type="button" aria-label="Italic" title="Italic" className="toolbar-italic" onClick={() => wrap("*")}>I</button>
      <button type="button" aria-label="Inline code" title="Inline code" onClick={() => wrap("`")}>{"<>"}</button>
      <button type="button" aria-label="Link" title="Link" onClick={() => setShowLinkInput(true)}>↗</button>
      <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() => prefixLine("- ")}>•≡</button>
      <button type="button" aria-label="Quote" title="Quote" onClick={() => prefixLine("> ")}>❞</button>
      <button type="button" aria-label="Find and replace" title="Find and replace" onClick={() => editor.current && openSearchPanel(editor.current)}>⌕</button>
      <span className="toolbar-hint">Markdown stays Markdown</span>
      {uploading && <span className="toolbar-status">Uploading…</span>}
      {uploadError && <span className="toolbar-status error">{uploadError}</span>}
    </div>
    {showLinkInput && <form className="link-insert" onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
      <input autoFocus type="text" inputMode="url" placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
      <button type="submit">Insert link</button>
      <button type="button" aria-label="Cancel link" onClick={() => setShowLinkInput(false)}>×</button>
    </form>}
    {slashQuery !== null && slashCommands.length > 0 && <div className="slash-menu" role="menu" aria-label="Insert Markdown block">
      {slashCommands.map((command) => <button type="button" role="menuitem" key={command.label} onClick={command.run}><b>{command.label}</b><span>{command.hint}</span></button>)}
    </div>}
    <div ref={host} className="live-editor-host" />
    {hasSelection && <div className="mobile-selection-toolbar" role="toolbar" aria-label="Format selected text">
      <button type="button" aria-label="Bold selection" onClick={() => wrap("**")}>B</button>
      <button type="button" aria-label="Italicize selection" onClick={() => wrap("*")}><i>I</i></button>
      <button type="button" aria-label="Link selection" onClick={() => setShowLinkInput(true)}>↗</button>
      <button type="button" aria-label="Code selection" onClick={() => wrap("`")}>{"<>"}</button>
    </div>}
    <input ref={imageInput} className="editor-file-input" type="file" accept="image/*" onChange={(event) => { void insertUploads([...event.target.files || []]); event.target.value = ""; }} />
    <input ref={attachmentInput} className="editor-file-input" type="file" onChange={(event) => { void insertUploads([...event.target.files || []]); event.target.value = ""; }} />
  </div>;
}
