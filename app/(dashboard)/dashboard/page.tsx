import Link from 'next/link';
import { requireUser } from '@/lib/auth/require-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function Dashboard() {
  const { profile } = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from('reconciliations')
    .select('id,status,created_at,billing_period_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: items } = latest
    ? await supabase
        .from('reconciliation_items')
        .select('status,delivery_note_number')
        .eq('reconciliation_id', latest.id)
    : { data: [] };
  const rows = items ?? [];
  const matches = rows.filter((item) => item.status === 'MATCH').length;
  const missing = rows.filter((item) => item.status === 'CSV_ONLY').length;
  const differences = rows.filter((item) => item.status !== 'MATCH').length;
  const noteCount = new Set(rows.map((item) => item.delivery_note_number)).size;
  const cards = [
    ['Albaranes analizados', noteCount],
    ['Unidades comparadas', rows.length],
    ['Coincidencias', matches],
    ['Facturadas sin albarán', missing],
    ['Diferencias totales', differences],
    [
      'Porcentaje coincidente',
      rows.length ? `${Math.round((matches / rows.length) * 100)}%` : '—',
    ],
  ];

  return (
    <>
      <h1>Dashboard</h1>
      <p>Bienvenido, {profile.full_name || profile.email}</p>
      <div className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <small>{label}</small>
            <h2>{value}</h2>
          </div>
        ))}
      </div>
      <section className="card module-card">
        <h2>Último análisis</h2>
        {latest ? (
          <p>
            Estado: <span className="badge">{latest.status}</span> ·{' '}
            {new Date(latest.created_at).toLocaleString('es-ES')}.{' '}
            <Link href="/reconciliations">Ver diferencias</Link>
          </p>
        ) : (
          <p className="muted">Sube un PDF y un CSV para iniciar el primer análisis.</p>
        )}
      </section>
    </>
  );
}
