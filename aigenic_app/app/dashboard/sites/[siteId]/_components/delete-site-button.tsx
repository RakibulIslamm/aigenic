'use client';

import { useState, useTransition } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteSiteAction } from '@/app/dashboard/actions';

export function DeleteSiteButton({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, startTransition] = useTransition();

  const matches = confirmation === siteName;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          Delete site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this site?</DialogTitle>
          <DialogDescription>
            This permanently deletes the knowledge base, conversations, escalations, and widget config.
            Visitors hitting your embed will see no bubble. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="confirm">
            Type <span className="font-mono text-foreground">{siteName}</span> to confirm
          </Label>
          <Input
            id="confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || pending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await deleteSiteAction(siteId);
                } catch (err) {
                  // redirect() throws an internal control-flow exception; ignore it.
                  if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) {
                    return;
                  }
                  toast.error(err instanceof Error ? err.message : 'Delete failed');
                }
              });
            }}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Deleting
              </>
            ) : (
              'Delete site'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
