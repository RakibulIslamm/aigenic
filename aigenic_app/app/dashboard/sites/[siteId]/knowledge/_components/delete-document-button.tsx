'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { deleteManualDocumentAction } from '@/app/dashboard/actions';

export function DeleteDocumentButton({
  siteId,
  documentId,
  title,
}: {
  siteId: string;
  documentId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground">
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove {title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this document?</DialogTitle>
          <DialogDescription>
            &ldquo;{title}&rdquo; will be removed from the knowledge base right away, and
            the assistant will stop answering from it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await deleteManualDocumentAction(siteId, documentId).catch(
                  () => ({
                    ok: false as const,
                    error:
                      'Could not reach the server — check your connection and try again.',
                  }),
                );
                if (result.ok) {
                  toast.success(result.message ?? 'Document removed');
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
