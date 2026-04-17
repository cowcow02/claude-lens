import type pg from "pg";
import { generateToken, sha256 } from "./crypto";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
}

export async function uniqueSlug(base: string, pool: pg.Pool): Promise<string> {
  let slug = slugify(base);
  const collision = await pool.query("SELECT 1 FROM teams WHERE slug = $1", [slug]);
  if (collision.rowCount) slug = `${slug}-${generateToken(2)}`;
  return slug;
}

export async function createTeamWithAdmin(
  teamName: string,
  userAccountId: string,
  pool: pg.Pool,
): Promise<{ team: { id: string; slug: string; name: string }; membership: { id: string; bearerToken: string } }> {
  const slug = await uniqueSlug(teamName, pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const teamRes = await client.query(
      "INSERT INTO teams (slug, name) VALUES ($1, $2) RETURNING id, slug, name",
      [slug, teamName]
    );
    const team = teamRes.rows[0];

    const bearerToken = "bt_" + generateToken(32);
    const membershipRes = await client.query(
      `INSERT INTO memberships (user_account_id, team_id, role, bearer_token_hash)
       VALUES ($1, $2, 'admin', $3) RETURNING id`,
      [userAccountId, team.id, sha256(bearerToken)]
    );

    await client.query(
      "INSERT INTO events (team_id, actor_id, action) VALUES ($1, $2, 'team.create')",
      [team.id, userAccountId]
    );
    await client.query("COMMIT");
    return { team, membership: { id: membershipRes.rows[0].id, bearerToken } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
