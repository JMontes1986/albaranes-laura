import { describe, expect, it } from 'vitest';
import { validateUpload } from '@/lib/security/upload';

describe('upload validation', () => {
  it('accepts a PDF only when its magic bytes are valid', () => {
    const result = validateUpload(
      { name: 'albarán.pdf', type: 'application/pdf', size: 100 },
      Buffer.from('%PDF-1.7'),
    );

    expect(result).toEqual({ safeName: 'albar_n.pdf', kind: 'pdf' });
  });

  it('accepts a CSV extension when the browser omits its MIME type', () => {
    const result = validateUpload(
      { name: 'unidades.csv', type: '', size: 100 },
      Buffer.from('Albarán;Unidad'),
    );

    expect(result.kind).toBe('csv');
  });

  it('rejects a PDF whose content is not a PDF', () => {
    expect(() =>
      validateUpload(
        { name: 'falso.pdf', type: 'application/pdf', size: 100 },
        Buffer.from('not-a-pdf'),
      ),
    ).toThrow('INVALID_PDF_MAGIC');
  });

  it('rejects files above the Vercel request limit', () => {
    expect(() =>
      validateUpload(
        {
          name: 'grande.pdf',
          type: 'application/pdf',
          size: 4 * 1024 * 1024 + 1,
        },
        Buffer.from('%PDF-1.7'),
      ),
    ).toThrow('FILE_SIZE_INVALID');
  });
});
