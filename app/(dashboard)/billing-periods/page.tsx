import { createSupabaseServerClient } from '@/lib/supabase/server';

const statusLabels: Record<string, string> = {
  draft: 'Borrador',
  processing: 'Procesando',
  review: 'En revisión',
  approved: 'Aprobado',
  invoiced: 'Facturado',
  closed: 'Cerrado',
};

export default async function BillingPeriodsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: periods, error } = await supabase
    .from('billing_periods')
    .select('id,name,customer,start_date,end_date,status,created_at')
    .order('created_at', { ascending: false });

  return (
    <>
      <h1>Cortes de facturación</h1>
      <section className="card module-card">
        <h2>Cortes generados</h2>
        {error ? (
          <p className="result-error">No se pudieron consultar los cortes.</p>
        ) : periods?.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Nombre</th><th>Cliente</th><th>Periodo</th><th>Estado</th></tr></thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <td>{period.name}</td><td>{period.customer}</td>
                    <td>{period.start_date} — {period.end_date}</td>
                    <td><span className="badge">{statusLabels[period.status] ?? period.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Aún no hay cortes. Se crearán al conciliar un PDF y un CSV.</p>}
      </section>
    </>
  );
}
