import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { journalReferences } from "../../markdown-references.ts";

export type PreviewRange = { from: number; to: number };
export type LivePreviewNodeKind =
  | "heading"
  | "quote"
  | "list-marker"
  | "task"
  | "strong"
  | "emphasis"
  | "strike"
  | "inline-code"
  | "link"
  | "image"
  | "code-block"
  | "raw-url"
  | "tag"
  | "person"
  | "metadata";

export type LivePreviewNode = {
  kind: LivePreviewNodeKind;
  from: number;
  to: number;
  lineFrom: number;
  markerRanges?: readonly PreviewRange[];
  attributes?: Readonly<Record<string, string | number | boolean>>;
};

const frontMatterEndCache = new WeakMap<object, number>();

function directChildRanges(node: SyntaxNode, name: string) {
  const ranges: PreviewRange[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === name) ranges.push({ from: cursor.from, to: cursor.to });
    } while (cursor.nextSibling());
  }
  return ranges;
}

function contentBetweenMarkers(node: SyntaxNode, markers: readonly PreviewRange[]) {
  return {
    from: markers[0]?.to ?? node.from,
    to: markers.at(-1)?.from ?? node.to,
  };
}

export function frontMatterEndLine(state: EditorState) {
  const cached = frontMatterEndCache.get(state.doc);
  if (cached !== undefined) return cached;
  if (state.doc.line(1).text.trim() !== "---") {
    frontMatterEndCache.set(state.doc, 0);
    return 0;
  }
  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
    if (state.doc.line(lineNumber).text.trim() === "---") {
      frontMatterEndCache.set(state.doc, lineNumber);
      return lineNumber;
    }
  }
  frontMatterEndCache.set(state.doc, 0);
  return 0;
}

function mergedRanges(state: EditorState, ranges: readonly PreviewRange[], activeLine: number) {
  const active = state.doc.line(activeLine);
  const sorted = [...ranges, { from: active.from, to: active.to }].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: PreviewRange[] = [];
  for (const range of sorted) {
    const bounded = {
      from: Math.max(0, Math.min(state.doc.length, range.from)),
      to: Math.max(0, Math.min(state.doc.length, range.to)),
    };
    const previous = merged.at(-1);
    if (previous && bounded.from <= previous.to + 1) previous.to = Math.max(previous.to, bounded.to);
    else merged.push(bounded);
  }
  return merged;
}

function metadataNodes(state: EditorState, ranges: readonly PreviewRange[], metadataEnd: number) {
  if (!metadataEnd) return [];
  const nodes: LivePreviewNode[] = [];
  const included = (lineFrom: number, lineTo: number) => ranges.some((range) => lineFrom <= range.to && lineTo >= range.from);
  for (let number = 1; number <= metadataEnd; number += 1) {
    const line = state.doc.line(number);
    if (!included(line.from, line.to)) continue;
    const field = number !== 1 && number !== metadataEnd ? line.text.match(/^(\s*)([\w-]+)(\s*:)(.*)$/) : null;
    const rootField = field && field[1].length === 0 ? field : null;
    nodes.push({
      kind: "metadata",
      from: line.from,
      to: line.to,
      lineFrom: line.from,
      attributes: {
        role: number === 1 ? "start" : number === metadataEnd ? "end" : rootField ? "field" : "line",
        property: rootField?.[2]?.toLocaleLowerCase().replace(/[^a-z0-9-]/g, "") ?? "",
        keyFrom: rootField ? line.from + rootField[1].length : line.from,
        separatorFrom: rootField ? line.from + rootField[1].length + rootField[2].length : line.from,
        separatorTo: rootField ? line.from + rootField[1].length + rootField[2].length + rootField[3].length : line.from,
      },
    });
  }
  return nodes;
}

function overlaps(range: PreviewRange, protectedRanges: readonly PreviewRange[]) {
  return protectedRanges.some((protectedRange) => range.from < protectedRange.to && range.to > protectedRange.from);
}

