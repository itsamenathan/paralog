import Login from "@/components/login";
import { AttachmentLibrary } from "@/components/attachments/attachment-library";
import { isAuthenticated, passwordConfigured } from "@/lib/auth";

export default async function AttachmentsPage({ searchParams }: { searchParams: Promise<{ entry?: string }> }) {
  if (!await isAuthenticated()) return <Login configured={passwordConfigured()} />;
  const entry = (await searchParams).entry || "";
  return <AttachmentLibrary initialEntry={/^\d{4}-\d{2}-\d{2}$/.test(entry) ? entry : ""} />;
}
