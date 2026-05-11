'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

async function postToStripeRoute(path: string): Promise<string> {
  const res = await fetch(path, { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('Stripe did not return a URL');
  return data.url;
}

export function UpgradeButton({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      size="lg"
      disabled={disabled || pending}
      title={disabled ? disabledReason : undefined}
      onClick={async () => {
        setPending(true);
        try {
          const url = await postToStripeRoute('/api/stripe/checkout');
          window.location.href = url;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not start checkout');
          setPending(false);
        }
      }}
    >
      {pending ? (
        <>
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          Opening checkout
        </>
      ) : (
        <>
          Upgrade to Pro
          <ArrowRight className="ml-1 h-4 w-4" />
        </>
      )}
    </Button>
  );
}

export function ManageBillingButton({ disabled }: { disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <Button
      variant="outline"
      disabled={disabled || pending}
      onClick={async () => {
        setPending(true);
        try {
          const url = await postToStripeRoute('/api/stripe/portal');
          window.location.href = url;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not open billing portal');
          setPending(false);
          router.refresh();
        }
      }}
    >
      {pending ? (
        <>
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          Opening portal
        </>
      ) : (
        <>
          <Settings className="mr-1 h-4 w-4" />
          Manage subscription
        </>
      )}
    </Button>
  );
}
