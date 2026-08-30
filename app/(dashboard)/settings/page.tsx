const checks = [
  ['Supabase', Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)],
  ['Cifrado de archivos', Boolean(process.env.FILE_ENCRYPTION_KEY)],
  ['IA Groq', Boolean(process.env.GROQ_API_KEY)],
] as const;

export default function SettingsPage() {
  return <><h1>Configuración</h1><section className="card module-card"><h2>Servicios del análisis automático</h2><div className="settings-list">{checks.map(([name, ready]) => <div className="setting-row" key={name}><span>{name}</span><span className={ready ? 'result-success' : 'result-error'}>{ready ? 'Configurado' : 'Falta configurar'}</span></div>)}</div><p className="muted">Los valores secretos nunca se muestran en esta pantalla.</p></section></>;
}
