import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  claimPendingPair,
  claimFailedPair,
  processClaimedPair,
  recoverStaleProcessing,
} from '@/lib/reconciliation/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,active')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin' || !profile.active) {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      retry?: boolean;
      recover?: boolean;
    };
    if (body.recover) {
      const recovered = await recoverStaleProcessing(user.id);
      return Response.json({ recovered });
    }
    const pair = body.retry
      ? await claimFailedPair(user.id)
      : await claimPendingPair(user.id);
    if (!pair) return Response.json({ started: false });

    after(async () => {
      try {
        await processClaimedPair(pair);
      } catch (cause) {
        console.error('[reconciliations/automatic]', cause);
      }
    });
    return Response.json({ started: true }, { status: 202 });
  } catch (cause) {
    console.error('[reconciliations/automatic/claim]', cause);
    return Response.json({ error: 'PROCESSING_START_FAILED' }, { status: 500 });
  }
}
