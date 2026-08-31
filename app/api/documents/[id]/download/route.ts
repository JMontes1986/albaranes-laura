import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decryptFile, type EncryptedFile } from '@/lib/crypto/files';

export const runtime = 'nodejs';

export async function GET(
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
    .select('active')
    .eq('id', user.id)
    .single();
  if (!profile?.active) {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { data: document } = await supabase
    .from('documents')
    .select(
      'id,original_filename,mime_type,storage_path,encrypted_file_key,iv,auth_tag,key_iv,key_auth_tag,sha256,deleted_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (!document || document.deleted_at) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from('documents-encrypted')
    .download(document.storage_path);
  if (error || !data) {
    return Response.json({ error: 'STORAGE_FAILURE' }, { status: 500 });
  }

  const ciphertext = Buffer.from(await data.arrayBuffer());
  try {
    const plain = decryptFile({
      ciphertext,
      iv: document.iv,
      authTag: document.auth_tag,
      encryptedFileKey: document.encrypted_file_key,
      keyIv: document.key_iv,
      keyAuthTag: document.key_auth_tag,
      sha256: document.sha256,
      encryptionVersion: 'v1',
    } satisfies EncryptedFile);
    return new Response(plain, {
      headers: {
        'Content-Type': document.mime_type,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(document.original_filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'DECRYPTION_FAILURE' }, { status: 500 });
  }
}
