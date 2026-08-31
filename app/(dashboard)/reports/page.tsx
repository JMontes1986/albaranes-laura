import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  extracting: 'Extrayendo',
  analyzing: 'Analizando',
  reconciling: 'Conciliando',
  completed: 'Completado',
  failed: 'Fallido',
};

type DocumentSummary = {
  original_filename: string;
  deleted_at: string | null;
};

export default async function ReportsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: runs, error } = await supabase
    .from('reconciliations')
    .select('id,status,created_at,pdf_document_id,csv_document_id')
    .order('created_at', { ascending: false })
    .limit(100);

  const documentIds = [
    ...new Set(
      (runs ?? []).flatMap((run) =>
        [run.pdf_document_id, run.csv_document_id].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ];
  const runIds = (runs ?? []).map((run) => run.id);

  const [{ data: documents }, { data: summaries }] = await Promise.all([
    documentIds.length
      ? supabase
          .from('documents')
          .select('id,original_filename,deleted_at')
          .in('id', documentIds)
      : Promise.resolve({ data: [] }),
    runIds.length
      ? supabase
          .from('reconciliation_summaries')
          .select('reconciliation_id,matches,missing,other_differences')
          .in('reconciliation_id', runIds)
      : Promise.resolve({ data: [] }),
  ]);

  const documentsById = new Map<string, DocumentSummary>(
    (documents ?? []).map((document) => [document.id, document]),
  );
  const totalsByRun = new Map(
    (summaries ?? []).map((summary) => [summary.reconciliation_id, summary]),
  );

  function documentName(id: string | null) {
    if (!id) return '—';
    const document = documentsById.get(id);
    if (!document) return id.slice(0, 8);
    return (
      <>
        {document.original_filename}
        {document.deleted_at ? (
          <small className="archived-label">Archivo eliminado</small>
        ) : null}
      </>
    );
  }

  return (
    <>
      <h1>Reportes</h1>
      <section className="card module-card">
        <h2>Historial de análisis</h2>
        <p className="muted">
          Los resultados mensuales permanecen disponibles aunque elimines los
          archivos originales.
        </p>
        {error ? (
          <p className="result-error">No se pudo consultar el historial.</p>
        ) : runs?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>PDF</th>
                  <th>CSV</th>
                  <th>Resumen</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const totals = totalsByRun.get(run.id);
                  return (
                    <tr key={run.id}>
                      <td>{new Date(run.created_at).toLocaleString('es-ES')}</td>
                      <td>
                        <span className="badge">
                          {statusLabels[run.status] ?? run.status}
                        </span>
                      </td>
                      <td>{documentName(run.pdf_document_id)}</td>
                      <td>{documentName(run.csv_document_id)}</td>
                      <td>
                        {totals
                          ? `${totals.missing} faltan · ${totals.other_differences} otras · ${totals.matches} coinciden`
                          : 'Sin resultados'}
                      </td>
                      <td>
                        <Link href={`/reconciliations?analysis=${run.id}`}>
                          Ver análisis
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aún no hay análisis para reportar.</p>
        )}
      </section>
    </>
  );
}
