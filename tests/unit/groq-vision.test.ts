import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractIdentifiersFromImage } from '@/lib/ai/groq';

describe('Groq vision OCR', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_VISION_MODEL;
  });

  it('sends one compressed image with bounded non-reasoning output', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '2631010001 00\n143909' } },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', request);

    const result = await extractIdentifiersFromImage(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );

    expect(result.tokens).toEqual(['2631010001 00', '143909']);
    const [, options] = request.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({
      model: 'qwen/qwen3.6-27b',
      reasoning_effort: 'none',
      max_completion_tokens: 300,
    });
    expect(body).not.toHaveProperty('response_format');
    expect(body.messages[0].content[1].image_url.url).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it('exposes rate limiting as a resumable error', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'tokens per minute exceeded' } }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(
      extractIdentifiersFromImage(new Uint8Array([1])),
    ).rejects.toThrow('GROQ_RATE_LIMIT:tokens per minute exceeded');
  });

  it('treats temporary provider failures as resumable', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      extractIdentifiersFromImage(new Uint8Array([1])),
    ).rejects.toThrow('GROQ_TRANSIENT:503:upstream unavailable');
  });
});
