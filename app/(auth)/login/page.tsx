'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

const profileErrors: Record<string, string> = {
  'profile-inactive':
    'El usuario existe en Auth, pero no tiene un perfil activo en public.profiles.',
  'profile-query':
    'La sesión se creó, pero no fue posible consultar public.profiles. Revisa la migración y las políticas RLS.',
};

export default function Login() {
 const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 const router = useRouter();

 async function submit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setLoading(true);
  setError('');
  const form = new FormData(e.currentTarget);
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  try {
   const { data, error: authError } = await supabase.auth.signInWithPassword({
    email: String(form.get('email')),
    password: String(form.get('password')),
   });

   if (authError) {
    setError(`No se pudo iniciar sesión: ${authError.message}`);
    return;
   }

   const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', data.user.id)
    .maybeSingle();

   if (profileError) {
    await supabase.auth.signOut();
    setError(`No se pudo consultar public.profiles: ${profileError.message}`);
    return;
   }

   if (!profile?.active) {
    await supabase.auth.signOut();
    setError(profileErrors['profile-inactive']);
    return;
   }

   router.replace('/dashboard');
   router.refresh();
  } catch (cause) {
   setError(
    cause instanceof Error
     ? `Error de conexión con Supabase: ${cause.message}`
     : 'Error de conexión con Supabase.',
   );
  } finally {
   setLoading(false);
  }
 }

 return <main className="login"><h1>Conciliación de Albaranes</h1><p>Acceso seguro</p><form onSubmit={submit}><input className="input" name="email" type="email" required placeholder="Correo"/><input className="input" name="password" type="password" required placeholder="Contraseña"/><button className="button" disabled={loading}>{loading?'Ingresando…':'Ingresar'}</button>{error&&<p role="alert">{error}</p>}</form></main>
}
