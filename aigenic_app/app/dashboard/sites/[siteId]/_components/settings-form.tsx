'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateSiteAction, type ActionState } from '@/app/dashboard/actions';

interface SettingsFormProps {
  siteId: string;
  initial: {
    name: string;
    domain: string;
    escalationEmail: string;
    primaryColor: string;
    greeting: string;
    botName: string;
  };
}

export function SettingsForm({ siteId, initial }: SettingsFormProps) {
  const router = useRouter();
  const action = updateSiteAction.bind(null, siteId);
  const [state, formAction, pending] = useActionState<ActionState | undefined, FormData>(
    action,
    undefined
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? 'Saved');
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form action={formAction} className="grid gap-8">
      <FieldGroup title="Site" description="The basics — used everywhere we mention this site.">
        <Field
          id="name"
          label="Display name"
          defaultValue={initial.name}
          error={fieldErrors.name}
          required
        />
        <Field
          id="domain"
          label="Site URL"
          type="url"
          defaultValue={initial.domain}
          error={fieldErrors.domain}
          required
        />
        <Field
          id="escalationEmail"
          label="Escalation email"
          type="email"
          defaultValue={initial.escalationEmail}
          error={fieldErrors.escalationEmail}
          description="Transcripts go here when the agent escalates."
          required
        />
      </FieldGroup>

      <FieldGroup title="Widget appearance" description="What your visitors see in the chat bubble.">
        <Field
          id="botName"
          label="Bot name"
          defaultValue={initial.botName}
          error={fieldErrors.botName}
          required
        />
        <ColorField
          initialValue={initial.primaryColor}
          error={fieldErrors.primaryColor}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="greeting">Greeting</Label>
          <Textarea
            id="greeting"
            name="greeting"
            defaultValue={initial.greeting}
            rows={3}
            aria-invalid={Boolean(fieldErrors.greeting)}
          />
          {fieldErrors.greeting ? (
            <p className="text-xs text-destructive">{fieldErrors.greeting}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              First message visitors see when they open the chat bubble.
            </p>
          )}
        </div>
      </FieldGroup>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Saving
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </form>
  );
}

function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-xl border border-border/60 bg-card/40 p-6">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
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

function ColorField({
  initialValue,
  error,
}: {
  initialValue: string;
  error?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="primaryColor">Primary color</Label>
      <div className="flex items-center gap-2">
        <label
          htmlFor="primaryColorPicker"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border border-border/60 transition hover:border-border"
          style={{ backgroundColor: isValidHex ? value : 'transparent' }}
          title="Pick a color"
        >
          <input
            id="primaryColorPicker"
            type="color"
            value={isValidHex ? value : '#7c5cff'}
            onChange={(e) => setValue(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
        </label>
        <Input
          id="primaryColor"
          name="primaryColor"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#7c5cff"
          aria-invalid={Boolean(error)}
          required
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Hex color used for the chat bubble and primary button.
        </p>
      )}
    </div>
  );
}
