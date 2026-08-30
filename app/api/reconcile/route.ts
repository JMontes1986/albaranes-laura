import { z } from 'zod';import { reconcile } from '@/lib/reconciliation/engine';
const Body=z.object({csv:z.array(z.any()),pdf:z.array(z.any())});
export async function POST(req:Request){try{const body=Body.parse(await req.json());return Response.json(reconcile(body.csv,body.pdf))}catch{return Response.json({error:'INVALID_PAYLOAD'},{status:400})}}
