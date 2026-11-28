// One place for every Gemini call (receipts, emailed receipts, sorting, product photos).
// Google sometimes answers "model is experiencing high demand" (500/503) or "too many requests" (429).
// Those usually pass within seconds, so each call retries with a growing wait and, if the main
// model stays busy, tries a second current Flash model before showing an error.
import { GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from './config.js';

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const BUSY_TEXT = /high demand|overloaded|unavailable|resource.?exhausted|try again later|rate limit|too many requests|deadline|internal error/i;

export function errorStatus(e) {
  const s = Number(e?.customErrorData?.status);
  if (s) return s;
  const m = String(e?.message || '').match(/\[(\d{3})\b/);
  return m ? Number(m[1]) : 0;
}

/** True for errors worth trying again: Google busy, rate limited, or a dropped connection. */
export function isRetryable(e) {
  const status = errorStatus(e);
  if (RETRY_STATUSES.has(status)) return true;
  if (status) return false;
  return BUSY_TEXT.test(String(e?.message || '')) || /failed to fetch|network/i.test(String(e?.message || ''));
}

/** True when the model itself can't be used (retired or not found), so the backup model should be tried. */
export function isModelMissing(e) {
  return errorStatus(e) === 404 || /model.*(not found|no longer available|not supported)/i.test(String(e?.message || ''));
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Runs call(modelName) with retries. The main model gets `tries` attempts with growing waits
 * (about 1s, then 2.5s); then the backup model gets `backupTries` attempts.
 * Errors that a retry can't fix (a bad photo, App Check, permissions) are thrown at once.
 */
export async function withRetry(call, {
  models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL], tries = 3, backupTries = 2, baseMs = 1000, sleep = wait, onRetry,
} = {}) {
  const list = [...new Set(models.filter(Boolean))];
  let lastErr;
  for (let m = 0; m < list.length; m++) {
    const attempts = m === 0 ? tries : backupTries;
    for (let a = 0; a < attempts; a++) {
      try {
        return await call(list[m]);
      } catch (e) {
        lastErr = e;
        if (isModelMissing(e)) break; // straight to the backup model
        if (!isRetryable(e)) throw e;
        const more = a < attempts - 1 || m < list.length - 1;
        if (!more) break;
        if (onRetry) onRetry({ model: list[m], attempt: a + 1, error: e });
        // Waits grow 1x, 2.5x, 6x; a little randomness keeps several devices from retrying in step.
        if (a < attempts - 1) await sleep(Math.round(baseMs * (2.5 ** a) * (0.8 + Math.random() * 0.4)));
      }
    }
  }
  throw lastErr;
}

/** Asks Gemini for JSON that fits `schema`, with retries and the backup model. Returns the parsed object. */
export async function generateJSON(app, { schema, temperature = 0 }, parts) {
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return withRetry(async (modelName) => {
    const model = getGenerativeModel(ai, {
      model: modelName,
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    });
    const result = await model.generateContent(parts);
    return JSON.parse(result.response.text());
  });
}
