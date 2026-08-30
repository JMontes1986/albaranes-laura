import { describe, expect, it } from 'vitest';
import { parseDeliveryPage } from '@/lib/documents/delivery-parser';

describe('delivery note parser', () => {
  it('extracts the delivery note, date, component and unit from PDF text', () => {
    const page = parseDeliveryPage(
      [
        'DESPACHO DE COMPONENTES',
        'Albarán Nº: 143909',
        'Fecha: 23/08/2026',
        'Total Productos: 1',
        'GRPL 2631010001 00',
      ].join('\n'),
      2,
    );

    expect(page).toMatchObject({
      deliveryNoteNumber: '143909',
      dispatchDate: '2026-08-23',
      pageNumber: 2,
      items: [{ componentCode: 'GRPL', unitNumber: '2631010001 00' }],
    });
  });
});
