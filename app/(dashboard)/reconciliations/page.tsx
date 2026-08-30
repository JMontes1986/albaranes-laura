import { createSupabaseServerClient } from '@/lib/supabase/server';

const labels: Record<string, string> = {
  MATCH: 'Coincide',
  CSV_ONLY: 'Facturado, falta en albarán',
  PDF_ONLY: 'En albarán, falta en facturación',
  DATE_MISMATCH: 'Fecha diferente',
  RETURNED: 'Devuelta',
  REVIEW_REQUIRED: 'Revisión necesaria',
  QUANTITY_MISMATCH: 'Cantidad diferente',
  COMPONENT_MISMATCH: 'Componente diferente',
  DUPLICATE: 'Duplicada',
};

export default async function ReconciliationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from('reconciliations')
    .select('id,status,created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: items, error } = latest
    ? await supabase
        .from('reconciliation_items')
        .select('id,delivery_note_number,component_code,unit_number,status,notes')
        .eq('reconciliation_id', latest.id)
        .order('status')
    : { data: [], error: null };
  const rows = items ?? [];
  const missing = rows.filter((item) => item.status === 'CSV_ONLY');
  const otherDifferences = rows.filter(
    (item) => item.status !== 'MATCH' && item.status !== 'CSV_ONLY',
  );
  const matches = rows.filter((item) => item.status === 'MATCH').length;

  return (
    <>
      <h1>Conciliaciones</h1>
      <div className="cards">
        <div className="card critical-card"><small>Facturadas que faltan en albarán</small><h2>{missing.length}</h2></div>
        <div className="card"><small>Otras diferencias</small><h2>{otherDifferences.length}</h2></div>
        <div className="card"><small>Coincidencias</small><h2>{matches}</h2></div>
      </div>
      <section className="card module-card">
        <h2>Facturado pero no encontrado en el albarán</h2>
        <p className="muted">Estas unidades aparecen en el CSV de facturación y no fueron encontradas en el PDF.</p>
        {error ? <p className="result-error">No se pudieron consultar los resultados.</p> : missing.length ? <ResultsTable rows={missing} /> : <p className="result-success">No se encontraron unidades facturadas ausentes del albarán.</p>}
      </section>
      {otherDifferences.length ? <section className="card module-card"><h2>Otras diferencias</h2><ResultsTable rows={otherDifferences} /></section> : null}
      {!latest ? <section className="card module-card"><p className="muted">El análisis aparecerá aquí al terminar de procesar el PDF y el CSV.</p></section> : null}
    </>
  );
}

function ResultsTable({ rows }: { rows: Array<{ id: string; delivery_note_number: string; component_code: string | null; unit_number: string; status: string }> }) {
  return <div className="table-scroll"><table><thead><tr><th>Albarán</th><th>Componente</th><th>Unidad</th><th>Resultado</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.delivery_note_number}</td><td>{item.component_code || '—'}</td><td><strong>{item.unit_number}</strong></td><td><span className={`status status-${item.status.toLowerCase()}`}>{labels[item.status] ?? item.status}</span></td></tr>)}</tbody></table></div>;
}
