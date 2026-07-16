import { diffLines } from "diff";

export type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };

export function revisionChanges(before: string, after: string) {
  const changes = diffLines(before, after, { timeout: 100 }) ?? [
    { value: before, added: false, removed: true, count: before.split("\n").length },
    { value: after, added: true, removed: false, count: after.split("\n").length },
  ];
  const lines: RevisionDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  changes.forEach((change, index) => {
    const values = change.value.split("\n");
    if (values.at(-1) === "") values.pop();
    if (change.added) additions += values.length;
    if (change.removed) deletions += values.length;
    if (change.added || change.removed || values.length <= 4) {
      const type = change.added ? "added" : change.removed ? "removed" : "context";
      lines.push(...values.map((text) => ({ type, text }) as RevisionDiffLine));
      return;
    }
    const leading = index === 0 ? [] : values.slice(0, 2);
    const trailing = index === changes.length - 1 ? [] : values.slice(-2);
    lines.push(...leading.map((text) => ({ type: "context" as const, text })));
    lines.push({ type: "skip", text: "", count: values.length - leading.length - trailing.length });
    lines.push(...trailing.map((text) => ({ type: "context" as const, text })));
  });
  return { additions, deletions, lines };
}
