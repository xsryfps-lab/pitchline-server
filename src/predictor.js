// AI Activation Controller
// Decides IF a prediction should be (re)generated, then produces one.
//
// Model 1 (statistical) runs locally for free — no API call, no tokens spent.
// It's what powers every prediction by default.
//
// Model 2/3 (tactical + ML) and the Master AI explanation are meant to call
// an LLM (Claude), but ONLY inside the windows below, and only once per
// trigger — never on a timer. Wire ANTHROPIC_API_KEY in .env to turn this on;
// until then generateReasoning() falls back to a template string so the app
// still works end to end.

import { sql } from "./db.js";

const HOURS = 60 * 60 * 1000;

export function predictionWindow(kickoff, status) {
  if (status === "live" || status === "half_time") return "live";
  const msToKickoff = new Date(kickoff).getTime() - Date.now();
  if (msToKickoff > 24 * HOURS) return "none";       // fixture only, no AI spend
  if (msToKickoff > 3 * HOURS) return "basic";        // 3-24h: winner/goals/BTTS
  return "full";                                      // 0-3h: everything
}

// Returns true only when something has actually changed enough to justify
// a new AI call — this is the token-saving gate from the spec.
export async function shouldRegenerate(matchId, window, changeSignal) {
  if (window === "none") return false;
  const [last] = await sql`
    select generated_at, trigger from predictions
    where match_id = ${matchId}
    order by generated_at desc limit 1
  `;
  if (!last) return true;
  if (window === "live") return changeSignal === "goal" || changeSignal === "red_card" ||
    changeSignal === "penalty" || changeSignal === "half_time" || changeSignal === "major_momentum";
  const hoursSinceLast = (Date.now() - new Date(last.generated_at).getTime()) / HOURS;
  if (window === "full" && last.trigger !== "pre_3h") return true;
  if (window === "basic" && hoursSinceLast > 6) return true;
  return false;
}

// Model 1 — statistical baseline. Pure arithmetic, zero AI tokens.
export function statisticalModel({ homeForm, awayForm, homePoints, awayPoints, homeAdvantage = 0.08 }) {
  const formScore = (form) => form.reduce((a, r) => a + (r === "W" ? 3 : r === "D" ? 1 : 0), 0) / (form.length * 3);
  const homeStrength = (formScore(homeForm) * 0.6 + normalizePoints(homePoints) * 0.4) + homeAdvantage;
  const awayStrength = (formScore(awayForm) * 0.6 + normalizePoints(awayPoints) * 0.4);
  const total = homeStrength + awayStrength + 0.22; // draw baseline
  const homeWin = Math.round((homeStrength / total) * 100);
  const awayWin = Math.round((awayStrength / total) * 100);
  const draw = 100 - homeWin - awayWin;
  const spread = Math.max(homeWin, draw, awayWin) - 33;
  const confidence = Math.min(96, Math.max(35, Math.round(50 + spread * 1.3)));
  return { homeWin, draw, awayWin, confidence };
}
function normalizePoints(pts) { return Math.min(1, Math.max(0, pts / 40)); }

export function deriveMarkets({ homeWin, awayWin }) {
  const goalTendency = (homeWin + awayWin) / 100; // higher when match is lopsided -> fewer draws, more goals typically
  const btts = Math.round(45 + (50 - Math.abs(homeWin - awayWin)) * 0.4);
  const over25 = Math.round(48 + goalTendency * 20);
  const cornersOver = Math.round(45 + goalTendency * 18);
  return {
    btts: { yes: clamp(btts), no: clamp(100 - btts) },
    over25: { over: clamp(over25), under: clamp(100 - over25) },
    corners: { line: "9.5", over: clamp(cornersOver), under: clamp(100 - cornersOver) },
  };
}
function clamp(n) { return Math.min(92, Math.max(8, n)); }

export function correctScoreDistribution({ homeWin, awayWin, draw }) {
  // Rough Poisson-flavoured spread, not a full simulation — good enough
  // for a UI placeholder until the ML model (Part 3) is trained.
  const favoured = homeWin >= awayWin;
  const base = favoured
    ? [["2-1", 0.17], ["1-0", 0.13], ["2-0", 0.12], ["1-1", 0.11]]
    : [["1-2", 0.17], ["0-1", 0.13], ["0-2", 0.12], ["1-1", 0.11]];
  const scale = Math.max(homeWin, awayWin) / 55;
  return base.map(([s, p]) => ({ score: s, pct: Math.round(p * 100 * scale) }));
}

export async function generateReasoning({ homeName, awayName, homeWin, draw, awayWin }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const fav = homeWin >= awayWin ? homeName : awayName;
    const pct = Math.max(homeWin, awayWin);
    return `${fav} are favoured at ${pct}% based on current form and points. Draw probability sits at ${draw}%.`;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `In one factual sentence (no hedging filler like "could go either way"), explain why ${homeName} vs ${awayName} has these win probabilities: ${homeName} ${homeWin}%, draw ${draw}%, ${awayName} ${awayWin}%. Base it only on form and points, since that's all the data you have.`,
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || `${homeName} ${homeWin}% / Draw ${draw}% / ${awayName} ${awayWin}%.`;
}
