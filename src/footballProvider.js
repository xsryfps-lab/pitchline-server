// Adapter around TheSportsDB — chosen specifically because it needs ZERO
// signup: the free key below is TheSportsDB's public test key, published on
// their own docs (thesportsdb.com/documentation). Nothing to register, so
// nothing to get suspended or fail to sign up for.
//
// Tradeoff: the free tier doesn't include true minute-by-minute live scores
// (that's a Patreon-only feature) — upcoming fixtures, results and league
// tables all work fine though, which covers most of the app. If you want
// real live-in-play data later, a Patreon key (thesportsdb.com/patreon)
// unlocks it and only this file needs to change.

const FREE_KEY = process.env.FOOTBALL_API_KEY || "123";
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${FREE_KEY}`;

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TheSportsDB ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Internal league id -> TheSportsDB numeric league id.
export const PROVIDER_LEAGUE_ID = {
  epl: 4328,
  champ: 4329,
  laliga: 4335,
  bund: 4331,
  seriea: 4332,
  ligue1: 4334,
  eredivisie: 4337,
  brasileirao: 4351,
  mls: 4346,
  ucl: 4480,
};

function currentSeasonLabel(leagueId) {
  const now = new Date();
  if (leagueId === "mls" || leagueId === "brasileirao") return String(now.getFullYear());
  const y = now.getFullYear();
  return now.getMonth() + 1 >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// No true live-in-play feed on the free tier — returns [] so the app just
// shows "nothing live" honestly instead of faking it.
export async function fetchLiveFixtures() {
  return [];
}

export async function fetchUpcoming(leagueId) {
  const data = await apiGet("/eventsnextleague.php", { id: PROVIDER_LEAGUE_ID[leagueId] });
  return (data.events || []).map((e) => normalizeEvent(e, leagueId));
}

export async function fetchRecentResults(leagueId) {
  const data = await apiGet("/eventspastleague.php", { id: PROVIDER_LEAGUE_ID[leagueId] });
  return (data.events || []).map((e) => normalizeEvent(e, leagueId));
}

export async function fetchStandings(leagueId) {
  const data = await apiGet("/lookuptable.php", { l: PROVIDER_LEAGUE_ID[leagueId], s: currentSeasonLabel(leagueId) });
  return data.table || [];
}

function normalizeEvent(e, leagueId) {
  const hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined;
  const kickoff = e.strTimestamp ? new Date(e.strTimestamp) : new Date(`${e.dateEvent}T${e.strTime || "00:00:00"}Z`);
  return {
    id: String(e.idEvent),
    league_id: leagueId,
    home_team_id: `${leagueId}-${e.idHomeTeam}`,
    away_team_id: `${leagueId}-${e.idAwayTeam}`,
    home_team_name: e.strHomeTeam,
    away_team_name: e.strAwayTeam,
    status: hasScore ? "finished" : "upcoming",
    kickoff: kickoff.toISOString(),
    minute: null,
    home_score: hasScore ? Number(e.intHomeScore) : null,
    away_score: hasScore ? Number(e.intAwayScore) : null,
    venue: e.strVenue,
    referee: null,
  };
}
