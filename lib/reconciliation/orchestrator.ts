import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decryptFile, type EncryptedFile } from '@/lib/crypto/files';
import { parseUnitsCsv, type CSVNormalizedRecord } from '@/lib/csv/parser';
import { extractDeliveryNotesFromPdf } from '@/lib/documents/pdf-extractor';
import {
  EXTRACTION_TIMEOUT_MS,
  PROCESSING_STALE_MS,
  isProcessingStatus,
} from '@/lib/documents/processing';
import { reconcile } from './engine';

type ProcessingStatus =
  | 'pending'
  | 'extracting'
  | 'analyzing'
  | 'reconciling'
  | 'completed'
  | 'failed';

type DocumentRow = {
  id: string;
  document_type: 'pdf_support' | 'csv_units';
  storage_path: string;
  encrypted_file_key: string;
  iv: string;
  auth_tag: string;
  key_iv: string;
  key_auth_tag: string;
  sha256: string;
  status: ProcessingStatus;
  uploaded_by: string;
  created_at: string;
  processing_started_at: string | null;
};

export type ClaimedPair = { pdf: DocumentRow; csv: DocumentRow; userId: string };

const documentFields =
  'id,document_type,storage_path,encrypted_file_key,iv,auth_tag,key_iv,key_auth_tag,sha256,status,uploaded_by,created_at,processing_started_at';

function key(delivery: string, component: string, unit: string) {
  return `${delivery.trim().toUpperCase()}::${component.trim().toUpperCase()}::${unit
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()}`;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message.slice(0, 500) : 'PROCESSING_FAILED';
}

