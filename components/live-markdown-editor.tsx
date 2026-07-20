"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec, type Extension, type Range } from "@codemirror/state";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { journalReferences } from "@/lib/markdown-references";
import { exitEmptyMarkdownBlock, keepMobileCursorVisible } from "@/lib/editor/commands";
import { attachmentMarkdown, type AttachmentKind, type AttachmentSummary } from "@/lib/attachment-types";
import { AttachmentPicker } from "./attachments/attachment-picker";
import { EditorToolbar } from "./editor/editor-toolbar";
import { SuggestionMenu, type SuggestionMenuItem } from "./editor/suggestion-menu";
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
  let metadataEndLine = 0;
  if (view.state.doc.line(1).text.trim() === "---") {
    for (let lineNumber = 2; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      if (view.state.doc.line(lineNumber).text.trim() === "---") {
        metadataEndLine = lineNumber;
        break;
      }
    }
  }
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

      if (metadataEndLine && line.number <= metadataEndLine) {
        const positionClass = line.number === 1
          ? " cm-live-metadata-start"
          : line.number === metadataEndLine
            ? " cm-live-metadata-end"
            : "";
        decorations.push(Decoration.line({ class: `cm-live-metadata${positionClass}` }).range(line.from));

        if (line.number === 1 || line.number === metadataEndLine) {
          addMark(line.from, line.to, "cm-live-metadata-delimiter");
        } else {
          const field = text.match(/^(\s*)([\w-]+)(\s*:)(.*)$/);
          if (field) {
            const keyFrom = line.from + field[1].length;
            const separatorEnd = keyFrom + field[2].length + field[3].length;
            addMark(keyFrom, keyFrom + field[2].length, "cm-live-metadata-key");
            addMark(separatorEnd, line.to, "cm-live-metadata-value");
          }
        }

        if (line.to >= to) break;
        position = line.to + 1;
        continue;
      }

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
        const labelFrom = start + 1;
        const labelTo = labelFrom + match[1].length;
        const href = match[2].trim();
        if (!active && /^(https?:\/\/|mailto:|\/|#)/i.test(href)) {
          decorations.push(Decoration.mark({
            tagName: "a",
            class: "cm-live-link cm-live-navigation",
            attributes: { href, ...(/^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {}) },
          }).range(labelFrom, labelTo));
        } else addMark(labelFrom, labelTo, "cm-live-link");
        if (!active) { hide(start, start + 1); hide(labelTo, start + match[0].length); }
      }

      if (!active) {
        const protectedRanges = [...text.matchAll(/`[^`\n]*`|!?\[[^\]]*\]\([^)]+\)/g)]
          .map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
        const rawUrls = /https?:\/\/[^\s<]+/gi;
        for (let match = rawUrls.exec(text); match; match = rawUrls.exec(text)) {
          const href = match[0].replace(/[.,!?;:'"]+$/, "");
          const from = match.index;
          const to = from + href.length;
          if (!href || protectedRanges.some(([protectedFrom, protectedTo]) => from < protectedTo && to > protectedFrom)) continue;
          protectedRanges.push([from, to]);
          decorations.push(Decoration.mark({
            tagName: "a",
            class: "cm-live-link cm-live-navigation",
            attributes: { href, target: "_blank", rel: "noreferrer" },
          }).range(line.from + from, line.from + to));
        }
        for (const reference of journalReferences(text)) {
          if (protectedRanges.some(([from, to]) => reference.from < to && reference.to > from)) continue;
          const collection = reference.kind === "tag" ? "tags" : "people";
          decorations.push(Decoration.mark({
            tagName: "a",
            class: `cm-live-reference cm-live-${reference.kind} cm-live-navigation`,
            attributes: { href: `/${collection}/${encodeURIComponent(reference.label.normalize("NFC").toLocaleLowerCase())}` },
          }).range(line.from + reference.from, line.from + reference.to));
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

const referenceNavigation = EditorView.domEventHandlers({
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

type LiveMarkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  onUpload: (file: File) => Promise<AttachmentSummary | null>;
  entryDate: string;
  online: boolean;
  template: string;
  jumpToLine: number | null;
  onJumpHandled: () => void;
  vimMode: boolean;
  tags: ReferenceSuggestion[];
  people: ReferenceSuggestion[];
};

type ReferenceSuggestion = { name: string; count: number };
type ReferenceQuery = { kind: "tag" | "person"; query: string; from: number; to: number };

export default function LiveMarkdownEditor({ markdown: value, onChange, onUpload, entryDate, online, template, jumpToLine, onJumpHandled, vimMode, tags, people }: LiveMarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const vimCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onUploadRef = useRef(onUpload);
  const externalUpdate = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItemsRef = useRef<SuggestionMenuItem[]>([]);
  const menuIndexRef = useRef(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [referenceQuery, setReferenceQuery] = useState<ReferenceQuery | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [pickerMode, setPickerMode] = useState<"all" | AttachmentKind | null>(null);
  const [pickerPosition, setPickerPosition] = useState<number | null>(null);
  onChangeRef.current = onChange;
  onUploadRef.current = onUpload;

  const selectMenuIndex = (index: number) => {
    menuIndexRef.current = index;
    setMenuIndex(index);
    window.requestAnimationFrame(() => menuRef.current?.querySelector("button.active")?.scrollIntoView({ block: "nearest" }));
  };

  useEffect(() => { selectMenuIndex(0); }, [slashQuery, referenceQuery?.kind, referenceQuery?.query]);

  async function insertUploads(files: File[], position?: number) {
    const view = editor.current;
    if (!view || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const uploads = (await Promise.all(files.map((file) => onUploadRef.current(file)))).filter((result): result is AttachmentSummary => Boolean(result));
      const results = uploads.map(attachmentMarkdown);
      if (results.length === 0) throw new Error("Upload failed");
      insertMarkdown(results, position);
    } catch {
      setUploadError("Could not upload attachment");
    } finally {
      setUploading(false);
    }
  }

  function insertMarkdown(results: string[], position?: number) {
    const view = editor.current;
    if (!view || results.length === 0) return;
    const target = Math.min(position ?? view.state.selection.main.head, view.state.doc.length);
    const before = target > 0 ? view.state.doc.sliceString(target - 1, target) : "";
    const insert = `${before && before !== "\n" ? "\n" : ""}${results.join("\n")}\n`;
    view.dispatch({ changes: { from: target, insert }, selection: { anchor: target + insert.length } });
    window.requestAnimationFrame(() => view.focus());
  }

  useEffect(() => {
    if (!host.current) return;
    const editorEvents = EditorView.domEventHandlers({
      keydown(event) {
        const items = menuItemsRef.current;
        if (items.length === 0) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          selectMenuIndex((menuIndexRef.current + offset + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
          event.preventDefault();
          items[Math.min(menuIndexRef.current, items.length - 1)].run();
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          menuItemsRef.current = [];
          setSlashQuery(null);
          setReferenceQuery(null);
          return true;
        }
        return false;
      },
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
        EditorView.contentAttributes.of({ spellcheck: "true" }),
        placeholder("What’s on your mind?"),
        livePreview,
        referenceNavigation,
        Prec.high(editorEvents),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate.current) onChangeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const selection = update.state.selection.main;
            setHasSelection(!selection.empty);
            const line = update.state.doc.lineAt(selection.head);
            const beforeCursor = line.text.slice(0, selection.head - line.from);
            if (selection.empty) {
              const slashMatch = beforeCursor.match(/^\/([a-z-]*)$/i);
              setSlashQuery(slashMatch?.[1].toLowerCase() ?? null);
              const referenceMatch = slashMatch ? null : beforeCursor.match(/(^|[\s([{"'.,!?;:>])([#@])([\p{L}\p{N}_-]*)$/u);
              setReferenceQuery(referenceMatch ? {
                kind: referenceMatch[2] === "#" ? "tag" : "person",
                query: referenceMatch[3],
                from: selection.head - referenceMatch[3].length,
                to: selection.head,
              } : null);
            } else {
              setSlashQuery(null);
              setReferenceQuery(null);
            }
            keepMobileCursorVisible(update.view);
          }
        }),
      ],
    });
    editor.current = new EditorView({ state, parent: host.current });
    const polishVimStatus = () => {
      const panel = host.current?.querySelector<HTMLElement>(".cm-vim-panel");
      const status = panel?.firstElementChild;
      if (!panel || !(status instanceof HTMLSpanElement)) return;
      const match = status.textContent?.match(/^--(.+)--$/);
      if (!match) return;
      const rawMode = match[1];
      const mode = rawMode.split(/[ (]/, 1)[0].toLowerCase();
      const label = rawMode
        .replace("(C-O)", " · command")
        .toLowerCase()
        .replace(/(^|\s)\p{L}/gu, (value) => value.toUpperCase());
      panel.dataset.vimMode = mode;
      status.textContent = label;
      status.setAttribute("aria-label", `Vim mode: ${label}`);
    };
    const vimStatusObserver = new MutationObserver(polishVimStatus);
    vimStatusObserver.observe(host.current, { childList: true, subtree: true, characterData: true });
    polishVimStatus();
    return () => { vimStatusObserver.disconnect(); editor.current?.destroy(); editor.current = null; };
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

  function insertReference(name: string, query: ReferenceQuery) {
    const view = editor.current;
    if (!view) return;
    view.dispatch({
      changes: { from: query.from, to: query.to, insert: name },
      selection: { anchor: query.from + name.length },
    });
    setReferenceQuery(null);
    view.focus();
  }

  const slashCommands = [
    { label: "Heading", hint: "Section heading", run: () => runSlash("## ") },
    { label: "List", hint: "Bulleted list", run: () => runSlash("- ") },
    { label: "Task", hint: "Markdown checkbox", run: () => runSlash("- [ ] ") },
    { label: "Quote", hint: "Block quote", run: () => runSlash("> ") },
    { label: "Code block", hint: "Fenced code", run: () => runSlash("```\n\n```", 4) },
    { label: "Image", hint: "Upload or choose an image", run: () => { const position = clearSlash(); setPickerPosition(position); setPickerMode("image"); } },
    { label: "Attachment", hint: "Upload or choose any file", run: () => { const position = clearSlash(); setPickerPosition(position); setPickerMode("all"); } },
    ...(template ? [{ label: "Template", hint: "Insert your entry template", run: () => runSlash(template) }] : []),
  ].filter((command) => slashQuery === null || command.label.toLowerCase().includes(slashQuery));

  const normalizedReferenceQuery = referenceQuery?.query.normalize("NFC").toLocaleLowerCase() ?? "";
  const referenceSuggestions: SuggestionMenuItem[] = referenceQuery ? (referenceQuery.kind === "tag" ? tags : people)
    .filter((reference) => {
      const normalizedName = reference.name.normalize("NFC").toLocaleLowerCase();
      return normalizedName.startsWith(normalizedReferenceQuery) && normalizedName !== normalizedReferenceQuery;
    })
    .slice(0, 8)
    .map((reference) => ({
      label: `${referenceQuery.kind === "tag" ? "#" : "@"}${reference.name}`,
      hint: `${reference.count} ${reference.count === 1 ? "entry" : "entries"}`,
      run: () => insertReference(reference.name, referenceQuery),
    })) : [];
  const menuItems: SuggestionMenuItem[] = slashQuery !== null ? slashCommands : referenceSuggestions;
  const menuLabel = slashQuery !== null ? "Insert Markdown block" : referenceQuery?.kind === "tag" ? "Choose a tag" : "Choose a person";
  menuItemsRef.current = menuItems;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const view = editor.current;
    if (!menu || !view || menuItems.length === 0) return;
    const position = () => {
      const caret = view.coordsAtPos(view.state.selection.main.head);
      if (!caret) return;
      const activeLine = view.dom.querySelector(".cm-activeLine")?.getBoundingClientRect();
      const anchorTop = activeLine ? Math.min(caret.top, activeLine.top) : caret.top;
      const anchorBottom = activeLine ? Math.max(caret.bottom, activeLine.bottom) : caret.bottom;
      const viewport = window.visualViewport;
      const visibleTop = (viewport?.offsetTop ?? 0) + 8;
      const visibleBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      const gap = 8;
      const belowSpace = Math.max(0, visibleBottom - anchorBottom - gap);
      const aboveSpace = Math.max(0, anchorTop - visibleTop - gap);
      const naturalHeight = Math.min(menu.scrollHeight, 320);
      const below = belowSpace >= Math.min(naturalHeight, 160) || belowSpace >= aboveSpace;
      const availableHeight = below ? belowSpace : aboveSpace;
      const height = Math.min(naturalHeight, Math.max(48, availableHeight));
      menu.style.maxHeight = `${height}px`;
      menu.style.top = `${below ? anchorBottom + gap : anchorTop - gap - height}px`;
      const width = menu.getBoundingClientRect().width;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      menu.style.left = `${Math.min(Math.max(caret.left, viewportLeft + 8), viewportRight - width - 8)}px`;
      menu.dataset.placement = below ? "below" : "above";
      menu.dataset.positioned = "true";
    };
    position();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
    };
  }, [menuItems.length, normalizedReferenceQuery, referenceQuery?.kind, slashQuery]);

  return <div className="live-markdown-editor">
    <EditorToolbar
      uploading={uploading}
      uploadError={uploadError}
      onUndo={() => { if (editor.current) undo(editor.current); }}
      onRedo={() => { if (editor.current) redo(editor.current); }}
      onHeading={() => prefixLine("## ")}
      onBold={() => wrap("**")}
      onItalic={() => wrap("*")}
      onCode={() => wrap("`")}
      onLink={() => setShowLinkInput(true)}
      onList={() => prefixLine("- ")}
      onQuote={() => prefixLine("> ")}
      onSearch={() => { if (editor.current) openSearchPanel(editor.current); }}
    />
    {showLinkInput && <form className="link-insert" onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
      <input autoFocus type="text" inputMode="url" placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
      <button type="submit">Insert link</button>
      <button type="button" aria-label="Cancel link" onClick={() => setShowLinkInput(false)}>×</button>
    </form>}
    <SuggestionMenu menuRef={menuRef} items={menuItems} activeIndex={menuIndex} label={menuLabel} onActiveIndexChange={selectMenuIndex} />
    <div ref={host} className="live-editor-host" />
    {hasSelection && <div className="mobile-selection-toolbar" role="toolbar" aria-label="Format selected text">
      <button type="button" aria-label="Bold selection" onClick={() => wrap("**")}>B</button>
      <button type="button" aria-label="Italicize selection" onClick={() => wrap("*")}><i>I</i></button>
      <button type="button" aria-label="Link selection" onClick={() => setShowLinkInput(true)}>↗</button>
      <button type="button" aria-label="Code selection" onClick={() => wrap("`")}>{"<>"}</button>
    </div>}
    <AttachmentPicker open={pickerMode !== null} mode={pickerMode || "all"} entryDate={entryDate} online={online} onClose={() => setPickerMode(null)} onInsert={(markdown) => insertMarkdown(markdown, pickerPosition ?? undefined)} />
  </div>;
}
