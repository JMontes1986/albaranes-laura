'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 90_000;

type UploadResult = {
  fileName: string;
  ok: boolean;
  message: string;
};

type ErrorPayload = {
  error?: string;
  message?: string;
};

const errorMessages: Record<string, string> = {
  UNAUTHORIZED: 'La sesión caducó. Vuelve a iniciar sesión.',
  FORBIDDEN: 'Sólo un administrador activo puede subir documentos.',
  FILE_REQUIRED: 'Selecciona al menos un archivo.',
  FILE_SIZE_INVALID:
    'El archivo está vacío o supera 4 MB, el máximo admitido en este despliegue.',
  INVALID_PDF_MAGIC: 'El archivo no contiene un PDF válido.',
  UNSUPPORTED_FILE_TYPE: 'Formato no permitido. Usa PDF o CSV.',
  SERVER_MISCONFIGURED:
    'Falta configurar FILE_ENCRYPTION_KEY en Vercel y redesplegar.',
  STORAGE_FAILURE:
    'No se pudo guardar en Supabase Storage. Revisa el bucket documents-encrypted y sus políticas.',
  DATABASE_FAILURE:
    'El archivo llegó a Storage, pero no pudo registrarse en public.documents.',
  DUPLICATE_DOCUMENT: 'Este documento ya fue cargado anteriormente.',
};

async function uploadFile(file: File): Promise<UploadResult> {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return {
      fileName: file.name,
      ok: false,
      message: errorMessages.FILE_SIZE_INVALID,
    };
  }

  const formData = new FormData();
  formData.set('file', file);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;

    if (!response.ok) {
      const code = payload.error ?? 'UPLOAD_FAILURE';
      return {
        fileName: file.name,
        ok: false,
        message:
          response.status === 413
            ? errorMessages.FILE_SIZE_INVALID
            : payload.message ??
              errorMessages[code] ??
              `No se pudo subir el archivo (HTTP ${response.status}).`,
      };
    }

    return {
      fileName: file.name,
      ok: true,
      message: 'Subido y cifrado correctamente.',
    };
  } catch (cause) {
    return {
      fileName: file.name,
      ok: false,
      message:
        cause instanceof DOMException && cause.name === 'AbortError'
          ? 'La subida tardó más de 90 segundos y fue cancelada. Inténtalo de nuevo.'
          : 'Se perdió la conexión durante la subida. Inténtalo de nuevo.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function DocumentUploadForm() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<UploadResult[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('files');
    const files =
      input instanceof HTMLInputElement && input.files
        ? Array.from(input.files)
        : [];

    if (files.length === 0) {
      setResults([
        { fileName: 'Sin archivo', ok: false, message: errorMessages.FILE_REQUIRED },
      ]);
      return;
    }

    setUploading(true);
    setResults([]);
    const nextResults: UploadResult[] = [];

    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Subiendo ${index + 1} de ${files.length}: ${file.name}`);
        const result = await uploadFile(file);
        nextResults.push(result);
        setResults([...nextResults]);
      }

      if (nextResults.some((result) => result.ok)) {
        form.reset();
        router.refresh();
      }
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  return (
    <section className="card upload-panel" aria-labelledby="upload-title">
      <h2 id="upload-title">Subir documentos</h2>
      <p className="muted">
        Admite PDF y CSV de hasta 4 MB. Los archivos se cifran antes de guardarse
        en el bucket privado de Supabase. Los PDF escaneados de hasta 80 páginas
        se optimizan al extremo y se convierten en datos Markdown para el análisis
        mensual con IA.
      </p>
      <form className="upload-form" onSubmit={handleSubmit}>
        <label htmlFor="document-files">Archivos</label>
        <input
          className="input file-input"
          id="document-files"
          name="files"
          type="file"
          accept="application/pdf,text/csv,.csv"
          multiple
          disabled={uploading}
          required
        />
        <button className="button" type="submit" disabled={uploading}>
          {uploading ? 'Subiendo…' : 'Subir documentos'}
        </button>
      </form>
      <div className="upload-feedback" aria-live="polite">
        {progress ? <p>{progress}</p> : null}
        {results.length > 0 ? (
          <ul className="upload-results">
            {results.map((result) => (
              <li
                className={result.ok ? 'result-success' : 'result-error'}
                key={`${result.fileName}-${result.message}`}
              >
                <strong>{result.fileName}:</strong> {result.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
