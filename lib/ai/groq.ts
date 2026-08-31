import { createGroq } from '@ai-sdk/groq';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { encodeForLLM } from './toon';

const ScannedPageSchema = z.object({
  items: z.array(
    z.object({
      unit_number: z.string(),
      page_number: z.number().int().positive(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type ScannedPageImage = {
  pageNumber: number;
  png: Uint8Array;
};

const Item = z.object({
  delivery_note_number: z.string().nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  destination: z.string().nullable(),
  product: z.string().nullable(),
  component_code: z.string().nullable(),
  unit_number: z.string().nullable(),
  blood_group: z.string().nullable(),
  expiration_date: z.string().nullable(),
  volume: z.string().nullable(),
  observations: z.string().nullable(),
  page_number: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
});

export const ExtractionSchema = z.object({ items: z.array(Item) });

export async function extractAmbiguousDeliveryData(input: unknown, complex = true) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY missing');
  }

  const provider = createGroq({ apiKey: process.env.GROQ_API_KEY });
  const { payload, metrics } = encodeForLLM(input);
  const model = complex
    ? process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b'
    : process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b';
  const started = Date.now();
  const result = await generateText({
    model: provider(model),
    output: Output.object({ schema: ExtractionSchema }),
    system:
      'Eres un motor de extracción de albaranes. No calcules importes ni inventes datos. ' +
      'Extrae exclusivamente las unidades que aparecen en páginas de albarán o despacho. ' +
      'La entrada puede incluir expected_units como candidatos: devuelve una unidad esperada ' +
      'solo si su número aparece realmente en el texto del PDF; no asumas que están todas. ' +
      'Conserva literalmente el número de albarán, código de componente y número de unidad. ' +
      'Devuelve las fechas como YYYY-MM-DD. Si un campo no puede determinarse, usa null.',
    prompt: payload,
    temperature: 0,
  });

  return {
    data: result.output,
    metrics: {
      ...metrics,
      model,
      latencyMs: Date.now() - started,
      outputTokens: result.usage.outputTokens,
    },
  };
}

export async function extractUnitsFromScannedPages(
  pages: ScannedPageImage[],
  expectedUnitNumbers: string[],
) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  if (pages.length === 0) return { items: [], model: '', latencyMs: 0, outputTokens: 0 };

  const provider = createGroq({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
  const started = Date.now();
  const pageMap = pages.map((page, index) => `imagen ${index + 1} = página PDF ${page.pageNumber}`);
  const result = await generateText({
    model: provider(model),
    output: Output.object({ schema: ScannedPageSchema }),
    system:
      'Eres un OCR especializado en documentos sanitarios. No inventes ni completes números. ' +
      'Devuelve una unidad únicamente cuando el número completo sea visible en una imagen. ' +
      'Compara ignorando espacios, guiones y separadores, pero devuelve literalmente el candidato esperado. ' +
      'Si no ves ninguna coincidencia exacta, devuelve items vacío.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Correspondencia de imágenes: ${pageMap.join('; ')}.\n` +
              `Candidatos permitidos: ${JSON.stringify(expectedUnitNumbers)}.\n` +
              'Busca exclusivamente esos números de unidad y devuelve su página PDF.',
          },
          ...pages.map((page) => ({
            type: 'file' as const,
            mediaType: 'image/png',
            data: page.png,
          })),
        ],
      },
    ],
    temperature: 0,
  });

  return {
    items: result.output.items,
    model,
    latencyMs: Date.now() - started,
    outputTokens: result.usage.outputTokens ?? 0,
  };
}
