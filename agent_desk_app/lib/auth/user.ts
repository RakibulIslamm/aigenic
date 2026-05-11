import { auth, currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, type User } from '@/db/schema';

/**
 * Returns the row from `users` for the current Clerk user, creating it on
 * first sight. Throws if there is no signed-in session — pair with the proxy
 * matcher so it only runs under protected routes.
 */
export async function getOrCreateUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
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
}

export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }
  return userId;
}
