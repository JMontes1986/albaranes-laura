import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canArchiveDocument } from '@/lib/documents/archive';

export const runtime = 'nodejs';

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  if (!profile?.active || profile.role !== 'admin') {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: document } = await admin
    .from('documents')
    .select('id,original_filename,document_type,storage_path,status,deleted_at')
    .eq('id', id)
    .maybeSingle();

  if (!document || document.deleted_at) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (!canArchiveDocument(document.status)) {
    return Response.json(
      { error: 'DOCUMENT_PROCESSING' },
      { status: 409 },
    );
  }

  const deletedAt = new Date().toISOString();
  const { data: archived, error: archiveError } = await admin
    .from('documents')
    .update({ deleted_at: deletedAt, deleted_by: user.id })
    .eq('id', id)
    .is('deleted_at', null)
    .in('status', ['pending', 'completed', 'failed'])
    .select('id')
    .maybeSingle();

  if (archiveError || !archived) {
    return Response.json({ error: 'ARCHIVE_CONFLICT' }, { status: 409 });
  }

  const { error: storageError } = await admin.storage
    .from('documents-encrypted')
    .remove([document.storage_path]);

  if (storageError) {
    await admin
      .from('documents')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', id)
      .eq('deleted_at', deletedAt);
    console.error('[documents/delete/storage]', storageError.message);
    return Response.json({ error: 'STORAGE_FAILURE' }, { status: 500 });
  }

  const [{ error: markerError }, { error: auditError }] = await Promise.all([
    admin
      .from('documents')
      .update({ storage_deleted_at: deletedAt })
      .eq('id', id),
    admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'document.archived',
      entity_type: 'document',
      entity_id: id,
      metadata: {
        original_filename: document.original_filename,
        document_type: document.document_type,
        encrypted_blob_deleted: true,
        historical_analysis_preserved: true,
      },
    }),
  ]);
  if (markerError) console.error('[documents/delete/marker]', markerError.message);
  if (auditError) console.error('[documents/delete/audit]', auditError.message);

  return Response.json({ id, deletedAt });
}
