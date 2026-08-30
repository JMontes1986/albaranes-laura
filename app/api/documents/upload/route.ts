import crypto from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateUpload } from '@/lib/security/upload';
import { encryptFile } from '@/lib/crypto/files';

export const runtime = 'nodejs';

function uploadError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'UPLOAD_FAILURE';
  console.error('[documents/upload]', message);

  if (
    message === 'FILE_SIZE_INVALID' ||
    message === 'INVALID_PDF_MAGIC' ||
    message === 'UNSUPPORTED_FILE_TYPE'
  ) {
    return Response.json({ error: message }, { status: 400 });
  }

  if (message.startsWith('FILE_ENCRYPTION_KEY')) {
    return Response.json(
      {
        error: 'SERVER_MISCONFIGURED',
        message:
          'FILE_ENCRYPTION_KEY debe contener exactamente 32 bytes codificados en Base64.',
      },
      { status: 500 },
    );
  }

  return Response.json(
    { error: 'UPLOAD_FAILURE', message: 'No se pudo procesar la subida.' },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    if (!process.env.FILE_ENCRYPTION_KEY) {
      return Response.json(
        {
          error: 'SERVER_MISCONFIGURED',
          message: 'Falta FILE_ENCRYPTION_KEY en el entorno de producción.',
        },
        { status: 500 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role,active')
      .eq('id', user.id)
      .single();

    if (profileError || profile?.role !== 'admin' || !profile.active) {
      return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'FILE_REQUIRED' }, { status: 400 });
    }

    const raw = Buffer.from(await file.arrayBuffer());
    const metadata = validateUpload(
      { name: file.name, type: file.type, size: file.size },
      raw.subarray(0, 16),
    );
    const encrypted = encryptFile(raw);
    const id = crypto.randomUUID();
    const storagePath = `${user.id}/${id}.bin`;
    const { error: storageError } = await supabase.storage
      .from('documents-encrypted')
      .upload(storagePath, encrypted.ciphertext, {
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (storageError) {
      console.error('[documents/upload/storage]', storageError.message);
      return Response.json({ error: 'STORAGE_FAILURE' }, { status: 500 });
    }

    const { data, error: databaseError } = await supabase
      .from('documents')
      .insert({
        id,
        original_filename: metadata.safeName,
        mime_type:
          file.type || (metadata.kind === 'pdf' ? 'application/pdf' : 'text/csv'),
        document_type: metadata.kind === 'pdf' ? 'pdf_support' : 'csv_units',
        storage_path: storagePath,
        encrypted: true,
        encryption_version: encrypted.encryptionVersion,
        encrypted_file_key: encrypted.encryptedFileKey,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_iv: encrypted.keyIv,
        key_auth_tag: encrypted.keyAuthTag,
        sha256: encrypted.sha256,
        size_bytes: file.size,
        uploaded_by: user.id,
        status: 'pending',
      })
      .select('id,original_filename,sha256,status,created_at')
      .single();

    if (databaseError) {
      console.error('[documents/upload/database]', databaseError.message);
      await supabase.storage.from('documents-encrypted').remove([storagePath]);
      return Response.json(
        {
          error:
            databaseError.code === '23505'
              ? 'DUPLICATE_DOCUMENT'
              : 'DATABASE_FAILURE',
        },
        { status: databaseError.code === '23505' ? 409 : 500 },
      );
    }

    return Response.json(data, { status: 201 });
  } catch (cause) {
    return uploadError(cause);
  }
}
