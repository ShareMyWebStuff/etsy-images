export const DEFAULT_PRINTSHRIMP_RETURN_EMAIL = 'dave@harmonydata.co.uk';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getPrintShrimpReturnEmail() {
  const email = process.env.PRINTSHRIMP_RETURN_EMAIL?.trim() || DEFAULT_PRINTSHRIMP_RETURN_EMAIL;
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('PRINTSHRIMP_RETURN_EMAIL must be a valid email address.');
  }
  return email;
}
