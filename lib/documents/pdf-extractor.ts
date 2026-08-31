import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import {
  extractAmbiguousDeliveryData,
  extractUnitsFromScannedPages,
} from '@/lib/ai/groq';
import { classifyPage, parseDeliveryPage } from './delivery-parser';
import type { CSVNormalizedRecord } from '@/lib/csv/parser';
import type { PDFDeliveryNote, PDFItem } from '@/lib/reconciliation/types';

export type ExtractedPdfPage = {
  pageNumber: number;
  classification: ReturnType<typeof classifyPage>;
  markdown: string;
  textSufficient: boolean;
  needsOcr: boolean;
};

type AiMetrics = Awaited<ReturnType<typeof extractAmbiguousDeliveryData>>['metrics'];

const OCR_BATCH_SIZE = 3;
const OCR_CONCURRENCY = 2;
export const OCR_MAX_PAGES = 80;
const OCR_IMAGE_WIDTH = 1_600;
const OCR_JPEG_QUALITY = 68;

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

function searchable(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function findExactCsvMatches(
  pages: ExtractedPdfPage[],
  rows: CSVNormalizedRecord[],
) {
  const notes = new Map<string, PDFDeliveryNote>();
  const searchablePages = pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: searchable(page.markdown),
  }));

  for (const row of rows) {
    const unit = searchable(row.unitNumber);
    if (unit.length < 6) continue;
    const matchedPage = searchablePages.find((page) => page.text.includes(unit));
    if (!matchedPage) continue;
    const current = notes.get(row.deliveryNoteNumber) ?? {
      deliveryNoteNumber: row.deliveryNoteNumber,
      dispatchDate: row.dispatchDate,
      pageNumber: matchedPage.pageNumber,
      confidence: 0.99,
      items: [],
    };
    mergeItem(current, {
      componentCode: row.componentCode,
      unitNumber: row.unitNumber,
      bloodGroup: row.bloodGroup,
      expirationDate: row.expirationDate,
    });
    notes.set(row.deliveryNoteNumber, current);
  }

  return [...notes.values()];
}

export function mapOcrMatchesToNotes(
  matches: Array<{ unit_number: string; page_number: number; confidence: number }>,
  rows: CSVNormalizedRecord[],
) {
  const rowsByUnit = new Map(rows.map((row) => [searchable(row.unitNumber), row]));
  const notes = new Map<string, PDFDeliveryNote>();

  for (const match of matches) {
    const row = rowsByUnit.get(searchable(match.unit_number));
    if (!row) continue;
    const current = notes.get(row.deliveryNoteNumber) ?? {
      deliveryNoteNumber: row.deliveryNoteNumber,
      dispatchDate: row.dispatchDate,
      pageNumber: match.page_number,
      confidence: match.confidence,
      items: [],
    };
    current.confidence = Math.max(current.confidence, match.confidence);
    mergeItem(current, {
      componentCode: row.componentCode,
      unitNumber: row.unitNumber,
      bloodGroup: row.bloodGroup,
      expirationDate: row.expirationDate,
    });
    notes.set(row.deliveryNoteNumber, current);
  }

  return [...notes.values()];
}

export function buildOcrMarkdownPages(
  matches: Array<{ unit_number: string; page_number: number; confidence: number }>,
) {
  const byPage = new Map<number, string[]>();
  for (const match of matches) {
    const lines = byPage.get(match.page_number) ?? [];
    lines.push(
      `- Unidad: \`${match.unit_number}\` (confianza OCR: ${Math.round(match.confidence * 100)}%)`,
    );
    byPage.set(match.page_number, lines);
  }
  return new Map(
    [...byPage].map(([pageNumber, lines]) => [
      pageNumber,
      `## Página ${pageNumber}\n\n${lines.join('\n')}`,
    ]),
  );
}

