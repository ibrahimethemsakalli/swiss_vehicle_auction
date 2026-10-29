'use client';
import { useEffect, useRef, useState } from 'react';
import { defaultFilters, readSearchState, searchHref, type SearchState } from '../lib/search-state';

export function useSearchState() {
  const [state, setState] = useState<SearchState>({
    filters: defaultFilters,
    page: 1,
    onlySaved: false,
  });
  const current = useRef(state);
  useEffect(() => {
    const restore = () => {
      current.current = readSearchState(window.location.search);
      setState(current.current);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const change = (patch: Partial<SearchState>) => {
    const next = { ...current.current, ...patch };
    const href = searchHref(next, window.location.href);
    if (href !== window.location.pathname + window.location.search + window.location.hash)
      window.history.pushState(null, '', href);
    current.current = next;
    setState(next);
  };
  return { ...state, change };
}
