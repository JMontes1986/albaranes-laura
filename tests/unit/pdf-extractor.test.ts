import { describe, expect, it } from 'vitest';
import {
  buildOcrMarkdownPages,
  compressImageForOcr,
  findExactCsvMatches,
  mapOcrMatchesToNotes,
  OCR_MAX_PAGES,
} from '@/lib/documents/pdf-extractor';
import type { CSVNormalizedRecord } from '@/lib/csv/parser';

describe('PDF exact unit matching', () => {
  it('finds expected CSV units even when the PDF has no delivery-note heading', () => {
    const rows: CSVNormalizedRecord[] = [
      {
        deliveryNoteNumber: '143909',
        componentCode: 'GRPL',
        component: 'Glóbulos rojos',
        dispatchDate: '2026-08-23',
        time: '10:00',
        unitNumber: '2631010001 00',
        bloodGroup: 'O-',
        expirationDate: '2026-08-30',
        returned: false,
        raw: {},
      },
      {
        deliveryNoteNumber: '143909',
        componentCode: 'PFC',
        component: 'Plasma',
        dispatchDate: '2026-08-23',
        time: '10:00',
        unitNumber: '2631010099 00',
        bloodGroup: 'O-',
        expirationDate: '2026-08-30',
        returned: false,
        raw: {},
      },
    ];

    const notes = findExactCsvMatches(
      [
        {
          pageNumber: 4,
          classification: 'invoice',
          markdown: 'Factura soporte · Unidad 2631010001-00 · GRPL',
          textSufficient: true,
          needsOcr: false,
        },
      ],
      rows,
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      deliveryNoteNumber: '143909',
      pageNumber: 4,
      items: [{ componentCode: 'GRPL', unitNumber: '2631010001 00' }],
    });
  });

  it('accepts OCR results only when they match an expected CSV unit', () => {
    const rows: CSVNormalizedRecord[] = [
      {
        deliveryNoteNumber: '143909',
        componentCode: 'GRPL',
        component: 'Glóbulos rojos',
        dispatchDate: '2026-08-23',
        time: '10:00',
        unitNumber: '2631010001 00',
        bloodGroup: 'O-',
        expirationDate: '2026-08-30',
        returned: false,
        raw: {},
      },
    ];

    const notes = mapOcrMatchesToNotes(
      [
        { unit_number: '2631010001-00', page_number: 2, confidence: 0.94 },
        { unit_number: 'INVENTADA-99', page_number: 2, confidence: 1 },
      ],
      rows,
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      deliveryNoteNumber: '143909',
      pageNumber: 2,
      confidence: 0.94,
      items: [{ componentCode: 'GRPL', unitNumber: '2631010001 00' }],
    });
    expect(OCR_MAX_PAGES).toBe(80);
    expect(
      buildOcrMarkdownPages([
        { unit_number: '2631010001 00', page_number: 2, confidence: 0.94 },
      ]).get(2),
    ).toContain('## Página 2');
  });

  it('converts rendered OCR pages to JPEG before sending them to the AI', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(320, 180);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = '#111827';
    context.font = '24px sans-serif';
    context.fillText('Unidad 2631010001 00', 20, 90);

    const jpeg = await compressImageForOcr(
      new Uint8Array(await canvas.encode('png')),
    );

    expect([...jpeg.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});