export function collectLivePreviewNodes(
  state: EditorState,
  ranges: readonly PreviewRange[],
  activeLine = state.doc.lineAt(state.selection.main.head).number,
) {
  const visible = mergedRanges(state, ranges, activeLine);
  const metadataEnd = frontMatterEndLine(state);
  const tree = syntaxTree(state);
  const nodes: LivePreviewNode[] = metadataNodes(state, visible, metadataEnd);
  const seen = new Set<string>();
  const add = (node: LivePreviewNode) => {
    if (metadataEnd && state.doc.lineAt(node.lineFrom).number <= metadataEnd && node.kind !== "metadata") return;
    const key = `${node.kind}:${node.from}:${node.to}:${node.lineFrom}`;
    if (!seen.has(key)) {
      seen.add(key);
      nodes.push(node);
    }
  };

  for (const range of visible) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(cursor) {
        const node = cursor.node;
        const line = state.doc.lineAt(node.from);
        const text = state.sliceDoc(node.from, node.to);
        const heading = cursor.name.match(/^ATXHeading([1-6])$/);
        if (heading) {
          const marker = line.text.match(/^(#{1,6})\s+/)?.[0] ?? "";
          add({
            kind: "heading",
            from: node.from + marker.length,
            to: node.to,
            lineFrom: line.from,
            markerRanges: marker ? [{ from: node.from, to: node.from + marker.length }] : [],
            attributes: { level: Number(heading[1]) },
          });
          return;
        }
        if (cursor.name === "QuoteMark") {
          const marker = line.text.match(/^\s*>\s?/)?.[0] ?? text;
          add({
            kind: "quote",
            from: line.from + marker.length,
            to: line.to,
            lineFrom: line.from,
            markerRanges: [{ from: line.from, to: line.from + marker.length }],
          });
          return;
        }
        if (cursor.name === "ListMark") {
          const rest = state.sliceDoc(node.to, line.to);
          const trailing = rest.match(/^\s+/)?.[0].length ?? 0;
          add({
            kind: "list-marker",
            from: node.from,
            to: node.to + trailing,
            lineFrom: line.from,
            markerRanges: [{ from: node.from, to: node.to + trailing }],
            attributes: { ordered: /^\d/.test(text), indent: node.from - line.from },
          });
          return;
        }
        if (cursor.name === "TaskMarker") {
          const task = line.text.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+/);
          if (!task) return;
          const markerFrom = line.from + task[1].length;
          add({
            kind: "task",
            from: markerFrom,
            to: line.from + task[0].length,
            lineFrom: line.from,
            markerRanges: [{ from: markerFrom, to: line.from + task[0].length }],
            attributes: {
              checked: task[2].toLowerCase() === "x",
              checkboxPosition: markerFrom + task[0].indexOf("[") + 1,
            },
          });
          return;
        }
        const inlineKinds: Record<string, { kind: LivePreviewNodeKind; marker: string }> = {
          StrongEmphasis: { kind: "strong", marker: "EmphasisMark" },
          Emphasis: { kind: "emphasis", marker: "EmphasisMark" },
          Strikethrough: { kind: "strike", marker: "StrikethroughMark" },
          InlineCode: { kind: "inline-code", marker: "CodeMark" },
        };
        const inline = inlineKinds[cursor.name];
        if (inline) {
          const markerRanges = directChildRanges(node, inline.marker);
          add({ kind: inline.kind, ...contentBetweenMarkers(node, markerRanges), lineFrom: line.from, markerRanges });
          return;
        }
        if (cursor.name === "Link" || cursor.name === "Image") {
          const markerRanges = directChildRanges(node, "LinkMark");
          const match = text.match(cursor.name === "Image" ? /^!\[([^\]]*)\]\(([^)]+)\)$/ : /^\[([^\]]+)\]\(([^)]+)\)$/);
          if (!match) return;
          const labelOffset = cursor.name === "Image" ? 2 : 1;
          add({
            kind: cursor.name === "Image" ? "image" : "link",
            from: node.from + labelOffset,
            to: node.from + labelOffset + match[1].length,
            lineFrom: line.from,
            markerRanges,
            attributes: { href: match[2].trim(), label: match[1], fullFrom: node.from, fullTo: node.to },
          });
          return;
        }
        if (cursor.name === "FencedCode") {
          const first = state.doc.lineAt(node.from).number;
          const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number += 1) {
            const codeLine = state.doc.line(number);
            add({ kind: "code-block", from: codeLine.from, to: codeLine.to, lineFrom: codeLine.from });
          }
        }
      },
    });
  }

  const taskLines = new Set(nodes.filter((node) => node.kind === "task").map((node) => node.lineFrom));
  const withoutTaskBullets = nodes.filter((node) => node.kind !== "list-marker" || !taskLines.has(node.lineFrom));
  const protectedRanges = withoutTaskBullets
    .filter((node) => ["inline-code", "link", "image", "code-block"].includes(node.kind))
    .map((node) => ({
      from: Number(node.attributes?.fullFrom ?? node.from),
      to: Number(node.attributes?.fullTo ?? node.to),
    }));

  const supplemented = [...withoutTaskBullets];
  for (const range of visible) {
    let position = range.from;
    while (position <= range.to) {
      const line = state.doc.lineAt(position);
      if (!metadataEnd || line.number > metadataEnd) {
        const rawUrls = /https?:\/\/[^\s<]+/gi;
        for (let match = rawUrls.exec(line.text); match; match = rawUrls.exec(line.text)) {
          const href = match[0].replace(/[.,!?;:'"]+$/, "");
          const candidate = { from: line.from + match.index, to: line.from + match.index + href.length };
          if (href && !overlaps(candidate, protectedRanges)) {
            supplemented.push({ kind: "raw-url", ...candidate, lineFrom: line.from, attributes: { href } });
            protectedRanges.push(candidate);
          }
        }
        for (const reference of journalReferences(line.text)) {
          const candidate = { from: line.from + reference.from, to: line.from + reference.to };
          if (overlaps(candidate, protectedRanges)) continue;
          supplemented.push({
            kind: reference.kind,
            ...candidate,
            lineFrom: line.from,
            attributes: { label: reference.label },
          });
        }
        if (line.number === activeLine) {
          const boldMarkers = [...line.text.matchAll(/\*\*/g)];
          if (boldMarkers.length % 2 === 1) {
            const from = line.from + (boldMarkers.at(-1)?.index ?? 0) + 2;
            supplemented.push({ kind: "strong", from, to: line.to, lineFrom: line.from, markerRanges: [] });
          }
        }
      }
      if (line.to >= range.to || line.to === state.doc.length) break;
      position = line.to + 1;
    }
  }

  return supplemented.sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
}
