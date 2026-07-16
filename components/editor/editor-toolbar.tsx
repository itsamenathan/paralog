"use client";

export function EditorToolbar({
  uploading,
  uploadError,
  onUndo,
  onRedo,
  onHeading,
  onBold,
  onItalic,
  onCode,
  onLink,
  onList,
  onQuote,
  onSearch,
}: {
  uploading: boolean;
  uploadError: string;
  onUndo: () => void;
  onRedo: () => void;
  onHeading: () => void;
  onBold: () => void;
  onItalic: () => void;
  onCode: () => void;
  onLink: () => void;
  onList: () => void;
  onQuote: () => void;
  onSearch: () => void;
}) {
  return <div className="live-toolbar" role="toolbar" aria-label="Markdown formatting">
    <button type="button" aria-label="Undo" title="Undo" onClick={onUndo}>↶</button>
    <button type="button" aria-label="Redo" title="Redo" onClick={onRedo}>↷</button>
    <span className="toolbar-divider" />
    <button type="button" aria-label="Heading" title="Heading" onClick={onHeading}>H</button>
    <button type="button" aria-label="Bold" title="Bold" className="toolbar-bold" onClick={onBold}>B</button>
    <button type="button" aria-label="Italic" title="Italic" className="toolbar-italic" onClick={onItalic}>I</button>
    <button type="button" aria-label="Inline code" title="Inline code" onClick={onCode}>{"<>"}</button>
    <button type="button" aria-label="Link" title="Link" onClick={onLink}>↗</button>
    <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={onList}>•≡</button>
    <button type="button" aria-label="Quote" title="Quote" onClick={onQuote}>❞</button>
    <button type="button" aria-label="Find and replace" title="Find and replace" onClick={onSearch}>⌕</button>
    <span className="toolbar-hint">Markdown stays Markdown</span>
    {uploading && <span className="toolbar-status">Uploading…</span>}
    {uploadError && <span className="toolbar-status error">{uploadError}</span>}
  </div>;
}
