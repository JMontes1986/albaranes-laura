import { describe, expect, it } from 'vitest';
import { findExactCsvMatches } from '@/lib/documents/pdf-extractor';
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
});
