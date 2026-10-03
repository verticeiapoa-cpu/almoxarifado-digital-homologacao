type ErrorLike = { code?: unknown };

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Production-safe diagnostics. Deliberately excludes the original error
 * object so CPF, signatures, Firestore documents and request payloads cannot
 * be accidentally written to the browser console.
 */
export function logError(event: string, error?: unknown) {
  if (!import.meta.env.DEV) return;
  console.error(`[${event}]`, getErrorCode(error) || 'unknown-error');
}

export function logWarning(event: string, error?: unknown) {
  if (!import.meta.env.DEV) return;
  console.warn(`[${event}]`, getErrorCode(error) || 'unknown-warning');
}
