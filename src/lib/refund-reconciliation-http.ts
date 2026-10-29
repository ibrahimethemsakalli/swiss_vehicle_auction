export function reconciliationHandlers(
  read: (id: string, page: number) => Promise<unknown>,
  authenticate: () => Promise<string>,
) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  return {
    GET: async (r: Request) => {
      try {
        const id = await authenticate(),
          q = new URL(r.url).searchParams;
        if ([...q.keys()].some((k) => k !== 'page') || q.getAll('page').length > 1)
          throw Error('INVALID_QUERY');
        const raw = q.get('page') ?? '1';
        if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 10000) throw Error('INVALID_QUERY');
        return Response.json(await read(id, Number(raw)), { headers });
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        const status =
          code === 'UNAUTHORIZED'
            ? 401
            : code === 'FORBIDDEN'
              ? 403
              : code === 'INVALID_QUERY'
                ? 400
                : 503;
        return Response.json({ error: status === 503 ? 'UNAVAILABLE' : code }, { status, headers });
      }
    },
    POST: async () =>
      Response.json({ error: 'READ_ONLY' }, { status: 405, headers: { ...headers, Allow: 'GET' } }),
  };
}
