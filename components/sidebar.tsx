import Link from 'next/link';
const admin=[['Dashboard','/dashboard'],['Cortes','/billing-periods'],['Documentos','/documents'],['Conciliaciones','/reconciliations'],['Facturación','/billing'],['Componentes y precios','/components'],['Reportes','/reports'],['Usuarios','/users'],['Auditoría','/audit'],['Configuración','/settings']];
const viewer=admin.filter(([n])=>!['Documentos','Usuarios','Auditoría','Configuración','Componentes y precios'].includes(n));
export function Sidebar({role}:{role:'admin'|'viewer'}){return <aside className="sidebar"><h2>Albaranes</h2><small>{role==='admin'?'Administrador':'Visualizador'}</small><nav>{(role==='admin'?admin:viewer).map(([n,h])=><Link key={h} href={h}>{n}</Link>)}</nav></aside>}
