import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPersonalizationQuestions } from '@/lib/etsy-product-inventory';

vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));
import { syncListingPersonalization } from '@/lib/local-listings';

beforeEach(() => { vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('syncing free Etsy personalisation', () => {
  it('replaces a combined paid text box with separate free boxes while preserving font and option IDs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [
        { question_id: 1, question_text: 'Font Style', question_type: 'dropdown', options: [{ option_id: 10, label: 'Nunito' }] },
        { question_id: 2, question_text: 'Custom Text', question_type: 'text_input', add_on_price: 3 },
      ] }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/personalization?supports_multiple_personalization_questions=true');
    expect(init.method).toBe('POST');
    const questions = JSON.parse(init.body).personalization_questions;
    expect(questions).toHaveLength(3);
    expect(questions[0]).toMatchObject({ question_id: '1', question_text: 'Font Style (default: Nunito)', required: false });
    expect(questions[0].options).toContainEqual({ label: 'Nunito', option_id: '10' });
    expect(questions.slice(1)).toEqual([
      expect.objectContaining({ question_text: 'Top Text', required: false, add_on_price: 0, max_allowed_characters: 40 }),
      expect.objectContaining({ question_text: 'Bottom Text', required: false, add_on_price: 0, max_allowed_characters: 40 }),
    ]);
    expect(questions.slice(1).every((question: { question_id?: string }) => !question.question_id)).toBe(true);
  });

  it.each(['Font', 'Font Style', 'Font Style (default: Nunito)'])('updates the %s question in place and is idempotent after removing the opt-out choice', async (fontLabel) => {
    let savedQuestions: unknown[] = [
      {
        question_id: 11, question_text: fontLabel, question_type: 'dropdown', required: true,
        options: [{ option_id: 99, label: 'No Customisation' }, { option_id: 10, label: 'Nunito' }, { option_id: 20, label: 'Caveat' }],
      },
      ...buildPersonalizationQuestions(true, true, true).slice(1).map((question, index) => ({ ...question, question_id: 22 + index })),
    ];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json({ personalization_questions: savedQuestions });
      savedQuestions = JSON.parse(String(init.body)).personalization_questions;
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncListingPersonalization('66615491', '111', true, true, true);
    await syncListingPersonalization('66615491', '111', true, true, true);

    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET']);
    expect(savedQuestions[0]).toMatchObject({
      question_id: '11', question_text: 'Font Style (default: Nunito)', required: false,
      options: [
        { label: 'Nunito', option_id: '10' },
        { label: 'Fredoka' },
        { label: 'Quicksand' },
        { label: 'Patrick Hand' },
        { label: 'Caveat', option_id: '20' },
        { label: 'Sacramento' },
      ],
    });
    expect(savedQuestions.slice(1)).toEqual([
      expect.objectContaining({ question_id: '22', question_text: 'Top Text', add_on_price: 0 }),
      expect.objectContaining({ question_id: '23', question_text: 'Bottom Text', add_on_price: 0 }),
    ]);
  });

  it.each([0, null, { amount: 0, divisor: 100, currency_code: 'GBP' }])('does not resend existing free questions (price %j)', async (freePrice) => {
    const questions = buildPersonalizationQuestions(true, true, true).map((question) => ({
      ...question,
      ...('add_on_price' in question ? { add_on_price: freePrice } : {}),
    }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ personalization_questions: questions }));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['Font', 'Font Style'])('publishes the Nunito default label when %s is otherwise already current', async (legacyLabel) => {
    const questions = buildPersonalizationQuestions(true, true, true).map((question, index) => ({
      ...question, question_id: index + 1, ...(index === 0 ? { question_text: legacyLabel } : {}),
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: questions }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST']);
    const changed = JSON.parse(fetchMock.mock.calls[1][1].body).personalization_questions;
    expect(changed[0]).toMatchObject({ question_id: '1', question_text: 'Font Style (default: Nunito)', required: false });
  });

  it('explicitly removes fees from separate questions while preserving their IDs', async () => {
    const questions = buildPersonalizationQuestions(true, true, true).map((question, index) => ({
      ...question,
      question_id: index + 1,
      ...('add_on_price' in question ? { add_on_price: { amount: 300, divisor: 100 } } : {}),
    }));
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ personalization_questions: questions })).mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const changed = JSON.parse(fetchMock.mock.calls[1][1].body).personalization_questions;
    expect(changed[1]).toMatchObject({ question_id: '2', question_text: 'Top Text', add_on_price: 0 });
    expect(changed[2]).toMatchObject({ question_id: '3', question_text: 'Bottom Text', add_on_price: 0 });
  });

  it('restores font, top, bottom order even when existing fields are otherwise current', async () => {
    const questions = buildPersonalizationQuestions(true, true, true).map((question, index) => ({ ...question, question_id: index + 1 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [questions[2], questions[0], questions[1]] }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const changed = JSON.parse(fetchMock.mock.calls[1][1].body).personalization_questions;
    expect(changed.map((question: { question_text: string }) => question.question_text)).toEqual(['Font Style (default: Nunito)', 'Top Text', 'Bottom Text']);
    expect(changed.map((question: { question_id: string }) => question.question_id)).toEqual(['1', '2', '3']);
  });

  it.each([[true, false, 'Top Text'], [false, true, 'Bottom Text']] as const)('replaces a paid question with only the enabled text area (top %s, bottom %s)', async (top, bottom, label) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [
        { question_id: 1, question_text: 'Font Style', question_type: 'dropdown' },
        { question_id: 2, question_text: label, question_type: 'text_input', add_on_price: 4.5 },
      ] }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, top, bottom);
    const changed = JSON.parse(fetchMock.mock.calls[1][1].body).personalization_questions;
    expect(changed).toHaveLength(2);
    expect(changed.map((question: { question_text: string }) => question.question_text)).toEqual(['Font Style (default: Nunito)', label]);
    expect(changed[1]).toMatchObject({ question_id: '2', question_text: label, add_on_price: 0, max_allowed_characters: 40 });
  });

  it.each([[false, true, true], [true, false, false]])('clears existing fields when customisation is disabled (customise %s, top %s, bottom %s)', async (customise, top, bottom) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [{ question_id: 2, question_text: 'Custom Text', add_on_price: 3 }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', customise, top, bottom);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'DELETE']);
  });

  it('does not send a delete when customisation is disabled and Etsy has no fields', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ personalization_questions: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', false, false, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('temporary Etsy listing edit locks', () => {
  const locked = () => Response.json({
    error: 'The Listing with listing_id 4541741363 is being edited by another process. Please try again in a few moments.',
  }, { status: 409, statusText: 'Conflict' });

  it('waits and retries only the rejected edit, preserving the request body', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockResolvedValueOnce(locked())
      .mockResolvedValueOnce(locked())
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'POST', 'POST']);
    const requests = fetchMock.mock.calls.slice(1).map(([url, { signal: _signal, ...init }]) => [url, init]);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
  });

  it('stops after bounded retries and identifies the listing that remains locked', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockImplementation(async () => locked());
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(syncListingPersonalization('66615491', '4541741363', true, true, true))
      .rejects.toThrow(/4541741363.*try syncing again/i);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('respects Retry-After for a listing lock', async () => {
    vi.useFakeTimers();
    const response = locked();
    response.headers.set('Retry-After', '5');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 409, 500, 503])('does not retry unrelated HTTP %s failures', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockResolvedValueOnce(Response.json({ error: 'Unrelated API failure' }, { status }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncListingPersonalization('66615491', '4541741363', true, true, true))
      .rejects.toThrow(`Etsy API returned ${status}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains rate-limit retries and their Retry-After delay', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockResolvedValueOnce(Response.json({ error: 'Rate limit' }, { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the existing limit of three attempts for rate-limit responses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [] }))
      .mockImplementation(async () => Response.json({ error: 'Rate limit' }, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(syncListingPersonalization('66615491', '4541741363', true, true, true))
      .rejects.toThrow('Etsy API returned 429');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
