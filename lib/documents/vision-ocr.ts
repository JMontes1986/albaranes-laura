import { extractIdentifiersFromImage } from '@/lib/ai/groq';

export type VisionOcrPage = {
  pageNumber: number;
  data: Uint8Array;
};

export type VisionOcrResult = {
  pageNumber: number;
  text: string;
  confidence: number;
};

export function createVisionOcrPool(abortSignal?: AbortSignal) {
  return {
    async recognize(pages: VisionOcrPage[]): Promise<VisionOcrResult[]> {
      const results: VisionOcrResult[] = [];
      for (const page of pages) {
        const result = await extractIdentifiersFromImage(page.data, abortSignal);
        results.push({
          pageNumber: page.pageNumber,
          text: result.tokens.join('\n'),
          confidence: 0.95,
        });
      }
      return results;
    },
    async terminate() {},
  };
}
