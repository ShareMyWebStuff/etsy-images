export const PINTEREST_DESCRIPTION_MAX_LENGTH = 500;

export function pinDescriptionLength(value: string) {
  return Array.from(value).length;
}

/** Validate the submitted text before trimming so saved legacy text is safe to publish unchanged. */
export function validatePinDescription(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a Pinterest description as text.');
  const description = value.trim();
  if (!description) throw new Error('Enter a Pinterest description.');
  if (pinDescriptionLength(value) > PINTEREST_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Pinterest descriptions must be ${PINTEREST_DESCRIPTION_MAX_LENGTH} characters or fewer.`);
  }
  return description;
}
