import { describe, expect, it } from 'vitest';
import { getEtsyItemCustomisation, getEtsyOrderType } from './etsy-order-customisation';

function item(border: string, font: string, topText = '', bottomText = '') {
  return { topText, bottomText, rawJson: { variations: [
    { formatted_name: 'Border', formatted_value: border },
    { formatted_name: 'Font Style', formatted_value: font },
  ] } };
}
describe('Etsy order customisation classification', () => {
  it('classifies orders with no border or wording as normal', () => {
    expect(getEtsyItemCustomisation(item('No', 'No Customisation')).orderType).toBe('Normal');
    expect(getEtsyItemCustomisation(item('No', '')).orderType).toBe('Normal');
    expect(getEtsyItemCustomisation(item('No', 'Nunito')).orderType).toBe('Normal');
  });
  it('treats a border alone as customised without requiring a font', () => {
    expect(getEtsyItemCustomisation(item('Yes', 'No Customisation'))).toMatchObject({ border: true, orderType: 'Customised', error: null });
  });
  it.each([['Oliver', ''], ['', 'Bedroom'], ['Oliver', 'Bedroom']])('accepts wording with a valid font', (top, bottom) => {
    expect(getEtsyItemCustomisation(item('No', 'Patrick Hand', top, bottom))).toMatchObject({ orderType: 'Customised', fontId: 'patrick-hand-regular', error: null });
  });
  it.each(['', 'No Customisation', 'Unknown font'])('blocks wording with an absent, unsupported or no-customisation font: %s', (font) => {
    const result = getEtsyItemCustomisation(item('Yes', font, 'Oliver'));
    expect(result.orderType).toBe('In Error');
    expect(result.error).toContain('Message the buyer on Etsy');
  });
  it('blocks a receipt if any item is in error', () => {
    expect(getEtsyOrderType([{ orderType: 'Normal' }, { orderType: 'Customised' }, { orderType: 'In Error' }])).toBe('In Error');
  });
});
