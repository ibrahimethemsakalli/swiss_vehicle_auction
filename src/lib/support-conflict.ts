export type SupportConflict = { previousVersion: number; loadedVersion: number | null } | null;
export function loadedSupportConflict(conflict: SupportConflict, version: number): SupportConflict {
  return conflict ? { ...conflict, loadedVersion: version } : null;
}
export function canReviewSupportConflict(
  conflict: SupportConflict,
  version: number | undefined,
  loading: boolean,
) {
  return Boolean(
    conflict && conflict.loadedVersion !== null && conflict.loadedVersion === version && !loading,
  );
}
