import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: users, error } = await supabase.from('profiles').select('id,email,full_name,role,active,created_at').order('created_at');
  return <><h1>Usuarios</h1><section className="card module-card"><h2>Perfiles con acceso</h2>{error ? <p className="result-error">No tienes permiso para consultar usuarios.</p> : users?.length ? <div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.full_name || 'Sin nombre'}</td><td>{user.email}</td><td>{user.role}</td><td><span className="badge">{user.active ? 'Activo' : 'Inactivo'}</span></td></tr>)}</tbody></table></div> : <p className="muted">No hay perfiles registrados.</p>}</section></>;
}
