import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Labeled input with error/description slot — the standard form control for
 * dashboard forms (add-site dialog, site settings).
 */
export function Field({
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
