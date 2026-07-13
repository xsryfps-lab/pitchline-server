// Adapter around OpenLigaDB — a free, keyless, crowd-run German football API
// that's been stable for years (api.openligadb.de). No signup, no key, no
// suspension risk, 1000 requests/hour. The tradeoff: reliable coverage is
// German football only (Bundesliga, 2. Bundesliga, DFB-Pokal). Broader
// leagues (Premier League, La Liga, etc.) need a paid-tier key from a
// provider like api-football or football-data.org — swap it in here later,
// this is the only file that needs to change.

const BASE_URL = "https://api.openligadb.de";

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`OpenLigaDB ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Internal league id -> OpenLigaDB league shortcut.
export const PROVIDER_LEAGUE_ID = {
  bund: "bl1",
  bund2: "bl2",
  dfbpokal: "dfb",
};

function currentSeason() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() + 1 >= 7 ? y : y - 1; // German season runs roughly July/Aug -> May
}

// No live-in-play feed on this provider — returns [] so the app shows
// "nothing live" honestly rather than faking it.
export async function fetchLiveFixtures() {
  return [];
}

// Returns every match (upcoming + finished) for the given league's current
// season in one call, which we then split by matchIsFinished.
export async function fetchSeasonMatches(leagueId, season = currentSeason()) {
  const matches = await apiGet(`/getmatchdata/${PROVIDER_LEAGUE_ID[leagueId]}/${season}`);
  return (matches || []).map((m) => normalizeMatch(m, leagueId));
}

export async function fetchStandings(leagueId, season = currentSeason()) {
  return apiGet(`/getbltable/${PROVIDER_LEAGUE_ID[leagueId]}/${season}`);
}

function normalizeMatch(m, leagueId) {
  const finalResult = m.matchResults?.find((r) => r.resultTypeID === 2) || m.matchResults?.[m.matchResults.length - 1];
  return {
    id: String(m.matchID),
    league_id: leagueId,
    home_team_id: `${leagueId}-${m.team1.teamId}`,
    away_team_id: `${leagueId}-${m.team2.teamId}`,
    home_team_name: m.team1.shortName || m.team1.teamName,
    away_team_name: m.team2.shortName || m.team2.teamName,
    status: m.matchIsFinished ? "finished" : "upcoming",
    kickoff: m.matchDateTimeUTC,
    minute: null,
    home_score: m.matchIsFinished && finalResult ? finalResult.pointsTeam1 : null,
    away_score: m.matchIsFinished && finalResult ? finalResult.pointsTeam2 : null,
    venue: m.location?.locationStadium,
    referee: null,
  };
}

export { currentSeason };
