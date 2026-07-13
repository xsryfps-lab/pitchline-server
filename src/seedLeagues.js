import { sql } from "./db.js";

const LEAGUES = [
  ["bund", "Bundesliga", "Germany", "eu-major", "Top flight"],
  ["bund2", "2. Bundesliga", "Germany", "eu-major", "2nd tier"],
  ["dfbpokal", "DFB-Pokal", "Germany", "eu-major", "Domestic cup"],
];

export async function seedLeagues() {
  for (const [id, name, country, region, tier] of LEAGUES) {
    await sql`
      insert into leagues (id, name, country, region, tier)
      values (${id}, ${name}, ${country}, ${region}, ${tier})
      on conflict (id) do update set name = excluded.name
    `;
  }
  console.log(`seedLeagues: ${LEAGUES.length} leagues ready`);
}
