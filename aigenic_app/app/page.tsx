import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import {
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Gauge,
  Mail,
  MessageSquare,
  Minus,
  Quote,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  BILLING_MARKETING,
  PLANS,
  PLAN_ORDER,
  type Plan,
} from '@/lib/billing/plans';

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Trained on your website',
    body: 'Point it at your URL — Aigenic crawls your entire site (pages, help center, blog, FAQs) to build a private knowledge base in minutes.',
  },
  {
    icon: Quote,
    title: 'Cites every answer',
    body: 'Every reply links back to the page it came from, so visitors can verify and you can audit. No silent hallucinations, no "the AI made it up" tickets.',
  },
  {
    icon: Mail,
    title: 'Graceful human handoff',
    body: 'When the agent isn\'t sure, it collects context and emails your support inbox a clean transcript — no leaks, no awkward dead-ends.',
  },
  {
    icon: Gauge,
    title: 'Dashboard you\'ll actually open',
    body: 'See live conversations, escalations, resolution rate, and what your visitors keep asking. Built for support, marketing, and product teams.',
  },
  {
    icon: MessageSquare,
    title: 'On-brand widget',
    body: 'A clean chat bubble that matches your colors, copy, and bot name. Streaming responses, no "Powered by" badges in the way.',
  },
  {
    icon: Code2,
    title: 'One line to ship',
    body: 'A single <script> tag. No SDK, no React peer-dep tango. Works on Next, Astro, Webflow, Shopify, anywhere a script can load.',
  },
];

const COMPARE = [
  { feature: 'Trained on your own knowledge base', aigenic: true, intercom: true },
  { feature: 'Setup in under a minute', aigenic: true, intercom: false },
  { feature: 'One-line embed (no SDK)', aigenic: true, intercom: false },
  { feature: 'Streaming responses', aigenic: true, intercom: true },
  { feature: 'Per-site widget customization', aigenic: true, intercom: true },
  { feature: 'Email handoff on uncertainty', aigenic: true, intercom: false },
  { feature: 'Starts at $0/mo', aigenic: true, intercom: false },
];

