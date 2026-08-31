export const PROCESSING_STATUSES = [
  'extracting',
  'analyzing',
  'reconciling',
] as const;

// Leave time for persisting results before Vercel reaches its 300-second limit.
export const EXTRACTION_TIMEOUT_MS = 240_000;
export const PROCESSING_STALE_MS = 120_000;
export const OCR_PAGES_PER_RUN = 1;
export const OCR_REQUEST_COOLDOWN_MS = 22_000;

export function isProcessingStatus(status: string) {
  return PROCESSING_STATUSES.includes(
    status as (typeof PROCESSING_STATUSES)[number],
  );
}

export function elapsedProcessingMs(
  startedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Math.max(0, now - started) : 0;
}

export function formatElapsedTime(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
