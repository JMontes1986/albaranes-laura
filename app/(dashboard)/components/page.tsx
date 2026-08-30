import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function ComponentsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: catalog }, { data: prices }] = await Promise.all([
    supabase.from('component_catalog').select('code,description,active').order('code'),
    supabase.from('component_prices').select('component_code,unit_price,effective_from,effective_to,active').order('effective_from', { ascending: false }),
  ]);
  const latestPrice = new Map(prices?.map((price) => [price.component_code, price]));

  return (
    <>
      <h1>Componentes y precios</h1>
      <section className="card module-card">
        <h2>Catálogo detectado</h2>
        {catalog?.length ? (
          <div className="table-scroll"><table>
            <thead><tr><th>Código</th><th>Descripción</th><th>Precio unitario</th><th>Estado</th></tr></thead>
            <tbody>{catalog.map((component) => {
              const price = latestPrice.get(component.code);
              return <tr key={component.code}><td><strong>{component.code}</strong></td><td>{component.description}</td><td>{price?.unit_price == null ? 'Sin configurar' : Number(price.unit_price).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</td><td><span className="badge">{component.active ? 'Activo' : 'Inactivo'}</span></td></tr>;
            })}</tbody>
          </table></div>
        ) : <p className="muted">El catálogo se completará automáticamente desde los documentos.</p>}
      </section>
    </>
  );
}
