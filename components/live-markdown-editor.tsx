"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { capitalizeFirstListItemCharacter, continueMarkdownList, exitEmptyMarkdownBlock, externalDocumentChange, keepMobileCursorVisible } from "@/lib/editor/commands";
import { livePreviewExtension, moveLivePreviewVertically, propertyIconConfig } from "@/lib/editor/live-preview";
import { attachmentMarkdown, type AttachmentKind, type AttachmentSummary } from "@/lib/attachment-types";
import { propertyIconName, type PropertyIcons } from "@/lib/property-icons";
import { AttachmentPicker } from "./attachments/attachment-picker";
import { EditorToolbar } from "./editor/editor-toolbar";
import { PropertyIconPopover } from "./editor/property-icon-picker";
import { SuggestionMenu, type SuggestionMenuItem } from "./editor/suggestion-menu";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  placeholder,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";

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
  onBeforeAttachmentNavigation: () => void;
  propertyIcons: PropertyIcons;
  onPropertyIconChange: (property: string, icon: string | null) => void;
};

type ReferenceSuggestion = { name: string; count: number };
type ReferenceQuery = { kind: "tag" | "person"; query: string; from: number; to: number };

// Matches CodeMirror's `basicSetup`, with journaling-friendly undo grouping.
const editorSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history({ newGroupDelay: 1000 }),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];

export default function LiveMarkdownEditor({ markdown: value, onChange, onUpload, entryDate, online, template, jumpToLine, onJumpHandled, vimMode, tags, people, onBeforeAttachmentNavigation, propertyIcons, onPropertyIconChange }: LiveMarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const vimCompartment = useRef(new Compartment());
  const iconCompartment = useRef(new Compartment());
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
  const [iconProperty, setIconProperty] = useState<string | null>(null);
  // Kept stable so a reconfigure only ever fires for an actual icon change.
  const openIconPickerRef = useRef<(property: string) => void>(() => {});
  openIconPickerRef.current = (property) => setIconProperty(property);
  const openIconPicker = useRef((property: string) => openIconPickerRef.current(property)).current;
  const propertyIconsRef = useRef(propertyIcons);
  propertyIconsRef.current = propertyIcons;
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
        if (items.length > 0) {
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
        }
        const activeEditor = editor.current;
        if (event.key === "Enter" && activeEditor && (exitEmptyMarkdownBlock(activeEditor) || continueMarkdownList(activeEditor))) {
          event.preventDefault();
          activeEditor.focus();
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
        iconCompartment.current.of(propertyIconConfig.of({ icons: propertyIconsRef.current, openPicker: openIconPicker })),
        editorSetup,
        markdown({ base: markdownLanguage }),
        Prec.high(keymap.of([
          { key: "ArrowUp", run: (view) => moveLivePreviewVertically(view, -1), shift: (view) => moveLivePreviewVertically(view, -1, true) },
          { key: "ArrowDown", run: (view) => moveLivePreviewVertically(view, 1), shift: (view) => moveLivePreviewVertically(view, 1, true) },
          { key: "Tab", run: indentMore },
          { key: "Shift-Tab", run: indentLess },
        ])),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocorrect: "on",
          autocapitalize: "sentences",
        }),
        EditorState.transactionFilter.of(capitalizeFirstListItemCharacter),
        placeholder("What’s on your mind?"),
        scrollPastEnd(),
        livePreviewExtension(),
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
    editor.current?.dispatch({
      effects: iconCompartment.current.reconfigure(propertyIconConfig.of({ icons: propertyIcons, openPicker: openIconPicker })),
    });
  }, [propertyIcons, openIconPicker]);

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
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    externalUpdate.current = true;
    view.dispatch({ changes: externalDocumentChange(current, value), scrollIntoView: false });
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
    <AttachmentPicker open={pickerMode !== null} mode={pickerMode || "all"} entryDate={entryDate} online={online} onClose={() => setPickerMode(null)} onInsert={(markdown) => insertMarkdown(markdown, pickerPosition ?? undefined)} onBeforeNavigate={onBeforeAttachmentNavigation} />
    {iconProperty && <PropertyIconPopover
      property={iconProperty}
      value={propertyIconName(propertyIcons, iconProperty)}
      canReset={iconProperty in propertyIcons}
      anchor={() => host.current?.querySelector<HTMLElement>(`.cm-live-property-icon[data-property="${CSS.escape(iconProperty)}"]`) ?? null}
      onSelect={(icon) => { onPropertyIconChange(iconProperty, icon); setIconProperty(null); }}
      onReset={() => { onPropertyIconChange(iconProperty, null); setIconProperty(null); }}
      onClose={() => setIconProperty(null)}
    />}
  </div>;
}
