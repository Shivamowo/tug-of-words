// Thin Jev gateway: one call per message, all questions fanned out in parallel.
const KEY = process.env.TYPESAFE_API_KEY || "";
const BASE = (process.env.JEV_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "");
const MODEL = process.env.JEV_MODEL || "jev-latest";
const TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 6000);

export const jevStatus = { live: !!KEY, lastError: null, calls: 0, fails: 0, lastMs: 0 };

const QUALITY_LEVELS = [
  "Useless: ignores the prompt or says nothing",
  "Weak: barely tries, generic",
  "Okay: a reasonable attempt",
  "Good: persuasive, clever or vivid",
  "Brilliant: would absolutely work, hilarious or genius"
];

export function buildQuestions({ hasOpponent, ruleJev }) {
  const q = {
    quality: {
      type: "score",
      instructions: "How well does `message` accomplish the task in `prompt`? Judge it as a move in a party game.",
      criteria: QUALITY_LEVELS
    },
    funny: { type: "noul", instructions: "Is `message` funny, witty or absurd in a way that would make friends laugh?" },
    spam: {
      type: "noul",
      instructions: "Is `message` low-effort spam: keyboard mashing, gibberish, a single filler word, or nearly the same as one of `my_recent`?"
    },
    offtopic: { type: "noul", instructions: "Is `message` completely unrelated to `prompt` (not even trash talk about the game)?" }
  };
  if (hasOpponent) {
    q.counter = {
      type: "noul",
      instructions: "Does `message` directly respond to, counter, or one-up `opponent_last`?"
    };
  }
  if (ruleJev) q.rule = { type: "noul", instructions: ruleJev };
  return q;
}

async function post(body, signal) {
  const res = await fetch(`${BASE}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`Jev ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Returns normalized { quality 0..1, funny, spam, offtopic, counter?, rule?, source }
export async function judge(state, flags) {
  const questions = buildQuestions(flags);
  if (!KEY) return { ...mockJudge(state, flags), source: "mock" };
  const t0 = Date.now();
  jevStatus.calls++;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const data = await post({ model: MODEL, state, questions }, ctrl.signal);
      clearTimeout(timer);
      jevStatus.lastMs = Date.now() - t0;
      jevStatus.live = true;
      jevStatus.lastError = null;
      return normalize(data.answers || {}, questions.quality.criteria.length);
    } catch (e) {
      clearTimeout(timer);
      const retryable = e.name === "AbortError" || e.status === 429 || e.status === 529 || e.status >= 500;
      if (attempt === 0 && retryable) { await new Promise(r => setTimeout(r, 250 + Math.random() * 250)); continue; }
      jevStatus.fails++;
      jevStatus.lastError = e.message;
      console.error("[jev]", e.message);
      return { ...mockJudge(state, flags), source: "fallback" };
    }
  }
}

function normalize(a, levels) {
  const n = k => (a[k] && typeof a[k].noul === "number" ? a[k].noul : null);
  const qs = a.quality && typeof a.quality.score === "number" ? a.quality.score : 1;
  return {
    quality: Math.max(0, Math.min(1, qs / (levels - 1))),
    qualityRaw: qs,
    qualityConf: a.quality?.confidence ?? null,
    funny: n("funny") ?? 0,
    spam: n("spam") ?? 0,
    offtopic: n("offtopic") ?? 0,
    counter: n("counter"),
    rule: n("rule"),
    source: "jev"
  };
}

// Offline heuristic so the game is playable without a key / during outages.
export function mockJudge(state, flags) {
  const msg = String(state.message || "");
  const words = msg.toLowerCase().match(/[a-z']+/g) || [];
  const uniq = new Set(msg.toLowerCase().replace(/\s/g, "")).size;
  const promptWords = new Set((String(state.prompt).toLowerCase().match(/[a-z]{4,}/g) || []));
  const overlap = words.filter(w => promptWords.has(w)).length;
  const spam = words.length < 2 || uniq < 5 ? 0.85 : (state.my_recent || []).includes(msg) ? 0.9 : 0.08;
  const quality = Math.min(1, 0.15 + Math.min(words.length, 14) / 20 + overlap * 0.12 + Math.random() * 0.2);
  return {
    quality, qualityRaw: quality * 4, qualityConf: null,
    funny: /lol|lmao|bro|💀|😂|!|\?/.test(msg) ? 0.5 + Math.random() * 0.45 : Math.random() * 0.6,
    spam,
    offtopic: overlap === 0 && words.length > 3 ? 0.35 : 0.1,
    counter: flags.hasOpponent ? Math.random() * 0.9 : null,
    rule: flags.ruleJev ? Math.random() : null
  };
}
