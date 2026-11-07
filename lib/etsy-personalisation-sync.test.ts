import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPersonalizationQuestions } from '@/lib/etsy-product-inventory';

vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));
import { syncListingPersonalization } from '@/lib/local-listings';

beforeEach(() => { vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('syncing a single customisation fee to Etsy', () => {
  it('replaces separate free text boxes with one paid box while preserving font option IDs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ personalization_questions: [
        { question_id: 1, question_text: 'Font Style', question_type: 'dropdown', options: [{ option_id: 10, label: 'Nunito' }] },
        { question_id: 2, question_text: 'Top Text', question_type: 'text_input', add_on_price: null },
        { question_id: 3, question_text: 'Bottom Text', question_type: 'text_input', add_on_price: null },
      ] }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true, 300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/personalization?supports_multiple_personalization_questions=true');
    expect(init.method).toBe('POST');
    const questions = JSON.parse(init.body).personalization_questions;
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ question_id: '1', question_text: 'Font Style' });
    expect(questions[0].options).toContainEqual({ label: 'Nunito', option_id: '10' });
    expect(questions[1]).toMatchObject({ question_text: 'Custom Text', required: false, add_on_price: 3 });
  });

  it('does not resend questions when Etsy already has the configured fee', async () => {
    const questions = buildPersonalizationQuestions(true, true, true, 300).map((question) => ({
      ...question,
      ...('add_on_price' in question ? { add_on_price: { amount: 300, divisor: 100, currency_code: 'GBP' } } : {}),
    }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ personalization_questions: questions }));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, true, true, 300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('updates the paid question when the configured fee changes', async () => {
    const questions = buildPersonalizationQuestions(true, false, true, 300).map((question, index) => ({ ...question, question_id: index + 1 }));
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ personalization_questions: questions })).mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await syncListingPersonalization('66615491', '111', true, false, true, 450);
    const changed = JSON.parse(fetchMock.mock.calls[1][1].body).personalization_questions;
    expect(changed[1]).toMatchObject({ question_id: '2', question_text: 'Bottom Text', add_on_price: 4.5 });
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
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true, 300);
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
    const assertion = expect(syncListingPersonalization('66615491', '4541741363', true, true, true, 300))
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
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true, 300);
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
    await expect(syncListingPersonalization('66615491', '4541741363', true, true, true, 300))
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
    const result = syncListingPersonalization('66615491', '4541741363', true, true, true, 300);
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
    const assertion = expect(syncListingPersonalization('66615491', '4541741363', true, true, true, 300))
      .rejects.toThrow('Etsy API returned 429');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
