import cron from "node-cron";
import { sql } from "./db.js";
import { PROVIDER_LEAGUE_ID, fetchUpcoming, fetchRecentResults, fetchStandings } from "./footballProvider.js";
import { predictionWindow, shouldRegenerate, statisticalModel, deriveMarkets, correctScoreDistribution, generateReasoning } from "./predictor.js";

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
  const [prevRow] = await sql`select home_score, away_score from matches where id = ${match.id}`;
  const goalHappened = prevRow && (prevRow.home_score !== match.home_score || prevRow.away_score !== match.away_score);
  const signal = goalHappened ? "goal" : null;

  if (!(await shouldRegenerate(match.id, window, signal))) return;

  const [homeStats] = await sql`select points from standings where team_id = ${match.home_team_id} limit 1`;
  const [awayStats] = await sql`select points from standings where team_id = ${match.away_team_id} limit 1`;
  const { homeWin, draw, awayWin, confidence } = statisticalModel({
    homeForm: ["W", "D", "W", "L", "W"], // TODO: derive from recent results once results history is stored
    awayForm: ["W", "W", "D", "L", "D"],
    homePoints: homeStats?.points || 20,
    awayPoints: awayStats?.points || 20,
  });
  const markets = deriveMarkets({ homeWin, awayWin });
  const scores = correctScoreDistribution({ homeWin, awayWin });
  const reasoning = await generateReasoning({ homeName: match.home_team_id, awayName: match.away_team_id, homeWin, draw, awayWin });

  await sql`
    insert into predictions (match_id, trigger, home_win_pct, draw_pct, away_win_pct, btts_yes_pct, over25_pct, corners_line, corners_over_pct, correct_scores, confidence, data_quality, reasoning)
    values (${match.id}, ${window === "live" ? "live_event" : window === "full" ? "pre_3h" : "pre_24h"}, ${homeWin}, ${draw}, ${awayWin}, ${markets.btts.yes}, ${markets.over25.over}, ${markets.corners.line}, ${markets.corners.over}, ${JSON.stringify(scores)}, ${confidence}, 80, ${reasoning})
  `;
}

// No true live feed on this free provider (see footballProvider.js) — this
// just stays a no-op hook so the cron schedule and architecture are ready
// to light up the moment you add a live-capable key.
async function pollLive() {}

async function pollUpcoming() {
  for (const leagueId of Object.keys(PROVIDER_LEAGUE_ID)) {
    try {
      const [upcoming, recent] = await Promise.all([fetchUpcoming(leagueId), fetchRecentResults(leagueId)]);
      for (const f of [...upcoming, ...recent]) {
        await upsertMatch(f);
        await maybePredict(f);
      }
      console.log(`pollUpcoming(${leagueId}): ${upcoming.length} upcoming, ${recent.length} recent`);
    } catch (e) {
      console.error(`pollUpcoming(${leagueId}) failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 400)); // stay well under the free rate limit
  }
}

async function pollStandings() {
  for (const leagueId of Object.keys(PROVIDER_LEAGUE_ID)) {
    try {
      const table = await fetchStandings(leagueId);
      for (const row of table) {
        const teamId = `${leagueId}-${row.idTeam}`;
        await upsertTeam(teamId, leagueId, row.strTeam);
        await sql`
          insert into standings (league_id, team_id, rank, played, wins, draws, losses, points, season_label, is_current)
          values (${leagueId}, ${teamId}, ${Number(row.intRank)}, ${Number(row.intPlayed)}, ${Number(row.intWin)}, ${Number(row.intDraw)}, ${Number(row.intLoss)}, ${Number(row.intPoints)}, ${row.strSeason || String(new Date().getFullYear())}, true)
          on conflict (league_id, team_id, group_name, season_label) do update set
            rank = excluded.rank, played = excluded.played, wins = excluded.wins,
            draws = excluded.draws, losses = excluded.losses, points = excluded.points, updated_at = now()
        `;
      }
      console.log(`pollStandings(${leagueId}): ${table.length} rows`);
    } catch (e) {
      console.error(`pollStandings(${leagueId}) failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

export function startPoller() {
  cron.schedule("*/30 * * * * *", () => pollLive().catch((e) => console.error("pollLive error", e)));
  cron.schedule("*/15 * * * *", () => pollUpcoming().catch((e) => console.error("pollUpcoming error", e)));
  cron.schedule("0 */6 * * *", () => pollStandings().catch((e) => console.error("pollStandings error", e)));

  console.log("Poller scheduled: live/30s (no-op on this provider), upcoming/15min, standings/6h");
  pollUpcoming().catch((e) => console.error(e));
  pollStandings().catch((e) => console.error(e));
}
