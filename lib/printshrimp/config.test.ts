import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PRINTSHRIMP_RETURN_EMAIL,
  getPrintShrimpReturnEmail,
} from '@/lib/printshrimp/config';

describe('PrintShrimp return email', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the owner email address', () => {
    vi.stubEnv('PRINTSHRIMP_RETURN_EMAIL', '');
    expect(getPrintShrimpReturnEmail()).toBe(DEFAULT_PRINTSHRIMP_RETURN_EMAIL);
  });

  it('uses a configured return email address', () => {
    vi.stubEnv('PRINTSHRIMP_RETURN_EMAIL', ' owner@example.com ');
    expect(getPrintShrimpReturnEmail()).toBe('owner@example.com');
  });

  it('rejects an invalid configured email address', () => {
    vi.stubEnv('PRINTSHRIMP_RETURN_EMAIL', 'not-an-email');
    expect(() => getPrintShrimpReturnEmail()).toThrow('PRINTSHRIMP_RETURN_EMAIL must be a valid email address.');
  });
});
