// Store only a random identity and routing IDs, never card codes, PINs or images.
export type SubmissionDraft = { submissionId: string; tradeId?: string };
const key = (userId: string) => `scous-submission:${userId}`;
export function loadDraft(userId: string): SubmissionDraft | null {
  const raw = localStorage.getItem(key(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SubmissionDraft;
    return /^[0-9a-f-]{36}$/i.test(parsed.submissionId) ? parsed : null;
  } catch { throw new Error("Your saved submission could not be read. Check trade history before starting another."); }
}
export function saveDraft(userId: string, draft: SubmissionDraft) {
  localStorage.setItem(key(userId), JSON.stringify(draft));
}
export function clearDraft(userId: string) { localStorage.removeItem(key(userId)); }
