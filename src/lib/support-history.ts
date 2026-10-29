export type SupportHistoryPage = {
  entries: { id: string; body: string; staff: boolean; createdAt: string }[];
  more: boolean;
  resolvedPage?: number;
};
// Separate read-only history requests never replace the editor's ticket/version or drafts.
export async function loadSupportHistory(
  request: typeof fetch,
  id: string,
  admin: boolean,
  page: number,
  signal: AbortSignal,
  filters: { message?: string; from?: string; to?: string; context?: string } = {},
): Promise<SupportHistoryPage> {
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw Error('INVALID_PAGE');
  const query = new URLSearchParams({
    id,
    admin: String(admin),
    page: String(page || 1),
    ...(page === 0 ? { newest: 'true' } : {}),
    ...filters,
  });
  const response = await request('/api/support?' + query, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw Error('HISTORY_FAILED');
  const data = await response.json();
  if (!Array.isArray(data.entries) || typeof data.more !== 'boolean')
    throw Error('INVALID_HISTORY');
  return {
    entries: data.entries,
    more: data.more,
    ...(typeof data.resolvedPage === 'number' ? { resolvedPage: data.resolvedPage } : {}),
  };
}
