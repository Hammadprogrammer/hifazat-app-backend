const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE ?? '+92').replace(/[^\d+]/g, '');

/**
 * Normalize any user-entered phone to E.164 (+923001234567).
 * - strips spaces, dashes, dots, parentheses
 * - "00xx" -> "+xx"
 * - leading "0" -> DEFAULT_COUNTRY_CODE
 * - bare digits without "+" -> prefixed with "+"
 */
export function normalizePhone(raw: string): string {
  let p = (raw ?? '').trim().replace(/[\s\-().]/g, '');
  if (!p) return p;
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = DEFAULT_COUNTRY_CODE + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/** WhatsApp Cloud API expects digits only, no "+" */
export function toWhatsAppNumber(phone: string): string {
  return normalizePhone(phone).replace(/^\+/, '');
}