export async function compressImageForOcr(rendered: Uint8Array) {
  const canvasModule = await import('@napi-rs/canvas');
  const source = await canvasModule.loadImage(rendered);
  const canvas = canvasModule.createCanvas(source.width, source.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  return new Uint8Array(await canvas.encode('jpeg', OCR_JPEG_QUALITY));
}

async function renderCompressedPage(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, pageNumber: number) {
  const canvasModule = await import('@napi-rs/canvas');
  const rendered = new Uint8Array(
    await renderPageAsImage(pdf, pageNumber, {
      canvasImport: () => Promise.resolve(canvasModule),
      width: OCR_IMAGE_WIDTH,
    }),
  );
  const jpeg = await compressImageForOcr(rendered);
  return {
    pageNumber,
    data: new Uint8Array(jpeg),
    mediaType: 'image/jpeg' as const,
    originalBytes: rendered.byteLength,
    optimizedBytes: jpeg.byteLength,
  };
}

async function extractScannedPdfMatches(input: Buffer, rows: CSVNormalizedRecord[]) {
  if (!process.env.GROQ_API_KEY || rows.length === 0) return null;
  const pdf = await getDocumentProxy(Uint8Array.from(input));
  if (pdf.numPages > OCR_MAX_PAGES) throw new Error('PDF_OCR_PAGE_LIMIT');

  const expectedUnits = [...new Set(rows.map((row) => row.unitNumber))].slice(0, 500);
  const matches: Array<{ unit_number: string; page_number: number; confidence: number }> = [];
  let latencyMs = 0;
  let outputTokens = 0;
  let model = '';
  const batches = Array.from(
    { length: Math.ceil(pdf.numPages / OCR_BATCH_SIZE) },
    (_, batchIndex) => {
      const firstPage = batchIndex * OCR_BATCH_SIZE + 1;
      return Array.from(
        { length: Math.min(OCR_BATCH_SIZE, pdf.numPages - firstPage + 1) },
        (_, index) => firstPage + index,
      );
    },
  );
  let nextBatch = 0;

  async function worker() {
    while (nextBatch < batches.length) {
      const batchIndex = nextBatch++;
      const pageNumbers = batches[batchIndex];
      const rendered = await Promise.all(
        pageNumbers.map((pageNumber) => renderCompressedPage(pdf, pageNumber)),
      );
      const batch = await extractUnitsFromScannedPages(rendered, expectedUnits);
      const originalBytes = rendered.reduce((total, page) => total + page.originalBytes, 0);
      const optimizedBytes = rendered.reduce((total, page) => total + page.optimizedBytes, 0);
      console.info('[automatic-reconciliation] pdf-ocr-batch', {
        firstPage: pageNumbers[0],
        lastPage: pageNumbers.at(-1),
        totalPages: pdf.numPages,
        matches: batch.items.length,
        model: batch.model,
        latencyMs: batch.latencyMs,
        originalBytes,
        optimizedBytes,
        reductionPct: originalBytes
          ? Math.round((1 - optimizedBytes / originalBytes) * 10_000) / 100
          : 0,
      });
      matches.push(...batch.items);
      latencyMs += batch.latencyMs;
      outputTokens += batch.outputTokens;
      model = batch.model;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(OCR_CONCURRENCY, batches.length) }, () => worker()),
  );

  const prompt = JSON.stringify({ expected_units: expectedUnits });
  return {
    notes: mapOcrMatchesToNotes(matches, rows),
    markdownPages: buildOcrMarkdownPages(matches),
    metrics: {
      jsonChars: prompt.length,
      toonChars: prompt.length,
      reductionPct: 0,
      estimatedTokens: Math.ceil(prompt.length / 4),
      model,
      latencyMs,
      outputTokens,
    } satisfies AiMetrics,
  };
}

export async function extractDeliveryNotesFromPdf(
  input: Buffer,
  expectedRows: CSVNormalizedRecord[] = [],
) {
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

  for (const exactNote of findExactCsvMatches(pages, expectedRows)) {
    const current = notes.get(exactNote.deliveryNoteNumber) ?? {
      ...exactNote,
      items: [],
    };
    for (const item of exactNote.items) mergeItem(current, item);
    notes.set(exactNote.deliveryNoteNumber, current);
  }

  const explicitCandidates = pages.filter(
    (page) =>
      page.classification === 'delivery_note' ||
      /ALBAR[AÁ]N|DESPACHO/i.test(page.markdown),
  );
  const readablePages = pages.filter((page) => page.markdown.trim().length >= 20);
  const candidates = explicitCandidates.length > 0 ? explicitCandidates : readablePages;
  let aiMetrics: AiMetrics | null = null;

  if (readablePages.length === 0) {
    const ocr = await extractScannedPdfMatches(input, expectedRows);
    if (ocr) {
      aiMetrics = ocr.metrics;
      for (const note of ocr.notes) notes.set(note.deliveryNoteNumber, note);
      for (const page of pages) {
        const markdown = ocr.markdownPages.get(page.pageNumber);
        if (!markdown) continue;
        page.markdown = markdown;
        page.textSufficient = true;
        page.needsOcr = false;
      }
    }
  }

  if (candidates.length > 0 && process.env.GROQ_API_KEY) {
    let remainingCharacters = 120_000;
    const pageInput = candidates.flatMap((page) => {
      if (remainingCharacters <= 0) return [];
      const text = page.markdown.slice(0, Math.min(30_000, remainingCharacters));
      remainingCharacters -= text.length;
      return [{ page_number: page.pageNumber, text }];
    });
    const ai = await extractAmbiguousDeliveryData(
      {
        pages: pageInput,
        expected_units: expectedRows.slice(0, 500).map((row) => ({
          delivery_note_number: row.deliveryNoteNumber,
          component_code: row.componentCode,
          unit_number: row.unitNumber,
        })),
      },
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
  if (deliveryNotes.length === 0) {
    throw new Error(
      readablePages.length === 0 && aiMetrics
        ? 'PDF_OCR_NO_MATCHES'
        : readablePages.length === 0
          ? 'PDF_WITHOUT_EXTRACTABLE_TEXT'
        : 'PDF_NO_DELIVERY_ITEMS',
    );
  }

  return { pages, deliveryNotes, aiMetrics };
}
