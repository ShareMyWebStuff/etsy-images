import { describe, expect, it } from 'vitest';

import { validateOurCategoryTemplateOrder } from '@/lib/our-category-template-order';

describe('Our Category image-template ordering', () => {
  it('accepts every template exactly once in the requested order', () => {
    expect(validateOurCategoryTemplateOrder(['8', '2', '5'], [2, 5, 8])).toEqual([8, 2, 5]);
  });

  it('rejects missing or duplicate templates', () => {
    expect(() => validateOurCategoryTemplateOrder(['2', '2'], [2, 5])).toThrow(
      'The image-template order must contain every template exactly once.',
    );
  });

  it('rejects templates belonging to another category', () => {
    expect(() => validateOurCategoryTemplateOrder(['2', '9'], [2, 5])).toThrow(
      'The image-template order contains a template from another category.',
    );
  });
});
