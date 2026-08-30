import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function ReportsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: runs } = await supabase
    .from('reconciliations')
    .select('id,status,created_at,pdf_document_id,csv_document_id')
    .order('created_at', { ascending: false });
  return <><h1>Reportes</h1><section className="card module-card"><h2>Historial de análisis</h2>{runs?.length ? <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Estado</th><th>PDF</th><th>CSV</th><th>Resultado</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString('es-ES')}</td><td><span className="badge">{run.status}</span></td><td>{run.pdf_document_id?.slice(0, 8)}</td><td>{run.csv_document_id?.slice(0, 8)}</td><td><Link href="/reconciliations">Ver conciliación</Link></td></tr>)}</tbody></table></div> : <p className="muted">Aún no hay análisis para reportar.</p>}</section></>;
}
