export type JournalReference = {
  kind: "tag" | "person";
  label: string;
  from: number;
  to: number;
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const skippedParents = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"]);
const referencePattern = /(^|[\s([{"'.,!?;:>])([#@])([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

export function journalReferences(value: string): JournalReference[] {
  return [...value.matchAll(referencePattern)].map((match) => {
    const from = (match.index ?? 0) + match[1].length;
    return {
      kind: match[2] === "#" ? "tag" : "person",
      label: match[3],
      from,
      to: from + match[3].length + 1,
    };
  });
}

function linkedText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const reference of journalReferences(value)) {
    if (reference.from > cursor) nodes.push({ type: "text", value: value.slice(cursor, reference.from) });
    const marker = reference.kind === "tag" ? "#" : "@";
    const collection = reference.kind === "tag" ? "tags" : "people";
    nodes.push({
      type: "link",
      url: `/${collection}/${encodeURIComponent(reference.label.normalize("NFC").toLocaleLowerCase())}`,
      children: [{ type: "text", value: `${marker}${reference.label}` }],
    });
    cursor = reference.to;
  }
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value }];
}

function walk(node: MarkdownNode) {
  if (skippedParents.has(node.type) || !node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return linkedText(child.value);
    walk(child);
    return child;
  });
}

export function remarkJournalReferences() {
  return (tree: MarkdownNode) => walk(tree);
}
