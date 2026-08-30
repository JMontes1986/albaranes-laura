import { extractText } from 'unpdf';
import { extractAmbiguousDeliveryData } from '@/lib/ai/groq';
import { classifyPage, parseDeliveryPage } from './delivery-parser';
import type { PDFDeliveryNote, PDFItem } from '@/lib/reconciliation/types';

export type ExtractedPdfPage = {
  pageNumber: number;
  classification: ReturnType<typeof classifyPage>;
  markdown: string;
  textSufficient: boolean;
  needsOcr: boolean;
};

type AiMetrics = Awaited<ReturnType<typeof extractAmbiguousDeliveryData>>['metrics'];

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function mergeItem(note: PDFDeliveryNote, item: PDFItem) {
  const key = `${normalize(item.componentCode)}::${normalize(item.unitNumber)}`;
  const exists = note.items.some(
    (candidate) =>
      `${normalize(candidate.componentCode)}::${normalize(candidate.unitNumber)}` === key,
  );
  if (!exists) note.items.push(item);
}

export async function extractDeliveryNotesFromPdf(input: Buffer) {
  const extracted = await extractText(Uint8Array.from(input));
  const pages: ExtractedPdfPage[] = extracted.text.map((text, index) => ({
    pageNumber: index + 1,
    classification: classifyPage(text),
    markdown: text,
    textSufficient: text.trim().length >= 80,
    needsOcr: text.trim().length < 80,
  }));
  const notes = new Map<string, PDFDeliveryNote>();

  for (const page of pages) {
    const parsed = parseDeliveryPage(page.markdown, page.pageNumber);
    if (!parsed) continue;
    const current = notes.get(parsed.deliveryNoteNumber) ?? {
      ...parsed,
      items: [],
    };
    current.confidence = Math.max(current.confidence, parsed.confidence);
    current.dispatchDate ??= parsed.dispatchDate;
    for (const item of parsed.items) mergeItem(current, item);
    notes.set(parsed.deliveryNoteNumber, current);
  }

  const candidates = pages.filter(
    (page) =>
      page.classification === 'delivery_note' ||
      /ALBAR[AÁ]N|DESPACHO/i.test(page.markdown),
  );
  let aiMetrics: AiMetrics | null = null;

  if (candidates.length > 0 && process.env.GROQ_API_KEY) {
    const ai = await extractAmbiguousDeliveryData(
      candidates.map((page) => ({
        page_number: page.pageNumber,
        text: page.markdown.slice(0, 50_000),
      })),
    );
    aiMetrics = ai.metrics;

    for (const item of ai.data.items) {
      if (!item.unit_number || !item.component_code) continue;
      const pageNote = [...notes.values()].find(
        (note) => note.pageNumber === item.page_number,
      );
      const number = (item.delivery_note_number ?? pageNote?.deliveryNoteNumber)?.trim();
      if (!number) continue;
      const current = notes.get(number) ?? {
        deliveryNoteNumber: number,
        dispatchDate: normalizeDate(item.date),
        pageNumber: item.page_number ?? undefined,
        confidence: item.confidence,
        items: [],
      };
      current.dispatchDate ??= normalizeDate(item.date);
      current.confidence = Math.max(current.confidence, item.confidence);
      mergeItem(current, {
        componentCode: normalize(item.component_code),
        unitNumber: normalize(item.unit_number),
        bloodGroup: item.blood_group,
        expirationDate: normalizeDate(item.expiration_date),
      });
      notes.set(number, current);
    }
  }

  const deliveryNotes = [...notes.values()].filter((note) => note.items.length > 0);
  if (deliveryNotes.length === 0) throw new Error('PDF_NO_DELIVERY_ITEMS');

  return { pages, deliveryNotes, aiMetrics };
}
