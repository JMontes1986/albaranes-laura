import { extractIdentifiersFromImages } from '@/lib/ai/groq';

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
      const result = await extractIdentifiersFromImages(
        pages.map((page) => ({
          pageNumber: page.pageNumber,
          image: page.data,
        })),
        abortSignal,
      );
      return result.pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.tokens.join('\n'),
        confidence: 0.95,
      }));
    },
    async terminate() {},
  };
}
