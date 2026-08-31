import { describe, expect, it } from 'vitest';
import {
  elapsedProcessingMs,
  formatElapsedTime,
  isProcessingStatus,
} from '@/lib/documents/processing';

describe('processing tracking', () => {
  it('formats an elapsed timer', () => {
    expect(formatElapsedTime(125_900)).toBe('02:05');
  });

  it('calculates elapsed time without negative values', () => {
    expect(elapsedProcessingMs('2026-08-30T10:00:00.000Z', Date.parse('2026-08-30T10:02:00.000Z'))).toBe(120_000);
    expect(elapsedProcessingMs('2026-08-30T10:02:00.000Z', Date.parse('2026-08-30T10:00:00.000Z'))).toBe(0);
  });

  it('identifies only active processing states', () => {
    expect(isProcessingStatus('analyzing')).toBe(true);
    expect(isProcessingStatus('completed')).toBe(false);
  });
});
