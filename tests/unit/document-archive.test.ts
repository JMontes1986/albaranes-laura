import { describe, expect, it } from 'vitest';
import { canArchiveDocument } from '@/lib/documents/archive';

describe('document archiving', () => {
  it.each(['extracting', 'analyzing', 'reconciling'])(
    'blocks deletion while status is %s',
    (status) => expect(canArchiveDocument(status)).toBe(false),
  );

  it.each(['pending', 'completed', 'failed'])(
    'allows safe deletion while status is %s',
    (status) => expect(canArchiveDocument(status)).toBe(true),
  );
});