const FAQS = [
  {
    q: 'How long does setup take?',
    a: 'About a minute. Sign up, paste your URL, copy the embed script, paste it before </body>. The first crawl runs in the background and you can chat with the bot as soon as it finishes.',
  },
  {
    q: 'Where does the knowledge base live?',
    a: 'In your Aigenic workspace, on Neon Postgres. You can re-sync, edit, or delete articles any time from the dashboard.',
  },
  {
    q: 'What model does it use?',
    a: 'Claude sonnet via OpenRouter, with tool-use enabled so it can search your KB before answering.',
  },
  {
    q: 'What happens when the AI doesn\'t know the answer?',
    a: 'It calls an escalate tool, captures the visitor\'s email if it doesn\'t have one, and sends your support inbox a full transcript with context. No more orphaned chats.',
  },
  {
    q: 'Can I run this on multiple sites?',
    a: 'Yes — the Pro plan covers up to 5 sites, each with its own KB, widget config, and escalation inbox.',
  },
];

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] overflow-hidden">
        <div className="absolute left-1/2 top-[-200px] h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.18),transparent)] blur-3xl" />
      </div>

      <Header />

      <main className="flex-1">
        <Hero />
        <SocialProof />
        <Features />
        <EmbedPreview />
        <Comparison />
        <Pricing />
        <FAQ />
        <CTA />
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-heading text-xl tracking-tight">Aigenic</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition hover:text-foreground">Features</a>
          <a href="#compare" className="transition hover:text-foreground">vs Intercom</a>
          <a href="#pricing" className="transition hover:text-foreground">Pricing</a>
          <a href="#faq" className="transition hover:text-foreground">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Show when="signed-out">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">
                Start free
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild size="sm">
              <Link href="/dashboard">
                Open dashboard
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </Show>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 text-center md:pt-28">
      <Badge variant="secondary" className="mb-6 rounded-full border border-border/60 px-3 py-1 text-xs font-normal text-muted-foreground">
        Powered by Claude Sonnet · Tool-use enabled
      </Badge>
      <h1 className="mx-auto max-w-3xl font-heading text-5xl leading-[1.05] tracking-tight md:text-6xl">
        Add an AI support agent to your site in&nbsp;60&nbsp;seconds.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
        Aigenic crawls your entire website, embeds a chat bubble on it, and answers customer questions
        with citations — escalating to your support inbox when it isn&apos;t sure.
      </p>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 px-6 text-base">
          <Link href="/sign-up">
            Start free
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
          <a href="#features">See how it works</a>
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">No credit card · 1 site free forever · 30 conversations/mo</p>

      <div className="mx-auto mt-16 max-w-3xl">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-1 shadow-2xl shadow-black/40">
          <div className="overflow-hidden rounded-xl border border-border/40">
            <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-4 py-2.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
              </div>
              <span>northstar-coffee.com · support widget</span>
              <span />
            </div>
            <div className="relative grid gap-4 bg-background/40 p-6">
              <ChatBubble role="bot">Hi! I&apos;m Bean, the Northstar Coffee assistant. How can I help?</ChatBubble>
              <ChatBubble role="user">Do you ship to Canada, and how long does it take?</ChatBubble>
              <ChatBubble role="bot">
                Yes — we ship to Canada with <span className="font-medium">DHL Express</span>, usually <span className="font-medium">3–5 business days</span> from our Brooklyn roastery. Free over $60, otherwise $14 flat.
                <span className="mt-2 block text-[11px] text-muted-foreground">Source: northstar-coffee.com/shipping</span>
              </ChatBubble>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ role, children }: { role: 'bot' | 'user'; children: React.ReactNode }) {
  const isBot = role === 'bot';
  return (
    <div className={isBot ? 'flex justify-start' : 'flex justify-end'}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed',
          isBot
            ? 'rounded-tl-sm border border-border/60 bg-card text-foreground'
            : 'rounded-tr-sm bg-foreground text-background',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}

function SocialProof() {
  return (
    <section className="border-y border-border/60 bg-card/30">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
        <Metric value="< 60s" label="time to embed" />
        <Metric value="92%" label="self-serve resolution" />
        <Metric value="$0" label="to start" />
        <Metric value="∞" label="conversations on Pro" />
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-heading text-3xl tracking-tight md:text-4xl">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-4xl tracking-tight md:text-5xl">Built for teams who hate chatbots.</h2>
        <p className="mt-4 text-muted-foreground">
          Most &ldquo;AI support&rdquo; widgets are dressed-up FAQ bots — they pattern-match keywords and pray. Aigenic reads every page
          on your site, cites its sources, and hands the conversation to a human the moment it isn&apos;t sure.
        </p>
      </div>
      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="border-border/60 bg-card/40 transition hover:border-border hover:bg-card/70">
            <CardHeader>
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-background">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4 text-lg">{title}</CardTitle>
              <CardDescription className="text-sm">{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function EmbedPreview() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <Card className="overflow-hidden border-border/60 bg-card/40">
        <div className="grid items-center gap-8 p-6 md:grid-cols-2 md:gap-10 md:p-12">
          <div className="min-w-0">
            <Badge variant="secondary" className="mb-4 rounded-full">One line of code</Badge>
            <h3 className="font-heading text-2xl tracking-tight sm:text-3xl md:text-4xl">Paste this. That&apos;s the install.</h3>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Drop the script before <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/body&gt;</code>. The bubble appears,
              connected to your KB. No build step, no SDK — works on Webflow, Shopify, WordPress, Next.js, anywhere.
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-border/60 bg-background p-4 font-mono text-sm shadow-inner sm:p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>index.html</span>
              <span>copy</span>
            </div>
            <pre className="overflow-x-auto whitespace-pre text-[12px] leading-relaxed text-foreground/90 sm:text-[13px]">
{`<script
  src="https://aigenic.app/widget.js"
  data-site="{siteId}"
  async
></script>`}
            </pre>
          </div>
        </div>
      </Card>
    </section>
  );
}

function Comparison() {
  return (
    <section id="compare" className="mx-auto max-w-5xl px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-3xl tracking-tight sm:text-4xl md:text-5xl">Aigenic vs. Intercom Fin</h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Same job. A lot less setup. A lot less invoice.
        </p>
      </div>
      <Card className="mt-10 overflow-hidden border-border/60 sm:mt-12">
        <div className="grid grid-cols-[1fr_80px_96px] items-center gap-2 border-b border-border/60 bg-card/60 px-4 py-3 text-xs font-medium sm:grid-cols-[1fr_120px_120px] sm:gap-0 sm:px-6 sm:py-4 sm:text-sm">
          <div className="text-muted-foreground">Feature</div>
          <div className="text-center">Aigenic</div>
          <div className="text-center text-muted-foreground">Intercom Fin</div>
        </div>
        {COMPARE.map((row, i) => (
          <div
            key={row.feature}
            className={[
              'grid grid-cols-[1fr_80px_96px] items-center gap-2 px-4 py-3 text-xs sm:grid-cols-[1fr_120px_120px] sm:gap-0 sm:px-6 sm:py-4 sm:text-sm',
              i % 2 === 0 ? 'bg-background/30' : '',
            ].join(' ')}
          >
            <div className="min-w-0 pr-2">{row.feature}</div>
            <div className="flex justify-center">
              {row.aigenic ? <Check className="h-4 w-4 text-foreground" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
            </div>
            <div className="flex justify-center">
              {row.intercom ? <Check className="h-4 w-4 text-muted-foreground" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-4xl tracking-tight md:text-5xl">{BILLING_MARKETING.heading}</h2>
        <p className="mt-3 text-muted-foreground">{BILLING_MARKETING.subheading}</p>
      </div>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {PLAN_ORDER.map((id) => (
          <PricingCard key={id} plan={PLANS[id]} />
        ))}
      </div>
    </section>
  );
}

function PricingCard({ plan }: { plan: Plan }) {
  const disabled = plan.comingSoon === true;
  return (
    <Card
      className={[
        'relative flex flex-col gap-6 border-border/60 p-8',
        plan.highlighted ? 'border-foreground/40 bg-card/80 shadow-2xl shadow-black/30' : 'bg-card/30',
        disabled ? 'opacity-70' : '',
      ].join(' ')}
    >
      {disabled ? (
        <Badge variant="secondary" className="absolute right-6 top-6 rounded-full">Coming soon</Badge>
      ) : (
        plan.highlighted && (
          <Badge className="absolute right-6 top-6 rounded-full bg-foreground text-background">Most popular</Badge>
        )
      )}
      <CardHeader className="p-0">
        <CardTitle className="text-base font-medium uppercase tracking-wider text-muted-foreground">{plan.name}</CardTitle>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-heading text-5xl tracking-tight">{plan.priceLabel}</span>
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
      {disabled ? (
        <Button
          size="lg"
          variant={plan.highlighted ? 'default' : 'outline'}
          className="w-full"
          disabled
          aria-disabled="true"
          title="This plan is coming soon"
        >
          Coming soon
        </Button>
      ) : (
        <Button asChild size="lg" variant={plan.highlighted ? 'default' : 'outline'} className="w-full">
          <Link href="/sign-up">{plan.landingCtaLabel}</Link>
        </Button>
      )}
    </Card>
  );
}

function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-center font-heading text-4xl tracking-tight md:text-5xl">Frequently asked</h2>
      <div className="mt-12 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/30">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-base font-medium">
              {q}
              <span className="text-muted-foreground transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <Card className="overflow-hidden border-border/60 bg-linear-to-b from-card/60 to-background p-12 text-center md:p-16">
        <h2 className="mx-auto max-w-2xl font-heading text-4xl tracking-tight md:text-5xl">
          Ship a support agent before your coffee gets cold.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Free forever for your first site. You'll have a working chat bubble in under a minute.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 px-6 text-base">
            <Link href="/sign-up">
              Start free
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground md:flex-row">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background">
            <Sparkles className="h-3 w-3" />
          </div>
          <span className="font-heading text-base text-foreground">Aigenic</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href="#features" className="transition hover:text-foreground">Features</a>
          <a href="#compare" className="transition hover:text-foreground">vs Intercom</a>
          <a href="#pricing" className="transition hover:text-foreground">Pricing</a>
          <a href="#faq" className="transition hover:text-foreground">FAQ</a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/RakibulIslamm/aigenic"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="transition hover:text-foreground"
          >
            <GithubIcon className="h-4 w-4" />
          </a>
          <a
            href="https://www.linkedin.com/in/d-rakibul-islam/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn profile"
            className="transition hover:text-foreground"
          >
            <LinkedinIcon className="h-4 w-4" />
          </a>
          <span>© {new Date().getFullYear()} Aigenic</span>
        </div>
      </div>
    </footer>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.94c-3.2.69-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.16v3.21c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
