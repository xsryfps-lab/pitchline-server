import cron from "node-cron";
import { sql } from "./db.js";
import { PROVIDER_LEAGUE_ID, fetchSeasonMatches, fetchStandings, currentSeason } from "./footballProvider.js";
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

async function pollLive() {}

async function pollUpcoming() {
  for (const leagueId of Object.keys(PROVIDER_LEAGUE_ID)) {
    try {
      let matches = await fetchSeasonMatches(leagueId, currentSeason());
      if (matches.length === 0) {
        // New season not scheduled yet — fall back to last season so the
        // league page isn't empty (finished matches still show real data).
        matches = await fetchSeasonMatches(leagueId, currentSeason() - 1);
      }
      for (const f of matches) {
        await upsertMatch(f);
        await maybePredict(f);
      }
      console.log(`pollUpcoming(${leagueId}): ${matches.length} matches synced`);
    } catch (e) {
      console.error(`pollUpcoming(${leagueId}) failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function pollStandings() {
  for (const leagueId of Object.keys(PROVIDER_LEAGUE_ID)) {
    try {
      let table = await fetchStandings(leagueId, currentSeason());
      let seasonUsed = String(currentSeason());
      if (!table || table.length === 0) {
        table = await fetchStandings(leagueId, currentSeason() - 1);
        seasonUsed = String(currentSeason() - 1);
      }
      let rank = 1;
      for (const row of table || []) {
        const teamId = `${leagueId}-${row.teamInfoId}`;
        await upsertTeam(teamId, leagueId, row.shortName || row.teamName);
        await sql`
          insert into standings (league_id, team_id, rank, played, wins, draws, losses, points, season_label, is_current)
          values (${leagueId}, ${teamId}, ${rank}, ${row.matches}, ${row.won}, ${row.draw}, ${row.lost}, ${row.points}, ${seasonUsed}, true)
          on conflict (league_id, team_id, group_name, season_label) do update set
            rank = excluded.rank, played = excluded.played, wins = excluded.wins,
            draws = excluded.draws, losses = excluded.losses, points = excluded.points, updated_at = now()
        `;
        rank++;
      }
      console.log(`pollStandings(${leagueId}): ${table?.length || 0} rows (season ${seasonUsed})`);
    } catch (e) {
      console.error(`pollStandings(${leagueId}) failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
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
