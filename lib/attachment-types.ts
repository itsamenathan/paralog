export type AttachmentKind = "image" | "document";

export type AttachmentReference = {
  date: string;
  occurrences: number;
};

export type AttachmentSummary = {
  path: string;
  displayName: string;
  mediaType: string;
  kind: AttachmentKind;
  size: number;
  addedAt: string;
  modifiedAt: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  references: AttachmentReference[];
  missing: boolean;
};

export type AttachmentListResponse = {
  items: AttachmentSummary[];
  nextCursor: string | null;
  total: number;
  totals: {
    files: number;
    images: number;
    documents: number;
    linked: number;
    unlinked: number;
    missing: number;
    bytes: number;
  };
};

export function attachmentMarkdown(attachment: Pick<AttachmentSummary, "displayName" | "fileUrl" | "kind">) {
  const label = attachment.displayName.replace(/([\\\[\]])/g, "\\$1");
  return attachment.kind === "image" ? `![${label}](${attachment.fileUrl})` : `[${label}](${attachment.fileUrl})`;
}
