import type {CSVNormalizedRecord} from '@/lib/csv/parser';
export type PDFItem={componentCode:string;unitNumber:string;bloodGroup?:string|null;expirationDate?:string|null};
export type PDFDeliveryNote={deliveryNoteNumber:string;dispatchDate:string|null;pageNumber?:number;confidence:number;items:PDFItem[]};
export type ReconciliationStatus='MATCH'|'PDF_ONLY'|'CSV_ONLY'|'QUANTITY_MISMATCH'|'COMPONENT_MISMATCH'|'DATE_MISMATCH'|'DUPLICATE'|'RETURNED'|'REVIEW_REQUIRED';
export type ReconciliationItem={deliveryNoteNumber:string;componentCode:string;unitNumber:string;status:ReconciliationStatus;csv?:CSVNormalizedRecord;pdf?:PDFItem;notes?:string[]};
export type DeliveryNoteSummary={deliveryNoteNumber:string;csvUnits:number;pdfUnits:number;matchedUnits:number;pdfOnly:number;csvOnly:number;differences:number;percentageMatch:number;confidence:number};
export type ReconciliationResult={items:ReconciliationItem[];summaries:DeliveryNoteSummary[]};
