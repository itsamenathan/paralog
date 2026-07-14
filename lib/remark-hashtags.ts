type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const skippedParents = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"]);

function linkedText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const pattern = /(^|[\s([{"'.,!?;:>])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const prefix = match[1];
    const start = (match.index ?? 0) + prefix.length;
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    const label = match[2];
    nodes.push({
      type: "link",
      url: `/tags/${encodeURIComponent(label.normalize("NFC").toLocaleLowerCase())}`,
      children: [{ type: "text", value: `#${label}` }],
    });
    cursor = start + label.length + 1;
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

export function remarkHashtags() {
  return (tree: MarkdownNode) => walk(tree);
}
