export const PROCESSING_DOCUMENT_STATUSES = [
  'extracting',
  'analyzing',
  'reconciling',
] as const;

export function canArchiveDocument(status: string) {
  return !PROCESSING_DOCUMENT_STATUSES.includes(
    status as (typeof PROCESSING_DOCUMENT_STATUSES)[number],
  );
}
