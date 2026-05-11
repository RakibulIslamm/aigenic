'use client';

import { useTransition } from 'react';
import { Loader2, RefreshCw, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  rescrapeArticleAction,
  rescrapeSiteAction,
  type ActionState,
} from '@/app/dashboard/actions';

function handleResult(result: ActionState, fallbackMessage: string) {
  if (result.ok) {
    toast.success(result.message ?? fallbackMessage);
  } else {
    toast.error(result.error);
  }
}

export function ResyncAllButton({ siteId }: { siteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await rescrapeSiteAction(siteId);
          handleResult(result, 'Re-crawl started');
        });
      }}
    >
      {pending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-1 h-4 w-4" />
      )}
      Resync all
    </Button>
  );
}

export function RescrapeArticleButton({
  siteId,
  articleId,
}: {
  siteId: string;
  articleId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await rescrapeArticleAction(siteId, articleId);
          handleResult(result, 'Re-scrape queued');
        });
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RotateCw className="h-4 w-4" />
      )}
      <span className="sr-only">Re-scrape article</span>
    </Button>
  );
}
