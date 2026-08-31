'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DocumentDeleteButton({
  documentId,
  filename,
  disabled,
}: {
  documentId: string;
  filename: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    const confirmed = window.confirm(
      `¿Eliminar ${filename}? El archivo cifrado se borrará, pero su análisis histórico se conservará.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? 'DELETE_FAILED');
      }
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'DELETE_FAILED';
      setError(
        message === 'DOCUMENT_PROCESSING' || message === 'ARCHIVE_CONFLICT'
          ? 'Espera a que termine el análisis.'
          : 'No se pudo eliminar.',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <span className="delete-control">
      <button
        className="link-button link-button-danger"
        type="button"
        onClick={remove}
        disabled={disabled || deleting}
        title={disabled ? 'Espera a que termine el análisis' : undefined}
      >
        {deleting ? 'Eliminando…' : 'Eliminar'}
      </button>
      {error ? (
        <small className="result-error" role="status" aria-live="polite">
          {error}
        </small>
      ) : null}
    </span>
  );
}
