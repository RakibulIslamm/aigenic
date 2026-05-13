'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
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
import { createSiteAction, type ActionState } from '../actions';

export function AddSiteDialog({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState | undefined, FormData>(
    createSiteAction,
    undefined
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? 'Site created — crawling now');
      setOpen(false);
      if (state.siteId) {
        router.push(`/dashboard/sites/${state.siteId}`);
      } else {
        router.refresh();
      }
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const values = state && !state.ok ? state.values ?? {} : {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" disabled={disabled} title={disabled ? disabledReason : undefined}>
          <Plus className="mr-1 h-4 w-4" />
          Add a site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Add a site</DialogTitle>
          <DialogDescription>
            We&apos;ll crawl your URL to build a private knowledge base. The chat bubble appears as soon as the first articles land.
          </DialogDescription>
        </DialogHeader>
        <form
          key={state && !state.ok ? `err-${Object.values(values).join('|')}` : 'fresh'}
          action={formAction}
          className="grid gap-4 py-2"
        >
          <Field
            id="name"
            label="Display name"
            placeholder="Acme Docs"
            error={fieldErrors.name}
            defaultValue={values.name}
            autoFocus
          />
          <Field
            id="domain"
            label="Site URL"
            placeholder="https://docs.acme.com"
            type="url"
            inputMode="url"
            error={fieldErrors.domain}
            defaultValue={values.domain}
            description="Full URL including https://. We crawl pages within this domain only."
          />
          <Field
            id="escalationEmail"
            label="Escalation email"
            placeholder="support@acme.com"
            type="email"
            error={fieldErrors.escalationEmail}
            defaultValue={values.escalationEmail}
            description="Where we send transcripts when the agent can't confidently answer."
          />
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Creating
                </>
              ) : (
                'Create site'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  description,
  error,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  description?: string;
  error?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...inputProps} aria-invalid={Boolean(error)} />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
