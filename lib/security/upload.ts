import { z } from 'zod';
const max=Number(process.env.MAX_UPLOAD_MB||25)*1024*1024;
export function validateUpload(file:{name:string;type:string;size:number},head:Buffer){const safe=file.name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180);if(file.size<=0||file.size>max)throw new Error('FILE_SIZE_INVALID');const pdf=head.subarray(0,5).toString('ascii')==='%PDF-';const csv=['text/csv','application/csv','text/plain','application/vnd.ms-excel'].includes(file.type);if(file.type==='application/pdf'&&!pdf)throw new Error('INVALID_PDF_MAGIC');if(!pdf&&!csv)throw new Error('UNSUPPORTED_FILE_TYPE');return {safeName:safe,kind:pdf?'pdf':'csv'} as const}
export const uploadMetadataSchema=z.object({billingPeriodId:z.string().uuid(),documentType:z.enum(['pdf_support','csv_units'])});
