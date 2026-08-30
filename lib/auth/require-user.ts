import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
export async function requireUser(){const s=await createSupabaseServerClient();const {data:{user}}=await s.auth.getUser();if(!user) redirect('/login');const {data:profile}=await s.from('profiles').select('id,email,full_name,role,active').eq('id',user.id).single();if(!profile?.active){await s.auth.signOut();redirect('/login')}return {user,profile}}
