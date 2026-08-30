/**
 * Comparing a secret without saying how nearly right a guess was.
 *
 * A normal string comparison stops at the first character that differs, so it
 * takes measurably longer the more of a token is correct. That turns guessing a
 * secret from an impossible search into a character-at-a-time one.
 *
 * It lives here rather than beside the webhook verifiers because it is not
 * about webhooks: API tokens, upload references and shared secrets all need it,
 * and none of them should have to reach into a channel to find it.
 */
export function safeEqual(a: string, b: string): boolean {
  // Length is the one thing this cannot hide, and it is not worth hiding: two
  // secrets of different lengths are different secrets.
  if (a.length !== b.length) return false

  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}
