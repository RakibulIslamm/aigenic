import { cache } from 'react';
import { auth, currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { db, withDbRetry } from '@/db';
import { users, type User } from '@/db/schema';

/**
 * Returns the row from `users` for the current Clerk user, creating it on
 * first sight. Throws if there is no signed-in session — pair with the proxy
 * matcher so it only runs under protected routes.
 *
 * Wrapped in React `cache()` so every page + layout in the same request
 * shares one Promise instead of triggering a fresh Clerk + DB roundtrip each.
 */
export const getOrCreateUser = cache(async (): Promise<User> => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }

  // First query on every authenticated request — retried once so a Neon
  // scale-to-zero resume shows up as a slow dashboard, not a crash page.
  const existing = await withDbRetry(() =>
    db.query.users.findFirst({
      where: eq(users.id, userId),
    }),
  );
  if (existing) return existing;

  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress ??
    '';

  const [created] = await db
    .insert(users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: users.id })
    .returning();

  if (created) return created;

  const refetched = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!refetched) {
    throw new Error('Failed to provision user row');
  }
  return refetched;
});

export const requireUserId = cache(async (): Promise<string> => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }
  return userId;
});
