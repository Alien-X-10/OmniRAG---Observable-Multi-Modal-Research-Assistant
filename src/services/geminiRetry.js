// File: src/services/geminiRetry.js

/**
 * Detects temporary Gemini API high-demand / 503 availability spikes.
 */
export function isRetryable503(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('high demand') ||
    msg.toLowerCase().includes('overloaded')
  );
}

/**
 * Detects errors indicating the selected model is unavailable or overloaded,
 * allowing fallback to the next model in the configured priority chain.
 */
export function isModelUnavailableError(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return (
    isRetryable503(err) ||
    status === 404 ||
    msg.includes('NOT_FOUND') ||
    msg.toLowerCase().includes('no longer available')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a single-model Gemini operation (such as embeddings) on transient 503 spikes.
 */
export async function retryOn503(label, fn, maxRetries = 2, baseDelayMs = 800) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable503(err) || attempt >= maxRetries) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** attempt;
      console.warn(
        `[${label}] Returned 503 high demand; retrying (${attempt + 1}/${maxRetries}) in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/**
 * Executes an operation across an ordered model list (e.g., 3.5 -> 3.1 -> 2.5).
 * Tries each primary/intermediate model once before falling back, and retries the
 * final fallback model with exponential backoff if it hits transient 503 spikes.
 */
export async function runWithModelFallback({
  label,
  models,
  attemptFn,
  fallbackDelayMs = 400,
  finalModelRetries = 2,
  finalModelBaseDelayMs = 1000,
}) {
  let lastErr;

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    const isFinalModel = i === models.length - 1;
    const maxAttemptsForModel = isFinalModel ? 1 + finalModelRetries : 1;

    for (let attempt = 0; attempt < maxAttemptsForModel; attempt++) {
      try {
        return await attemptFn(modelName);
      } catch (err) {
        lastErr = err;

        if (!isFinalModel) {
          if (!isModelUnavailableError(err)) {
            throw err;
          }
          console.warn(
            `[${label}] ${modelName} unavailable (${err?.status ?? '503'}); falling back to ${models[i + 1]}...`
          );
          await sleep(fallbackDelayMs);
          break;
        }

        if (!isRetryable503(err) || attempt >= maxAttemptsForModel - 1) {
          throw err;
        }
        const delayMs = finalModelBaseDelayMs * 2 ** attempt;
        console.warn(
          `[${label}] Final fallback ${modelName} returned 503; retrying (${attempt + 1}/${finalModelRetries}) in ${delayMs}ms...`
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastErr;
}
