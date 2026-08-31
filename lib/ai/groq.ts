import { createGroq } from '@ai-sdk/groq';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { encodeForLLM } from './toon';

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

const VisionOcrSchema = z.object({
  tokens: z.array(z.string()).default([]),
});

function groqErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return 'unknown';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.slice(0, 400) : 'unknown';
}

export async function extractIdentifiersFromImage(
  image: Uint8Array,
  abortSignal?: AbortSignal,
) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  const model = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
  const pageTimeout = AbortSignal.timeout(45_000);
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, pageTimeout])
    : pageTimeout;
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Realiza OCR literal de esta página de un albarán. Devuelve exclusivamente JSON con la forma {"tokens":["..."]}. Incluye todos los números de unidad, códigos alfanuméricos, números de albarán y fechas visibles. No expliques, no inventes y no incluyas texto narrativo.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}`,
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        reasoning_effort: 'none',
        max_completion_tokens: 300,
        temperature: 0.1,
      }),
      signal,
    });
  } catch (cause) {
    if (abortSignal?.aborted) throw new Error('PROCESSING_TIMEOUT');
    const detail = cause instanceof Error ? cause.message.slice(0, 200) : 'network';
    throw new Error(`GROQ_TRANSIENT:${detail}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    const detail = groqErrorDetail(payload);
    if (response.status === 429) throw new Error(`GROQ_RATE_LIMIT:${detail}`);
    if ([408, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`GROQ_TRANSIENT:${response.status}:${detail}`);
    }
    throw new Error(`GROQ_VISION_${response.status}:${detail}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('GROQ_VISION_EMPTY');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    throw new Error('GROQ_VISION_INVALID_JSON');
  }
  const result = VisionOcrSchema.safeParse(parsed);
  if (!result.success) throw new Error('GROQ_VISION_INVALID_OUTPUT');
  return { tokens: result.data.tokens, model };
}

export async function extractAmbiguousDeliveryData(
  input: unknown,
  complex = true,
  abortSignal?: AbortSignal,
) {
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
    abortSignal,
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
