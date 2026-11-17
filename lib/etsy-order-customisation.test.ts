import { describe, expect, it } from 'vitest';
import { getEtsyItemCustomisation, getEtsyOrderType } from './etsy-order-customisation';

function item(border: string, font: string | null, topText = '', bottomText = '', fontQuestion = 'Font Style') {
  return { topText, bottomText, rawJson: { variations: [
    { formatted_name: 'Border', formatted_value: border },
    ...(font === null ? [] : [{ formatted_name: fontQuestion, formatted_value: font }]),
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
  it.each([
    { font: null, top: 'Oliver', bottom: '' },
    { font: '', top: '', bottom: 'Bedroom' },
    { font: '  ', top: 'Oliver', bottom: 'Bedroom' },
  ])('defaults missing or blank fonts to Nunito for wording: $font', ({ font, top, bottom }) => {
    expect(getEtsyItemCustomisation(item('No', font, top, bottom))).toMatchObject({
      orderType: 'Customised', fontStyle: 'Nunito', fontId: 'nunito-semibold', error: null,
    });
  });
  it.each(['Font', 'Font Style', 'Font Style (default: Nunito)'])('recognises the selected font under %s', (fontQuestion) => {
    expect(getEtsyItemCustomisation(item('No', 'Caveat', 'Oliver', '', fontQuestion))).toMatchObject({
      orderType: 'Customised', fontStyle: 'Caveat', fontId: 'caveat-bold', error: null,
    });
  });
  it.each(['No Customisation', 'None', 'Unknown font'])('blocks wording with an unsupported or explicit no-customisation font: %s', (font) => {
    const result = getEtsyItemCustomisation(item('Yes', font, 'Oliver'));
    expect(result.orderType).toBe('In Error');
    expect(result.error).toContain('Message the buyer on Etsy');
  });
  it.each([null, '', 'Nunito', 'Fredoka', 'Unknown font'])('keeps blank wording normal regardless of the selected font: %s', (font) => {
    expect(getEtsyItemCustomisation(item('No', font, '  ', '\n'))).toMatchObject({ orderType: 'Normal', error: null });
  });
  it('blocks a receipt if any item is in error', () => {
    expect(getEtsyOrderType([{ orderType: 'Normal' }, { orderType: 'Customised' }, { orderType: 'In Error' }])).toBe('In Error');
  });
});
