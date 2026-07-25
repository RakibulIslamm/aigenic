import { CreditCard } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/**
 * The one stat tile used across the dashboard root, site overview, analytics
 * (size "lg"), and billing usage cards (size "md", with `warn` for
 * at-limit highlighting).
 */
export function StatCard({
  icon: Icon = CreditCard,
  label,
  value,
  hint,
  warn = false,
  size = 'lg',
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint: string;
  warn?: boolean;
  size?: 'md' | 'lg';
}) {
  return (
    <Card className={`border-border/60 bg-card/40 ${warn ? 'border-amber-500/40' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">
          {label}
        </CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div
          className={`font-heading tracking-tight ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}
        >
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
