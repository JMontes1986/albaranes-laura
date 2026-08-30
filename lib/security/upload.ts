import { z } from 'zod';

// Vercel Functions reject request bodies above 4.5 MB. Keep enough room for the
// multipart envelope added by FormData and never advertise an unsupported size.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function configuredMaxUploadBytes() {
  const configuredMb = Number(process.env.MAX_UPLOAD_MB || 4);
  const configuredBytes = Number.isFinite(configuredMb)
    ? configuredMb * 1024 * 1024
    : MAX_UPLOAD_BYTES;

  return Math.min(configuredBytes, MAX_UPLOAD_BYTES);
}

export function validateUpload(
  file: { name: string; type: string; size: number },
  head: Buffer,
) {
  const safe = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
  if (file.size <= 0 || file.size > configuredMaxUploadBytes()) {
    throw new Error('FILE_SIZE_INVALID');
  }
  const pdf = head.subarray(0, 5).toString('ascii') === '%PDF-';
  const csvMime = [
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
  ].includes(file.type);
  const csv = csvMime || (!file.type && file.name.toLowerCase().endsWith('.csv'));
  if (file.type === 'application/pdf' && !pdf) {
    throw new Error('INVALID_PDF_MAGIC');
  }
  if (!pdf && !csv) {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }
  return { safeName: safe, kind: pdf ? 'pdf' : 'csv' } as const;
}

export const uploadMetadataSchema=z.object({billingPeriodId:z.string().uuid(),documentType:z.enum(['pdf_support','csv_units'])});
