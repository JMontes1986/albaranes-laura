import { createScheduler, createWorker, OEM, PSM } from 'tesseract.js';
import english from '@tesseract.js-data/eng';

export type LocalOcrPage = {
  pageNumber: number;
  data: Uint8Array;
};

export type LocalOcrResult = {
  pageNumber: number;
  text: string;
  confidence: number;
};

export async function createLocalOcrPool(concurrency = 2) {
  const scheduler = createScheduler();
  const workerCount = Math.max(1, concurrency);

  try {
    const workers = await Promise.all(
      Array.from({ length: workerCount }, () =>
        createWorker(english.code, OEM.LSTM_ONLY, {
          langPath: english.langPath,
          gzip: english.gzip,
          cacheMethod: 'none',
        }),
      ),
    );
    await Promise.all(
      workers.map(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
          user_defined_dpi: '200',
        });
        scheduler.addWorker(worker);
      }),
    );
  } catch (cause) {
    await scheduler.terminate();
    throw cause;
  }

  return {
    async recognize(pages: LocalOcrPage[]): Promise<LocalOcrResult[]> {
      return Promise.all(
        pages.map(async (page) => {
          const result = await scheduler.addJob('recognize', Buffer.from(page.data));
          return {
            pageNumber: page.pageNumber,
            text: result.data.text.trim(),
            confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
          };
        }),
      );
    },
    terminate: () => scheduler.terminate(),
  };
}

export async function recognizePageImages(
  pages: LocalOcrPage[],
  concurrency = 2,
): Promise<LocalOcrResult[]> {
  if (pages.length === 0) return [];
  const pool = await createLocalOcrPool(Math.min(concurrency, pages.length));
  try {
    return await pool.recognize(pages);
  } finally {
    await pool.terminate();
  }
}
