import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from('reconciliations')
    .select('id,created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: items } = latest
    ? await supabase.from('reconciliation_items').select('status').eq('reconciliation_id', latest.id)
    : { data: [] };
  const { count: priceCount } = await supabase
    .from('component_prices')
    .select('id', { count: 'exact', head: true })
    .eq('active', true);
  const matched = items?.filter((item) => item.status === 'MATCH').length ?? 0;
  const excluded = (items?.length ?? 0) - matched;

  return (
    <>
      <h1>Facturación</h1>
      <div className="cards">
        <div className="card"><small>Unidades listas para facturar</small><h2>{matched}</h2></div>
        <div className="card"><small>Unidades excluidas por diferencias</small><h2>{excluded}</h2></div>
        <div className="card"><small>Precios activos configurados</small><h2>{priceCount ?? 0}</h2></div>
      </div>
      <section className="card module-card">
        <h2>Regla de facturación</h2>
        <p>Solo las unidades con coincidencia exacta se habilitan para facturación. Las unidades facturadas sin albarán quedan excluidas hasta revisión.</p>
      </section>
    </>
  );
}
