import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <Link
        href="/"
        className="mb-10 font-serif text-2xl tracking-tight text-foreground"
      >
        AgentDesk
      </Link>
      <SignIn />
    </div>
  );
}
