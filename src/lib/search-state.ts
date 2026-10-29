import { z } from 'zod';
import { filterInput } from './market-query';
import type { Filters } from './market-types';

export const defaultFilters: Filters = filterInput.parse({});
export type SearchState = { filters: Filters; page: number; onlySaved: boolean };
export function readSearchState(search: string): SearchState {
  const params = new URLSearchParams(search);
  let filters = defaultFilters;
  try {
    const raw = params.get('filters');
    if (raw && raw.length <= 12000) filters = filterInput.parse(JSON.parse(raw));
  } catch {
    /* Invalid shared links fall back to safe defaults. */
  }
  const page = Number(params.get('page') || 1);
  return {
    filters,
    page: Number.isInteger(page) && page > 0 && page <= 100000 ? page : 1,
    onlySaved: params.get('saved') === '1',
  };
}
export function searchHref(state: SearchState, current = '/') {
  const url = new URL(current, 'https://local.invalid');
  url.searchParams.delete('filters');
  url.searchParams.delete('page');
  url.searchParams.delete('saved');
  const filters = filterInput.parse(state.filters);
  if (JSON.stringify(filters) !== JSON.stringify(defaultFilters))
    url.searchParams.set('filters', JSON.stringify(filters));
  if (state.page > 1) url.searchParams.set('page', String(state.page));
  if (state.onlySaved) url.searchParams.set('saved', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}
export const savedSearchCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      name: z.string().trim().min(1).max(60),
      filters: filterInput,
      alerts: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('delete'), id: z.uuid() }).strict(),
]);
