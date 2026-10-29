import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPersonalizationQuestions } from '@/lib/etsy-product-inventory';

vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));
import { syncListingPersonalization } from '@/lib/local-listings';

beforeEach(() => { vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
