# Pitchline AI — backend

This is the always-on piece FotMob-style apps need: it polls a football data
API on a schedule and writes into Neon, so the website just reads a fast
database instead of hitting a rate-limited third-party API on every page load.

## What runs when
- **Live matches** — polled every 30 seconds, only produces a new AI
  prediction when a goal / red card / half-time actually happens.
- **Upcoming fixtures (next 7 days)** — polled every 15 minutes. Predictions
  only get generated once a fixture enters the 24-hour window, per the spec.
- **Standings** — polled every 6 hours.

## Setup
1. `cp .env.example .env` and fill in:
   - `DATABASE_URL` from your Neon project
   - `FOOTBALL_API_KEY` — sign up at api-football.com (or swap providers in
     `src/footballProvider.js` if you already have SportMonks/Sportradar)
   - `ANTHROPIC_API_KEY` — optional, leave blank to skip real AI reasoning and
     use the free template fallback while you're testing
2. Run the schema once: `psql "$DATABASE_URL" -f schema.sql`
3. `npm install`
4. `npm start`

## Deploying so it actually stays "always on"
This process needs to keep running in the background (the cron jobs live
inside it), so it can't go on Vercel's default serverless functions. Cheapest
options that work out of the box:
- **Render** (Web Service, free tier sleeps after inactivity — fine for
  testing, upgrade to a paid instance ($7/mo) once you want it always live)
- **Railway** — similar, usage-based pricing
- **Fly.io** — a bit more setup, cheapest for 24/7 uptime

Point `DATABASE_URL` at Neon either way — Neon itself is serverless and
doesn't care where the backend runs.

## Once it's deployed
Give the frontend your backend's public URL (e.g.
`https://pitchline-api.onrender.com`) — there's a single `API_BASE` constant
at the top of the React app to set it. The frontend polls:
- `GET /api/matches/live` every ~15s
- `GET /api/matches/upcoming` every ~60s
- `GET /api/leagues/:id/standings` every ~5min

If `API_BASE` is empty, the frontend falls back to the real snapshot data
baked in for the demo, so it still works standalone.
