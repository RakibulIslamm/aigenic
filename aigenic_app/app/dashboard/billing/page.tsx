import { Check, CreditCard, RefreshCw, Sparkles } from 'lucide-react';
import { getOrCreateUser } from '@/lib/auth/user';
import { listSitesForUser } from '@/lib/sites/queries';
import { countConversationsThisMonthForUser } from '@/lib/sites/conversations';
import {
  PLANS,
  PLAN_ORDER,
  getPlan,
  manualCrawlWindowStart,
  type Plan,
} from '@/lib/billing/plans';
import { countManualCrawlsForUserSince } from '@/lib/sites/crawl-runs';
import { isPlanPurchasable, isStripeConfigured } from '@/lib/billing/stripe';
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
  const plan = getPlan(user.plan);
  const [sites, monthlyConversations, manualCrawlsUsed] = await Promise.all([
    listSitesForUser(user.id),
    countConversationsThisMonthForUser(user.id),
    countManualCrawlsForUserSince(user.id, manualCrawlWindowStart(plan)),
  ]);
  const stripeReady = isStripeConfigured();
  const isOverIncluded =
    !plan.limits.enforceConversationLimit &&
    monthlyConversations > plan.limits.conversationsPerMonth;
  const overageCount = isOverIncluded
    ? monthlyConversations - plan.limits.conversationsPerMonth
    : 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-serif text-4xl tracking-tight md:text-5xl">Billing</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          You&apos;re on the <span className="font-medium text-foreground">{plan.name}</span> plan.
          {plan.id === 'free'
            ? ' Upgrade to add more sites and lift the per-month conversation cap.'
            : ' Manage or change your plan below.'}
        </p>
      </header>

      {status === 'success' && (
        <Banner
          tone="success"
          title={`You're on ${plan.name} 🎉`}
          body="Stripe just confirmed the subscription. The new limits are live and the dashboard already reflects the change."
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
          body="Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, plus STRIPE_STARTER_PRICE_ID and/or STRIPE_PRO_PRICE_ID to enable upgrades. The Free plan still works."
        />
      )}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <UsageCard
          label="Sites"
          value={`${sites.length} / ${plan.limits.sites}`}
          hint={sites.length >= plan.limits.sites ? 'At your plan limit' : 'Within your plan limit'}
          warn={sites.length >= plan.limits.sites}
        />
        <UsageCard
          label="Conversations this month"
          value={`${monthlyConversations} / ${plan.limits.conversationsPerMonth}${plan.limits.enforceConversationLimit ? '' : ' included'}`}
          hint={
            plan.limits.enforceConversationLimit
              ? monthlyConversations >= plan.limits.conversationsPerMonth
                ? 'At your plan limit — new conversations are paused until next month.'
                : 'Within your plan limit'
              : isOverIncluded
                ? `${overageCount} conversation${overageCount === 1 ? '' : 's'} over — billed at $${((plan.limits.overageCentsPerConversation ?? 0) / 100).toFixed(2)} each next invoice.`
                : 'Within your included allowance'
          }
          warn={
            plan.limits.enforceConversationLimit &&
            monthlyConversations >= plan.limits.conversationsPerMonth
          }
        />
        <UsageCard
          label={`Manual crawls / ${plan.limits.manualCrawls.period}`}
          icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
          value={`${manualCrawlsUsed} / ${plan.limits.manualCrawls.count}`}
          hint={
            manualCrawlsUsed >= plan.limits.manualCrawls.count
              ? `Quota used. ${plan.limits.scheduledCrawl ? 'Daily auto-crawl still runs at 03:00 UTC.' : 'Resets a week after each crawl.'}`
              : plan.limits.scheduledCrawl
                ? 'Plus a daily auto-crawl at 03:00 UTC.'
                : 'Within your plan limit'
          }
          warn={manualCrawlsUsed >= plan.limits.manualCrawls.count}
        />
        <Card className="border-border/60 bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Plan</CardDescription>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-serif text-3xl tracking-tight">{plan.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.plan !== 'free' && user.stripeSubscriptionId
                ? 'Subscription active via Stripe'
                : 'No subscription'}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const planEntry = PLANS[id];
          return (
            <PlanCard
              key={id}
              plan={planEntry}
              currentPlan={user.plan}
              purchasable={id === 'free' ? undefined : isPlanPurchasable(id)}
            />
          );
        })}
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  currentPlan,
  purchasable,
}: {
  plan: Plan;
  currentPlan: string;
  purchasable?: boolean;
}) {
  const isCurrent = currentPlan === plan.id;
  const isPaid = plan.id !== 'free';
  const highlighted = plan.highlighted;

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
      {!isCurrent && highlighted && (
        <Badge className="absolute right-6 top-6 rounded-full bg-foreground text-background">
          Most popular
        </Badge>
      )}
      <CardHeader className="space-y-1 p-0">
        <CardTitle className="text-base font-medium uppercase tracking-wider text-muted-foreground">
          {plan.name}
        </CardTitle>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-5xl tracking-tight">{plan.priceLabel}</span>
          <span className="text-sm text-muted-foreground">{plan.pricePeriod}</span>
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

      {isPaid ? (
        isCurrent ? (
          <ManageBillingButton />
        ) : (
          <UpgradeButton
            plan={plan.id as 'starter' | 'pro'}
            label={`Upgrade to ${plan.name}`}
            variant={highlighted ? 'default' : 'outline'}
            disabled={!purchasable}
            disabledReason="Stripe is not configured for this plan on this deployment"
          />
        )
      ) : isCurrent ? (
        <p className="text-center text-xs text-muted-foreground">
          You&apos;re on Free. Upgrade above to lift the limits.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Downgrade by cancelling your paid plan from the customer portal.
        </p>
      )}
    </Card>
  );
}

function UsageCard({
  label,
  value,
  hint,
  warn,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card className={`border-border/60 bg-card/40 ${warn ? 'border-amber-500/40' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        {icon ?? <CreditCard className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="font-serif text-2xl tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
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
