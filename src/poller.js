import cron from "node-cron";
import { sql } from "./db.js";
import { PROVIDER_LEAGUE_ID, fetchLiveFixtures, fetchFixturesInRange, fetchStandings, normalizeFixture } from "./footballProvider.js";
import { predictionWindow, shouldRegenerate, statisticalModel, deriveMarkets, correctScoreDistribution, generateReasoning } from "./predictor.js";

const TRACKED_LEAGUES = Object.keys(PROVIDER_LEAGUE_ID); // trim this list to what you actually pay for

async function upsertTeam(id, leagueId, name) {
  await sql`
    insert into teams (id, league_id, name, short_name)
    values (${id}, ${leagueId}, ${name}, ${name})
    on conflict (id) do update set name = excluded.name
  `;
}

async function upsertMatch(f) {
  await upsertTeam(f.home_team_id, f.league_id, f.home_team_name);
  await upsertTeam(f.away_team_id, f.league_id, f.away_team_name);
  await sql`
    insert into matches (id, league_id, home_team_id, away_team_id, status, kickoff, minute, home_score, away_score, venue, referee, last_polled_at)
    values (${f.id}, ${f.league_id}, ${f.home_team_id}, ${f.away_team_id}, ${f.status}, ${f.kickoff}, ${f.minute}, ${f.home_score}, ${f.away_score}, ${f.venue}, ${f.referee}, now())
    on conflict (id) do update set
      status = excluded.status, minute = excluded.minute,
      home_score = excluded.home_score, away_score = excluded.away_score,
      last_polled_at = now(), updated_at = now()
  `;
}

async function maybePredict(match) {
  const window = predictionWindow(match.kickoff, match.status);
  // Detect a goal since the last poll as the live-update trigger.
  const [prevRow] = await sql`select home_score, away_score from matches where id = ${match.id}`;
  const goalHappened = prevRow && (prevRow.home_score !== match.home_score || prevRow.away_score !== match.away_score);
  const signal = goalHappened ? "goal" : match.status === "half_time" ? "half_time" : null;

  if (!(await shouldRegenerate(match.id, window, signal))) return;

  const [homeStats] = await sql`select points from standings where team_id = ${match.home_team_id} limit 1`;
  const [awayStats] = await sql`select points from standings where team_id = ${match.away_team_id} limit 1`;
  const { homeWin, draw, awayWin, confidence } = statisticalModel({
    homeForm: ["W", "D", "W", "L", "W"], // TODO: pull last-5 results once /fixtures/headtohead or team-form endpoint is wired
    awayForm: ["W", "W", "D", "L", "D"],
    homePoints: homeStats?.points || 20,
    awayPoints: awayStats?.points || 20,
  });
  const markets = deriveMarkets({ homeWin, awayWin });
  const scores = correctScoreDistribution({ homeWin, awayWin, draw });
  const reasoning = await generateReasoning({ homeName: match.home_team_id, awayName: match.away_team_id, homeWin, draw, awayWin });

  await sql`
    insert into predictions (match_id, trigger, home_win_pct, draw_pct, away_win_pct, btts_yes_pct, over25_pct, corners_line, corners_over_pct, correct_scores, confidence, data_quality, reasoning)
    values (${match.id}, ${window === "live" ? "live_event" : window === "full" ? "pre_3h" : "pre_24h"}, ${homeWin}, ${draw}, ${awayWin}, ${markets.btts.yes}, ${markets.over25.over}, ${markets.corners.line}, ${markets.corners.over}, ${JSON.stringify(scores)}, ${confidence}, 85, ${reasoning})
  `;
}

async function pollLive() {
  const fixtures = await fetchLiveFixtures();
  for (const f of fixtures) {
    const leagueId = Object.keys(PROVIDER_LEAGUE_ID).find((k) => PROVIDER_LEAGUE_ID[k] === f.league.id);
    if (!leagueId) continue;
    const normalized = normalizeFixture(f, leagueId);
    await upsertMatch(normalized);
    await maybePredict(normalized);
  }
}

async function pollUpcoming() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  for (const leagueId of TRACKED_LEAGUES) {
    try {
      const fixtures = await fetchFixturesInRange(PROVIDER_LEAGUE_ID[leagueId], from, to, new Date().getFullYear());
      for (const f of fixtures) {
        const normalized = normalizeFixture(f, leagueId);
        await upsertMatch(normalized);
        await maybePredict(normalized);
      }
    } catch (e) {
      console.error(`pollUpcoming(${leagueId}) failed:`, e.message);
    }
  }
}

async function pollStandings() {
  for (const leagueId of TRACKED_LEAGUES) {
    try {
      const [data] = await fetchStandings(PROVIDER_LEAGUE_ID[leagueId], new Date().getFullYear());
      const table = data?.league?.standings?.[0] || [];
      for (const row of table) {
        const teamId = `${leagueId}-${row.team.id}`;
        await upsertTeam(teamId, leagueId, row.team.name);
        await sql`
          insert into standings (league_id, team_id, rank, played, wins, draws, losses, points, season_label, is_current)
          values (${leagueId}, ${teamId}, ${row.rank}, ${row.all.played}, ${row.all.win}, ${row.all.draw}, ${row.all.lose}, ${row.points}, ${String(new Date().getFullYear())}, true)
          on conflict (league_id, team_id, group_name, season_label) do update set
            rank = excluded.rank, played = excluded.played, wins = excluded.wins,
            draws = excluded.draws, losses = excluded.losses, points = excluded.points, updated_at = now()
        `;
      }
    } catch (e) {
      console.error(`pollStandings(${leagueId}) failed:`, e.message);
    }
  }
}

export function startPoller() {
  // Live scores + live-event predictions: every 30s, only matters when something's actually live.
  cron.schedule("*/30 * * * * *", () => pollLive().catch((e) => console.error("pollLive error", e)));
  // Upcoming fixtures + pre-kickoff predictions: every 15 min.
  cron.schedule("*/15 * * * *", () => pollUpcoming().catch((e) => console.error("pollUpcoming error", e)));
  // Standings: every 6 hours — tables don't need to be real-time.
  cron.schedule("0 */6 * * *", () => pollStandings().catch((e) => console.error("pollStandings error", e)));

  console.log("Poller scheduled: live/30s, upcoming/15min, standings/6h");
  // Run once immediately on boot so the DB isn't empty while cron warms up.
  pollUpcoming().catch((e) => console.error(e));
  pollStandings().catch((e) => console.error(e));
}
