/**
 * promptRegistry.ts
 * DB-backed prompt versioning registry. FR-CAL-08.
 */
import { getDb } from "../../db";
import { adapterPromptVersions } from "../../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import type { AdapterPromptVersion } from "../../../drizzle/schema";

export type { AdapterPromptVersion as PromptVersion };

/**
 * Save a new prompt version for an adapter.
 * The new version is set as active and all previous versions are deactivated.
 */
export async function savePromptVersion(
  adapterId: string,
  promptText: string,
  failureGroup: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .update(adapterPromptVersions)
    .set({ isActive: false })
    .where(eq(adapterPromptVersions.adapterId, adapterId));

  const existing = await db
    .select({ version: adapterPromptVersions.version })
    .from(adapterPromptVersions)
    .where(eq(adapterPromptVersions.adapterId, adapterId))
    .orderBy(desc(adapterPromptVersions.version))
    .limit(1);

  const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

  await db.insert(adapterPromptVersions).values({
    adapterId,
    version: nextVersion,
    promptText,
    failureGroup,
    isActive: true,
    createdAt: new Date(),
  });

  return nextVersion;
}

/**
 * Get the active prompt version for an adapter.
 * Returns null if no active version exists.
 */
export async function getActivePromptVersion(
  adapterId: string
): Promise<AdapterPromptVersion | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(adapterPromptVersions)
    .where(
      and(
        eq(adapterPromptVersions.adapterId, adapterId),
        eq(adapterPromptVersions.isActive, true)
      )
    )
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get all prompt versions for an adapter, ordered by version descending.
 */
export async function getPromptVersionHistory(
  adapterId: string
): Promise<AdapterPromptVersion[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(adapterPromptVersions)
    .where(eq(adapterPromptVersions.adapterId, adapterId))
    .orderBy(desc(adapterPromptVersions.version));
}

/**
 * Rollback to a specific version for an adapter.
 */
export async function rollbackPromptVersion(
  adapterId: string,
  targetVersion: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(adapterPromptVersions)
    .set({ isActive: false })
    .where(eq(adapterPromptVersions.adapterId, adapterId));

  const result = await db
    .update(adapterPromptVersions)
    .set({ isActive: true })
    .where(
      and(
        eq(adapterPromptVersions.adapterId, adapterId),
        eq(adapterPromptVersions.version, targetVersion)
      )
    );

  return (result as unknown as { affectedRows: number }).affectedRows > 0;
}
