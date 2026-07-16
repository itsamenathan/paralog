const opening = /^---\r?\n/;
const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function markdownBody(markdown: string) {
  const match = markdown.match(block);
  return match ? markdown.slice(match[0].length) : markdown;
}

export function journalWordCount(markdown: string) {
  const body = markdownBody(markdown).trim();
  return body ? body.split(/\s+/).length : 0;
}

export function setLocationFrontMatter(markdown: string, location: string) {
  const value = `location: ${JSON.stringify(location)}`;
  const match = markdown.match(block);
  if (!match) {
    if (opening.test(markdown)) throw new Error("The entry has an unclosed YAML front matter block.");
    return `---\n${value}\n---\n\n${markdown}`;
  }

  const lines = match[1] ? match[1].split(/\r?\n/) : [];
  const index = lines.findIndex((line) => /^location\s*:/.test(line));
  if (index === -1) lines.push(value);
  else {
    let end = index + 1;
    while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) end += 1;
    lines.splice(index, end - index, value);
  }
  const updated = lines.join("\n");
  return `---\n${updated}\n---\n${markdown.slice(match[0].length)}`;
}
