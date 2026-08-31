import { DocumentUploadForm } from '@/components/document-upload-form';
import { DocumentProcessingMonitor } from '@/components/document-processing-monitor';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const typeLabels: Record<string, string> = {
  pdf_support: 'PDF soporte',
  csv_units: 'CSV unidades',
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  extracting: 'Extrayendo',
  analyzing: 'Analizando',
  reconciling: 'Conciliando',
  completed: 'Completado',
  failed: 'Fallido',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function processingErrorMessage(error: string | null | undefined) {
  if (error === 'PDF_NO_DELIVERY_ITEMS') {
    return 'El PDF se pudo leer, pero no se reconocieron números de unidad del albarán.';
  }
  if (error === 'PDF_WITHOUT_EXTRACTABLE_TEXT') {
    return 'El PDF no contiene texto seleccionable. Necesita procesamiento OCR.';
  }
  if (error === 'PDF_OCR_NO_MATCHES') {
    return 'El OCR leyó las páginas, pero no encontró en el PDF ninguna unidad incluida en el CSV.';
  }
  if (error === 'PDF_OCR_PAGE_LIMIT') {
    return 'El PDF supera el límite de 50 páginas admitido para OCR automático.';
  }
  if (error?.includes('GROQ')) {
    return 'La extracción con IA no respondió correctamente. Revisa GROQ_API_KEY.';
  }
  return error ? `Detalle técnico: ${error}` : 'No se registró el detalle del fallo.';
}

export default async function DocumentsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: documents, error } = await supabase
    .from('documents')
    .select(
      'id,original_filename,document_type,size_bytes,status,created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  const latestDocuments = [
    documents?.find((document) => document.document_type === 'pdf_support'),
    documents?.find((document) => document.document_type === 'csv_units'),
  ].filter(Boolean);
  const pendingTypes = new Set(
    latestDocuments
      .filter((document) => document?.status === 'pending')
      .map((document) => document?.document_type),
  );
  const hasPendingPair =
    pendingTypes.has('pdf_support') && pendingTypes.has('csv_units');
  const isProcessing = Boolean(
    latestDocuments.some((document) =>
      ['extracting', 'analyzing', 'reconciling'].includes(document?.status ?? ''),
    ),
  );
  const hasFailed = Boolean(
    latestDocuments.some((document) => document?.status === 'failed'),
  );
  const latestPdf = documents?.find(
    (document) => document.document_type === 'pdf_support',
  );
  const { data: failedRun } = hasFailed && latestPdf
    ? await supabase
        .from('ai_runs')
        .select('error')
        .eq('document_id', latestPdf.id)
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return (
    <>
      <h1>Documentos</h1>
      <DocumentUploadForm />
      <DocumentProcessingMonitor
        hasPendingPair={hasPendingPair}
        isProcessing={isProcessing}
        hasFailed={hasFailed}
        failureReason={processingErrorMessage(failedRun?.error)}
      />
      <section className="card documents-list" aria-labelledby="documents-title">
        <h2 id="documents-title">Documentos cargados</h2>
        {error ? (
          <p className="result-error">
            No se pudo consultar public.documents. Revisa que la migración y RLS
            estén aplicados.
          </p>
        ) : documents && documents.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>{document.original_filename}</td>
                    <td>{typeLabels[document.document_type] ?? document.document_type}</td>
                    <td>{formatBytes(Number(document.size_bytes))}</td>
                    <td>
                      <span className="badge">
                        {statusLabels[document.status] ?? document.status}
                      </span>
                    </td>
                    <td>{new Date(document.created_at).toLocaleString('es-ES')}</td>
                    <td>
                      <a href={`/api/documents/${document.id}/download`}>Descargar</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aún no hay documentos cargados.</p>
        )}
      </section>
    </>
  );
}