async function setDocumentStatus(
  ids: string[],
  status: ProcessingStatus,
  progress: number,
  stage: string,
) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('documents')
    .update({
      status,
      processing_progress: progress,
      processing_stage: stage,
      processing_updated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw new Error(`DOCUMENT_STATUS_${error.message}`);
}

async function claimPair(
  userId: string,
  sourceStatus: 'pending' | 'failed',
): Promise<ClaimedPair | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('documents')
    .select(documentFields)
    .eq('uploaded_by', userId)
    .eq('status', sourceStatus)
    .is('deleted_at', null)
    .in('document_type', ['pdf_support', 'csv_units'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`PAIR_LOOKUP_${error.message}`);

  const documents = (data ?? []) as DocumentRow[];
  const pdf = documents.find((document) => document.document_type === 'pdf_support');
  const csv = documents.find((document) => document.document_type === 'csv_units');
  if (!pdf || !csv) return null;

  const ids = [pdf.id, csv.id];
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('documents')
    .update({
      status: 'extracting',
      processing_started_at: startedAt,
      processing_updated_at: startedAt,
      processing_progress: 2,
      processing_stage: 'Descargando y descifrando archivos',
    })
    .in('id', ids)
    .eq('status', sourceStatus)
    .is('deleted_at', null)
    .select('id');
  if (claimError) throw new Error(`PAIR_CLAIM_${claimError.message}`);
  if (claimed?.length !== 2) return null;

  return { pdf, csv, userId };
}

export function claimPendingPair(userId: string) {
  return claimPair(userId, 'pending');
}

export function claimFailedPair(userId: string) {
  return claimPair(userId, 'failed');
}

export async function recoverStaleProcessing(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('documents')
    .select('id,document_type,status,created_at,processing_started_at')
    .eq('uploaded_by', userId)
    .is('deleted_at', null)
    .in('status', ['extracting', 'analyzing', 'reconciling'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`STALE_LOOKUP_${error.message}`);

  const now = Date.now();
  const stale = (data ?? []).filter((document) => {
    if (!isProcessingStatus(document.status)) return false;
    const started = Date.parse(document.processing_started_at ?? document.created_at);
    return Number.isFinite(started) && now - started >= PROCESSING_STALE_MS;
  });
  if (stale.length === 0) return 0;

  const ids = stale.map((document) => document.id);
  const recoveredAt = new Date().toISOString();
  const { error: recoveryError } = await admin
    .from('documents')
    .update({
      status: 'failed',
      processing_stage: 'Tiempo máximo superado',
      processing_updated_at: recoveredAt,
    })
    .in('id', ids)
    .in('status', ['extracting', 'analyzing', 'reconciling']);
  if (recoveryError) throw new Error(`STALE_RECOVERY_${recoveryError.message}`);

  const pdf = stale.find((document) => document.document_type === 'pdf_support');
  await Promise.all([
    pdf
      ? admin.from('ai_runs').insert({
          document_id: pdf.id,
          task: 'automatic_reconciliation',
          model: process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b',
          status: 'failed',
          error: 'PROCESSING_TIMEOUT',
        })
      : Promise.resolve(),
    admin.from('audit_logs').insert({
      user_id: userId,
      action: 'automatic_reconciliation_timeout_recovered',
      entity_type: 'document',
      entity_id: pdf?.id ?? ids[0],
      metadata: { document_ids: ids, recovered_at: recoveredAt },
    }),
  ]);
  console.warn('[automatic-reconciliation] stale-processing-recovered', {
    documentIds: ids,
  });
  return stale.length;
}

async function downloadAndDecrypt(document: DocumentRow) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from('documents-encrypted')
    .download(document.storage_path);
  if (error || !data) throw new Error(`STORAGE_DOWNLOAD_${error?.message ?? 'missing'}`);
  const ciphertext = Buffer.from(await data.arrayBuffer());
  return decryptFile({
    ciphertext,
    iv: document.iv,
    authTag: document.auth_tag,
    encryptedFileKey: document.encrypted_file_key,
    keyIv: document.key_iv,
    keyAuthTag: document.key_auth_tag,
    sha256: document.sha256,
    encryptionVersion: 'v1',
  } satisfies EncryptedFile);
}

function dateRange(rows: CSVNormalizedRecord[]) {
  const dates = rows
    .map((row) => row.dispatchDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const today = new Date().toISOString().slice(0, 10);
  return { start: dates.at(0) ?? today, end: dates.at(-1) ?? today };
}

export async function processClaimedPair(pair: ClaimedPair) {
  const admin = createSupabaseAdminClient();
  const documentIds = [pair.pdf.id, pair.csv.id];
  let reconciliationId: string | null = null;
  let periodId: string | null = null;

  try {
    console.info('[automatic-reconciliation] started', {
      pdfDocumentId: pair.pdf.id,
      csvDocumentId: pair.csv.id,
    });
    const { data: previousRuns } = await admin
      .from('reconciliations')
      .select('billing_period_id')
      .eq('pdf_document_id', pair.pdf.id)
      .eq('csv_document_id', pair.csv.id)
      .eq('status', 'failed');
    const previousPeriodIds = (previousRuns ?? []).map(
      (run) => run.billing_period_id,
    );
    if (previousPeriodIds.length > 0) {
      const { error: cleanupError } = await admin
        .from('billing_periods')
        .delete()
        .in('id', previousPeriodIds);
      if (cleanupError) throw new Error(`RETRY_CLEANUP_${cleanupError.message}`);
    }

    const [pdfBuffer, csvBuffer] = await Promise.all([
      downloadAndDecrypt(pair.pdf),
      downloadAndDecrypt(pair.csv),
    ]);
    console.info('[automatic-reconciliation] documents-decrypted', {
      pdfBytes: pdfBuffer.length,
      csvBytes: csvBuffer.length,
    });
    const csvRows = parseUnitsCsv(csvBuffer);
    if (csvRows.length === 0) throw new Error('CSV_EMPTY');
    console.info('[automatic-reconciliation] csv-parsed', { records: csvRows.length });

    await setDocumentStatus(documentIds, 'analyzing', 10, 'Preparando páginas del PDF');
    const extractionController = new AbortController();
    const extractionTimer = setTimeout(
      () => extractionController.abort(),
      EXTRACTION_TIMEOUT_MS,
    );
    let extraction: Awaited<ReturnType<typeof extractDeliveryNotesFromPdf>>;
    try {
      extraction = await extractDeliveryNotesFromPdf(pdfBuffer, csvRows, {
        signal: extractionController.signal,
        onOcrProgress: async (completedPages, totalPages) => {
          const progress = 10 + Math.round((completedPages / totalPages) * 65);
          await setDocumentStatus(
            documentIds,
            'analyzing',
            progress,
            `OCR: ${completedPages} de ${totalPages} páginas`,
          );
        },
      });
    } finally {
      clearTimeout(extractionTimer);
    }
    console.info('[automatic-reconciliation] pdf-extracted', {
      pages: extraction.pages.length,
      deliveryNotes: extraction.deliveryNotes.length,
      units: extraction.deliveryNotes.reduce(
        (total, note) => total + note.items.length,
        0,
      ),
      usedAi: Boolean(extraction.aiMetrics),
    });
    const componentCodes = [
      ...csvRows.map((row) => row.componentCode),
      ...extraction.deliveryNotes.flatMap((note) =>
        note.items.map((item) => item.componentCode),
      ),
    ].filter(Boolean);
    const catalog = [...new Set(componentCodes)].map((code) => ({
      code,
      description:
        csvRows.find((row) => row.componentCode === code)?.component ?? code,
      active: true,
    }));
    if (catalog.length > 0) {
      const { error } = await admin
        .from('component_catalog')
        .upsert(catalog, { onConflict: 'code', ignoreDuplicates: true });
      if (error) throw new Error(`CATALOG_${error.message}`);
    }

    await Promise.all([
      admin.from('document_pages').delete().eq('document_id', pair.pdf.id),
      admin.from('delivery_notes').delete().eq('document_id', pair.pdf.id),
      admin.from('csv_imports').delete().eq('document_id', pair.csv.id),
    ]);

    const { error: pagesError } = await admin.from('document_pages').insert(
      extraction.pages.map((page) => ({
        document_id: pair.pdf.id,
        page_number: page.pageNumber,
        page_type: page.classification,
        markdown: page.markdown,
        text_sufficient: page.textSufficient,
        needs_ocr: page.needsOcr,
      })),
    );
    if (pagesError) throw new Error(`PAGES_${pagesError.message}`);

    const { data: csvImport, error: importError } = await admin
      .from('csv_imports')
      .insert({
        document_id: pair.csv.id,
        encoding: 'auto',
        delimiter: ';',
        record_count: csvRows.length,
      })
      .select('id')
      .single();
    if (importError || !csvImport) throw new Error(`CSV_IMPORT_${importError?.message}`);

    const { data: storedCsv, error: csvError } = await admin
      .from('csv_records')
      .insert(
        csvRows.map((row) => ({
          csv_import_id: csvImport.id,
          delivery_note_number: row.deliveryNoteNumber,
          component_code: row.componentCode,
          component_name: row.component,
          dispatch_date: row.dispatchDate,
          dispatch_time: row.time,
          unit_number: row.unitNumber,
          blood_group: row.bloodGroup,
          expiration_date: row.expirationDate,
          returned: row.returned,
          raw: row.raw,
        })),
      )
      .select('id,delivery_note_number,component_code,unit_number');
    if (csvError) throw new Error(`CSV_RECORDS_${csvError.message}`);

    const pdfIds = new Map<string, string>();
    for (const note of extraction.deliveryNotes) {
      const { data: storedNote, error: noteError } = await admin
        .from('delivery_notes')
        .insert({
          document_id: pair.pdf.id,
          delivery_note_number: note.deliveryNoteNumber,
          dispatch_date: note.dispatchDate,
          total_products: note.items.length,
          page_number: note.pageNumber,
          confidence: note.confidence,
          extraction_original: note,
        })
        .select('id')
        .single();
      if (noteError || !storedNote) throw new Error(`DELIVERY_NOTE_${noteError?.message}`);

      const { data: storedItems, error: itemsError } = await admin
        .from('delivery_note_items')
        .insert(
          note.items.map((item) => ({
            delivery_note_id: storedNote.id,
            component_code: item.componentCode,
            unit_number: item.unitNumber,
            blood_group: item.bloodGroup,
            expiration_date: item.expirationDate,
            confidence: note.confidence,
            original_value: item,
          })),
        )
        .select('id,component_code,unit_number');
      if (itemsError) throw new Error(`DELIVERY_ITEMS_${itemsError.message}`);
      for (const item of storedItems ?? []) {
        pdfIds.set(
          key(note.deliveryNoteNumber, item.component_code, item.unit_number),
          item.id,
        );
      }
    }

    if (extraction.aiMetrics) {
      await admin.from('ai_runs').insert({
        document_id: pair.pdf.id,
        task: 'delivery_note_extraction',
        model: extraction.aiMetrics.model,
        input_chars: extraction.aiMetrics.jsonChars,
        toon_chars: extraction.aiMetrics.toonChars,
        estimated_input_tokens: extraction.aiMetrics.estimatedTokens,
        output_tokens: extraction.aiMetrics.outputTokens,
        latency_ms: extraction.aiMetrics.latencyMs,
        status: 'completed',
      });
    }

    await setDocumentStatus(documentIds, 'reconciling', 90, 'Comparando unidades');
    const range = dateRange(csvRows);
    const deliveryNumbers = [...new Set(csvRows.map((row) => row.deliveryNoteNumber))];
    const customer = csvRows[0]?.raw.Centro || 'Carga automática';
    const { data: period, error: periodError } = await admin
      .from('billing_periods')
      .insert({
        name: `Conciliación ${deliveryNumbers.join(', ')}`.slice(0, 180),
        start_date: range.start,
        end_date: range.end,
        customer,
        status: 'processing',
        created_by: pair.userId,
      })
      .select('id')
      .single();
    if (periodError || !period) throw new Error(`PERIOD_${periodError?.message}`);
    periodId = period.id;

    const { data: reconciliation, error: reconciliationError } = await admin
      .from('reconciliations')
      .insert({
        billing_period_id: period.id,
        pdf_document_id: pair.pdf.id,
        csv_document_id: pair.csv.id,
        status: 'reconciling',
        created_by: pair.userId,
      })
      .select('id')
      .single();
    if (reconciliationError || !reconciliation) {
      throw new Error(`RECONCILIATION_${reconciliationError?.message}`);
    }
    reconciliationId = reconciliation.id;

    const result = reconcile(csvRows, extraction.deliveryNotes);
    console.info('[automatic-reconciliation] reconciled', {
      total: result.items.length,
      matches: result.items.filter((item) => item.status === 'MATCH').length,
      csvOnly: result.items.filter((item) => item.status === 'CSV_ONLY').length,
      pdfOnly: result.items.filter((item) => item.status === 'PDF_ONLY').length,
    });
    const csvIds = new Map(
      (storedCsv ?? []).map((row) => [
        key(row.delivery_note_number, row.component_code, row.unit_number),
        row.id as string,
      ]),
    );
    const { error: resultError } = await admin.from('reconciliation_items').insert(
      result.items.map((item) => ({
        reconciliation_id: reconciliation.id,
        delivery_note_number: item.deliveryNoteNumber,
        component_code: item.componentCode,
        unit_number: item.unitNumber,
        status: item.status,
        csv_record_id: item.csv
          ? csvIds.get(
              key(item.deliveryNoteNumber, item.componentCode, item.unitNumber),
            ) ?? null
          : null,
        pdf_item_id: item.pdf
          ? pdfIds.get(
              key(item.deliveryNoteNumber, item.componentCode, item.unitNumber),
            ) ?? null
          : null,
        notes: item.notes ?? [],
      })),
    );
    if (resultError) throw new Error(`RESULTS_${resultError.message}`);

    await Promise.all([
      admin.from('reconciliations').update({ status: 'completed' }).eq('id', reconciliation.id),
      admin.from('billing_periods').update({ status: 'review' }).eq('id', period.id),
      admin
        .from('documents')
        .update({
          status: 'completed',
          processing_progress: 100,
          processing_stage: 'Análisis completado',
          processing_updated_at: new Date().toISOString(),
        })
        .in('id', documentIds),
      admin.from('audit_logs').insert({
        user_id: pair.userId,
        action: 'automatic_reconciliation_completed',
        entity_type: 'reconciliation',
        entity_id: reconciliation.id,
        metadata: {
          pdf_document_id: pair.pdf.id,
          csv_document_id: pair.csv.id,
          total_items: result.items.length,
          missing_from_delivery_note: result.items.filter(
            (item) => item.status === 'CSV_ONLY',
          ).length,
        },
      }),
    ]);
    console.info('[automatic-reconciliation] completed', {
      reconciliationId: reconciliation.id,
    });

    return { reconciliationId: reconciliation.id, result };
  } catch (cause) {
    const message = errorMessage(cause);
    console.error('[automatic-reconciliation]', message);
    await Promise.all([
      admin
        .from('documents')
        .update({
          status: 'failed',
          processing_stage:
            message === 'PROCESSING_TIMEOUT'
              ? 'Tiempo máximo superado'
              : 'El análisis falló',
          processing_updated_at: new Date().toISOString(),
        })
        .in('id', documentIds),
      reconciliationId
        ? admin
            .from('reconciliations')
            .update({ status: 'failed' })
            .eq('id', reconciliationId)
        : Promise.resolve(),
      periodId
        ? admin.from('billing_periods').update({ status: 'review' }).eq('id', periodId)
        : Promise.resolve(),
      admin.from('ai_runs').insert({
        document_id: pair.pdf.id,
        task: 'automatic_reconciliation',
        model: process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b',
        status: 'failed',
        error: message,
      }),
    ]);
    throw cause;
  }
}
