// Adapter around your football data API. Written for API-Football
// (api-football.com / RapidAPI), since it's the cheapest full-coverage
// option, but every function here is isolated on purpose — if you go with
// SportMonks or Sportradar instead, this is the only file you touch.
//
// Set FOOTBALL_API_KEY and FOOTBALL_API_HOST in .env

const BASE_URL = `https://${process.env.FOOTBALL_API_HOST || "v3.football.api-sports.io"}`;

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      "x-apisports-key": process.env.FOOTBALL_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`Football API ${path} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.response;
}

// Map your internal league ids to the provider's numeric league ids.
// Verify these against your provider's /leagues endpoint before relying on them —
// IDs occasionally shift between providers/plans.
export const PROVIDER_LEAGUE_ID = {
  epl: 39,
  champ: 40,
  laliga: 140,
  bund: 78,
  seriea: 135,
  ligue1: 61,
  eredivisie: 88,
  mls: 253,
  brasileirao: 71,
  ucl: 2,
  uel: 3,
};

export async function fetchLiveFixtures() {
  return apiGet("/fixtures", { live: "all" });
}

export async function fetchFixturesInRange(leagueProviderId, fromISODate, toISODate, season) {
  return apiGet("/fixtures", {
    league: leagueProviderId,
    from: fromISODate,
    to: toISODate,
    season,
  });
}

export async function fetchStandings(leagueProviderId, season) {
  return apiGet("/standings", { league: leagueProviderId, season });
}

export async function fetchFixtureStats(fixtureProviderId) {
  return apiGet("/fixtures/statistics", { fixture: fixtureProviderId });
}

export async function fetchFixtureEvents(fixtureProviderId) {
  return apiGet("/fixtures/events", { fixture: fixtureProviderId });
}

// Normalizes a provider fixture object into our internal shape so the rest
// of the app never has to know which provider we're on.
export function normalizeFixture(f, leagueId) {
  const statusMap = {
    NS: "upcoming", TBD: "upcoming", PST: "postponed",
    "1H": "live", "2H": "live", ET: "live", P: "live", BT: "live",
    HT: "half_time",
    FT: "finished", AET: "finished", PEN: "finished",
  };
  return {
    id: String(f.fixture.id),
    league_id: leagueId,
    home_team_id: `${leagueId}-${f.teams.home.id}`,
    away_team_id: `${leagueId}-${f.teams.away.id}`,
    home_team_name: f.teams.home.name,
    away_team_name: f.teams.away.name,
    status: statusMap[f.fixture.status.short] || "upcoming",
    kickoff: f.fixture.date,
    minute: f.fixture.status.elapsed,
    home_score: f.goals.home,
    away_score: f.goals.away,
    venue: f.fixture.venue?.name,
    referee: f.fixture.referee,
  };
}
