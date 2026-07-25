// Stand-in for `next/cache`. The real `revalidatePath` throws outside a
// request scope ("static generation store missing"), and a unit test has no
// such scope. Aliased in vitest.config.ts rather than vi.mock'd because pnpm's
// isolated node_modules makes `next/cache` resolve differently from a test
// file than from a module inside aigenic_app.
export function revalidatePath(_path: string, _type?: string): void {}
export function revalidateTag(_tag: string): void {}
