/** Central product name for logs, email subjects, and operator-facing strings. */
export const APP_NAME = 'Tehsil.ai' as const;

/** Prefix notification / outbox email subjects with the product name. */
export function appEmailSubject(subject: string): string {
  return `${APP_NAME} — ${subject}`;
}
