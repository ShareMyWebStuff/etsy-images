export const GENERATED_ETSY_TAG_RULES = `TAG LENGTH CHECK (MANDATORY)
Each Etsy tag must contain at most 20 characters, counting every letter, number, space and punctuation mark. Check each tag before returning it.
If a subject name or search phrase is too long, rewrite it as a shorter relevant phrase or cover it with separate distinct tags. Do not copy a long subject name into a tag unchanged, and do not cut words in half.
For example, "blue morpho butterfly" has 21 characters and is invalid. Use shorter phrases such as "blue morpho" and "butterfly art" instead.
Return only distinct tags that pass this check.`;

export class GeneratedEtsyTagLengthError extends Error {
  constructor(readonly tags: string[]) {
    const tag = tags[0];
    super(`The Etsy tag "${tag}" is longer than 20 characters (${Array.from(tag).length}, including spaces).`);
    this.name = 'GeneratedEtsyTagLengthError';
  }
}

export function validateGeneratedEtsyTagLengths(tags: string[]) {
  const longTags = tags.filter((tag) => Array.from(tag).length > 20);
  if (longTags.length > 0) throw new GeneratedEtsyTagLengthError(longTags);
}

/** Retry a tag-length failure once, before any generated details are saved. */
export async function generateValidatedListingResponse<T>(
  prompt: string,
  sendPrompt: (prompt: string) => Promise<string>,
  parseResponse: (response: string) => T,
): Promise<T> {
  const response = await sendPrompt(prompt);
  try {
    return parseResponse(response);
  } catch (error) {
    if (!(error instanceof GeneratedEtsyTagLengthError)) throw error;
    const correction = `Your previous response failed the application's Etsy tag validation:
${error.tags.map((tag) => `${JSON.stringify(tag)}: ${Array.from(tag).length} characters`).join('\n')}
Generate the complete listing response again using the required output markers and JSON structure. Rewrite these overlong phrases as shorter relevant tags. Keep every tag at 20 characters or fewer, including spaces. Check the count of every tag before returning your response.`;
    const corrected = await sendPrompt(`${prompt}\n\nTAG VALIDATION CORRECTION\n${correction}`);
    return parseResponse(corrected);
  }
}
