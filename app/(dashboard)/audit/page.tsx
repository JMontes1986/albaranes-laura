import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function AuditPage() {
  const supabase = await createSupabaseServerClient();
  const { data: logs, error } = await supabase.from('audit_logs').select('id,action,entity_type,entity_id,created_at,metadata').order('created_at', { ascending: false }).limit(100);
  return <><h1>Auditoría</h1><section className="card module-card"><h2>Actividad reciente</h2>{error ? <p className="result-error">No tienes permiso para consultar la auditoría.</p> : logs?.length ? <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>ID</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString('es-ES')}</td><td>{log.action}</td><td>{log.entity_type}</td><td>{log.entity_id?.slice(0, 8) ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">Aún no hay eventos registrados.</p>}</section></>;
}
