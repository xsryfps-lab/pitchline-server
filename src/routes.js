import { Router } from "express";
import { sql } from "./db.js";

export const router = Router();

// Wraps every route so a DB hiccup returns a proper JSON error instead of
// crashing the whole process (an uncaught rejection in an async Express
// handler otherwise takes the entire server down on modern Node).
function safe(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Route error on ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({ error: "internal_error", message: err.message });
    }
  };
}

router.get("/matches/live", safe(async (req, res) => {
  const rows = await sql`
    select m.*, ht.short_name as home_name, at.short_name as away_name,
      (select row_to_json(p) from (
        select home_win_pct, draw_pct, away_win_pct, confidence, data_quality, reasoning, btts_yes_pct, over25_pct, corners_line, corners_over_pct, correct_scores
        from predictions where match_id = m.id order by generated_at desc limit 1
      ) p) as prediction
    from matches m
    join teams ht on ht.id = m.home_team_id
    join teams at on at.id = m.away_team_id
    where m.status in ('live', 'half_time')
    order by m.kickoff asc
  `;
  res.json(rows);
}));

router.get("/matches/upcoming", safe(async (req, res) => {
  const rows = await sql`
    select m.*, ht.short_name as home_name, at.short_name as away_name,
      (select row_to_json(p) from (
        select home_win_pct, draw_pct, away_win_pct, confidence, data_quality, reasoning, btts_yes_pct, over25_pct, corners_line, corners_over_pct, correct_scores
        from predictions where match_id = m.id order by generated_at desc limit 1
      ) p) as prediction
    from matches m
    join teams ht on ht.id = m.home_team_id
    join teams at on at.id = m.away_team_id
    where m.status = 'upcoming' and m.kickoff > now()
    order by m.kickoff asc
    limit 40
  `;
  res.json(rows);
}));

router.get("/matches/:id", safe(async (req, res) => {
  const [match] = await sql`
    select m.*, ht.name as home_name, at.name as away_name
    from matches m join teams ht on ht.id = m.home_team_id join teams at on at.id = m.away_team_id
    where m.id = ${req.params.id}
  `;
  if (!match) return res.status(404).json({ error: "not found" });
  const predictions = await sql`select * from predictions where match_id = ${req.params.id} order by generated_at desc`;
  res.json({ ...match, predictions });
}));

router.get("/leagues/:id/standings", safe(async (req, res) => {
  const rows = await sql`
    select s.*, t.name as team_name, t.short_name
    from standings s join teams t on t.id = s.team_id
    where s.league_id = ${req.params.id} and s.is_current = true
    order by s.rank asc
  `;
  res.json(rows);
}));

router.get("/leagues/:id/fixtures", safe(async (req, res) => {
  const rows = await sql`
    select m.*, ht.short_name as home_name, at.short_name as away_name
    from matches m join teams ht on ht.id = m.home_team_id join teams at on at.id = m.away_team_id
    where m.league_id = ${req.params.id}
    order by m.kickoff desc limit 60
  `;
  res.json(rows);
}));

router.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
