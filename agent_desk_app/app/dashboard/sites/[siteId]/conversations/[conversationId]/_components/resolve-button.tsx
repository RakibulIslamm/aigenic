'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { markConversationResolvedAction } from '@/app/dashboard/actions';

export function ResolveButton({
  siteId,
  conversationId,
}: {
  siteId: string;
  conversationId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markConversationResolvedAction(siteId, conversationId);
          if (result.ok) {
            toast.success(result.message ?? 'Marked as resolved');
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? (
        <>
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          Saving
        </>
      ) : (
        <>
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Mark as resolved
        </>
      )}
    </Button>
  );
}
