// A tiny client for TypeSafe's System One API. No dependencies: Node 20+ has fetch.
//
// One call carries every question we have about an issue. That is the whole cost
// story — triaging an issue is a single request, not one per question.

const ENDPOINT = process.env.HUSH_ENDPOINT || "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.HUSH_MODEL || "jev-latest";

export class JevError extends Error {}

/**
 * @param {string} apiKey
 * @param {string} state      what the model is judging
 * @param {object} questions  the typed questions, keyed by name
 * @param {{retries?: number, timeoutMs?: number, fetchImpl?: Function}} [opts]
 */
export async function ask(apiKey, state, questions, opts = {}) {
  const { retries = 2, timeoutMs = 20000, fetchImpl = fetch } = opts;
  const body = JSON.stringify({ model: MODEL, state, questions });

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // 4xx other than 429 will not get better by trying again.
        if (res.status !== 429 && res.status < 500) {
          throw new JevError(`TypeSafe API ${res.status}: ${text.slice(0, 300)}`);
        }
        throw new Error(`retryable ${res.status}`);
      }
      const json = JSON.parse(text);
      return { answers: json.answers ?? {}, usage: json.usage ?? {}, model: json.model, ms: Date.now() - started };
    } catch (err) {
      lastErr = err;
      if (err instanceof JevError) throw err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new JevError(`TypeSafe API unreachable after ${retries + 1} attempts: ${lastErr?.message}`);
}

/** A yes/no question. The answer is the probability that the answer is yes. */
export const noul = (instructions, criteria) => ({ type: "noul", instructions, ...(criteria ? { criteria } : {}) });

/** Pick one of `criteria`'s keys. The answer carries a probability per option and a confidence. */
export const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
