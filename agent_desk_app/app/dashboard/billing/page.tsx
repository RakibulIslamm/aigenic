import { Check, CreditCard, Sparkles } from 'lucide-react';
import { getOrCreateUser } from '@/lib/auth/user';
import { listSitesForUser } from '@/lib/sites/queries';
import { countConversationsThisMonthForUser } from '@/lib/sites/conversations';
import { PLANS, getPlan } from '@/lib/billing/plans';
import { isStripeConfigured } from '@/lib/billing/stripe';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { UpgradeButton, ManageBillingButton } from './_components/billing-actions';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  const user = await getOrCreateUser();
  const [sites, monthlyConversations] = await Promise.all([
    listSitesForUser(user.id),
    countConversationsThisMonthForUser(user.id),
  ]);

  const plan = getPlan(user.plan);
  const stripeReady = isStripeConfigured();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-serif text-4xl tracking-tight md:text-5xl">Billing</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          You&apos;re on the <span className="font-medium text-foreground">{plan.name}</span> plan. Upgrade to lift the per-month conversation cap and add up to five sites.
        </p>
      </header>

      {status === 'success' && (
        <Banner
          tone="success"
          title="You're on Pro 🎉"
          body="Stripe just confirmed the subscription. Limits are lifted and the dashboard already reflects the new plan."
        />
      )}
      {status === 'cancelled' && (
        <Banner
          tone="muted"
          title="Checkout cancelled"
          body="No charge made. You can come back any time — your sites and data are unchanged."
        />
      )}

      {!stripeReady && (
        <Banner
          tone="warn"
          title="Stripe isn't configured on this deployment"
          body="Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRO_PRICE_ID to enable upgrades. The Free plan still works."
        />
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <UsageCard
          label="Sites"
          value={`${sites.length} / ${plan.limits.sites}`}
          full={sites.length >= plan.limits.sites}
        />
        <UsageCard
          label="Conversations this month"
          value={
            plan.limits.conversationsPerMonth === Number.POSITIVE_INFINITY
              ? `${monthlyConversations} / Unlimited`
              : `${monthlyConversations} / ${plan.limits.conversationsPerMonth}`
          }
          full={
            plan.limits.conversationsPerMonth !== Number.POSITIVE_INFINITY &&
            monthlyConversations >= plan.limits.conversationsPerMonth
          }
        />
        <Card className="border-border/60 bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Plan</CardDescription>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-serif text-3xl tracking-tight">{plan.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.plan === 'pro' && user.stripeSubscriptionId
                ? 'Subscription active via Stripe'
                : 'No subscription'}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <PlanCard plan={PLANS.free} currentPlan={user.plan} />
        <PlanCard
          plan={PLANS.pro}
          currentPlan={user.plan}
          highlighted
          stripeReady={stripeReady}
        />
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  currentPlan,
  highlighted,
  stripeReady,
}: {
  plan: (typeof PLANS)[keyof typeof PLANS];
  currentPlan: string;
  highlighted?: boolean;
  stripeReady?: boolean;
}) {
  const isCurrent = currentPlan === plan.id;
  const isPro = plan.id === 'pro';

  return (
    <Card
      className={[
        'relative flex flex-col gap-6 border-border/60 p-8',
        highlighted ? 'border-foreground/40 bg-card/80 shadow-2xl shadow-black/30' : 'bg-card/30',
      ].join(' ')}
    >
      {isCurrent && (
        <Badge className="absolute right-6 top-6 rounded-full bg-foreground text-background">
          Current plan
        </Badge>
      )}
      <CardHeader className="space-y-1 p-0">
        <CardTitle className="text-base font-medium uppercase tracking-wider text-muted-foreground">
          {plan.name}
        </CardTitle>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-5xl tracking-tight">{plan.priceLabel}</span>
          <span className="text-sm text-muted-foreground">{isPro ? 'per month' : 'forever'}</span>
        </div>
        <CardDescription className="mt-2">{plan.description}</CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-1 flex-col gap-3 p-0">
        {plan.features.map((f) => (
          <div key={f} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
            <span>{f}</span>
          </div>
        ))}
      </CardContent>

      {isPro ? (
        isCurrent ? (
          <ManageBillingButton />
        ) : (
          <UpgradeButton
            disabled={!stripeReady}
            disabledReason="Stripe is not configured on this deployment"
          />
        )
      ) : isCurrent ? (
        <p className="text-center text-xs text-muted-foreground">
          You&apos;re on Free. Upgrade above to lift the limits.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Downgrade by cancelling Pro from the customer portal.
        </p>
      )}
    </Card>
  );
}

function UsageCard({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <Card className={`border-border/60 bg-card/40 ${full ? 'border-amber-500/40' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="font-serif text-2xl tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {full ? 'At your plan limit' : 'Within your plan limit'}
        </p>
      </CardContent>
    </Card>
  );
}

function Banner({
  tone,
  title,
  body,
}: {
  tone: 'success' | 'warn' | 'muted';
  title: string;
  body: string;
}) {
  const styles =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
        : 'border-border/60 bg-card/40 text-muted-foreground';
  return (
    <div className={`rounded-xl border p-4 text-sm ${styles}`}>
      <div className="font-medium">{title}</div>
      <p className="mt-1 opacity-90">{body}</p>
    </div>
  );
}
