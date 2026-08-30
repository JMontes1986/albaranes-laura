import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function createSupabaseServerClient(){const store=await cookies();return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>store.getAll(),setAll:(items)=>{try{items.forEach(({name,value,options})=>store.set(name,value,{...options,sameSite:'lax',secure:process.env.NODE_ENV==='production'}))}catch{}}}})}
