'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  hasPendingPair: boolean;
  isProcessing: boolean;
  hasFailed: boolean;
  failureReason: string;
};

export function DocumentProcessingMonitor({
  hasPendingPair,
  isProcessing,
  hasFailed,
  failureReason,
}: Props) {
  const router = useRouter();
  const attempted = useRef(false);
  const [startError, setStartError] = useState('');
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    setStartError('');
    try {
      const response = await fetch('/api/reconciliations/automatic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retry: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      router.refresh();
    } catch {
      setStartError('No se pudo reintentar el análisis.');
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    if (!hasPendingPair) {
      attempted.current = false;
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    let active = true;
    fetch('/api/reconciliations/automatic', { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (active) router.refresh();
      })
      .catch(() => {
        if (active) setStartError('No se pudo iniciar el análisis automático.');
      });
    return () => {
      active = false;
    };
  }, [hasPendingPair, router]);

  useEffect(() => {
    if (!hasPendingPair && !isProcessing) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [hasPendingPair, isProcessing, router]);

  if (!hasPendingPair && !isProcessing && !hasFailed && !startError) return null;

  return (
    <section className="processing-notice" aria-live="polite">
      {hasPendingPair ? (
        <p>Preparando el análisis automático del PDF y el CSV…</p>
      ) : null}
      {isProcessing ? (
        <p>La IA está extrayendo el albarán y comparando sus unidades.</p>
      ) : null}
      {hasFailed ? (
        <div>
          <p className="result-error">
            El análisis falló: {failureReason}
          </p>
          <button className="button" type="button" onClick={retry} disabled={retrying}>
            {retrying ? 'Reintentando…' : 'Reintentar análisis'}
          </button>
        </div>
      ) : null}
      {startError ? <p className="result-error">{startError}</p> : null}
    </section>
  );
}
