'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
export default function Login(){
 const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setLoading(true);setError('');const f=new FormData(e.currentTarget);const supabase=createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);const {error}=await supabase.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(error){setError('Credenciales inválidas o usuario inactivo.');setLoading(false);return;}location.href='/dashboard'}
 return <main className="login"><h1>Conciliación de Albaranes</h1><p>Acceso seguro</p><form onSubmit={submit}><input className="input" name="email" type="email" required placeholder="Correo"/><input className="input" name="password" type="password" required placeholder="Contraseña"/><button className="button" disabled={loading}>{loading?'Ingresando…':'Ingresar'}</button>{error&&<p>{error}</p>}</form></main>
}
