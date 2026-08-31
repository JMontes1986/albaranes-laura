'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PROCESSING_STALE_MS,
  elapsedProcessingMs,
  formatElapsedTime,
} from '@/lib/documents/processing';

type Props = {
  hasPendingPair: boolean;
  isProcessing: boolean;
  hasFailed: boolean;
  failureReason: string;
  processingStartedAt: string | null;
  processingProgress: number;
  processingStage: string | null;
};

export function DocumentProcessingMonitor({
  hasPendingPair,
  isProcessing,
  hasFailed,
  failureReason,
  processingStartedAt,
  processingProgress,
  processingStage,
}: Props) {
  const router = useRouter();
  const attempted = useRef(false);
  const recoveryAttempted = useRef(false);
  const [startError, setStartError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const elapsed = elapsedProcessingMs(processingStartedAt, now);

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
    if (!isProcessing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isProcessing, processingStartedAt]);

  useEffect(() => {
    if (!isProcessing || elapsed < PROCESSING_STALE_MS) {
      if (!isProcessing) recoveryAttempted.current = false;
      return;
    }
    if (recoveryAttempted.current) return;
    recoveryAttempted.current = true;
    let active = true;
    fetch('/api/reconciliations/automatic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recover: true }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (active) router.refresh();
      })
      .catch(() => {
        if (active) {
          setStartError('No se pudo recuperar automáticamente el análisis bloqueado.');
        }
      });
    return () => {
      active = false;
    };
  }, [elapsed, isProcessing, router]);

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
        <div className="processing-details">
          <p>
            {processingStage ||
              'El sistema está extrayendo el albarán y comparando sus unidades.'}
          </p>
          <div className="processing-time">
            <strong>Tiempo: {formatElapsedTime(elapsed)}</strong>
            <span>Límite: {formatElapsedTime(PROCESSING_STALE_MS)}</span>
          </div>
          <progress
            aria-label="Progreso del análisis"
            max="100"
            value={Math.max(1, Math.min(99, processingProgress))}
          />
          <small>
            {elapsed >= PROCESSING_STALE_MS
              ? 'Comprobando y recuperando un análisis bloqueado…'
              : `${Math.max(1, processingProgress)} % completado`}
          </small>
        </div>
      ) : null}
      {hasFailed ? (
        <div>
          <p className="result-error">El análisis falló: {failureReason}</p>
          <button className="button" type="button" onClick={retry} disabled={retrying}>
            {retrying ? 'Reintentando…' : 'Reintentar análisis'}
          </button>
        </div>
      ) : null}
      {startError ? <p className="result-error">{startError}</p> : null}
    </section>
  );
}
