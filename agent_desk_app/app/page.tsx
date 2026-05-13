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
  Sparkles,
  Zap,
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

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Trained on your docs',
    body: 'Point it at your URL — AgentDesk crawls your help center, docs, and FAQs to build a private knowledge base in minutes.',
  },
  {
    icon: MessageSquare,
    title: 'Streaming chat, on-brand',
    body: 'A clean chat bubble that matches your colors, copy, and bot name. No "Powered by" badges in the way.',
  },
  {
    icon: Mail,
    title: 'Graceful human handoff',
    body: 'When the agent isn\'t sure, it collects context and emails your support inbox a clean transcript — no leaks, no awkward dead-ends.',
  },
  {
    icon: Gauge,
    title: 'Dashboard you\'ll actually open',
    body: 'See live conversations, escalations, resolution rate, and what your visitors keep asking. Built for product teams.',
  },
  {
    icon: Code2,
    title: 'One line to ship',
    body: 'A single <script> tag. No SDK, no React peer-dep tango. Works on Next, Astro, Webflow, Shopify, anywhere a script can load.',
  },
  {
    icon: Zap,
    title: 'Built on Claude Sonnet 4.6',
    body: 'Frontier reasoning behind every reply, with structured tool use to look up articles before it answers.',
  },
];

const COMPARE = [
  { feature: 'Trained on your own knowledge base', agentdesk: true, intercom: true },
  { feature: 'Setup in under a minute', agentdesk: true, intercom: false },
  { feature: 'One-line embed (no SDK)', agentdesk: true, intercom: false },
  { feature: 'Streaming responses', agentdesk: true, intercom: true },
  { feature: 'Per-site widget customization', agentdesk: true, intercom: true },
  { feature: 'Email handoff on uncertainty', agentdesk: true, intercom: false },
  { feature: 'Starts at $0/mo', agentdesk: true, intercom: false },
];

const FAQS = [
  {
    q: 'How long does setup take?',
    a: 'About a minute. Sign up, paste your URL, copy the embed script, paste it before </body>. The first crawl runs in the background and you can chat with the bot as soon as it finishes.',
  },
  {
    q: 'Where does the knowledge base live?',
    a: 'In your AgentDesk workspace, on Neon Postgres. You can re-sync, edit, or delete articles any time from the dashboard.',
  },
  {
    q: 'What model does it use?',
    a: 'Anthropic Claude Sonnet 4.6 via OpenRouter, with tool-use enabled so it can search your KB before answering.',
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
          <span className="font-serif text-xl tracking-tight">AgentDesk</span>
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
        Powered by DeepSeek V4 · Tool-use enabled
      </Badge>
      <h1 className="mx-auto max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight md:text-6xl">
        Add an AI support agent to your site in&nbsp;60&nbsp;seconds.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
        AgentDesk crawls your docs, embeds a chat bubble on your site, and answers customer questions
        with citations — escalating to your support inbox when it isn't sure.
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
      <p className="mt-4 text-xs text-muted-foreground">No credit card · 1 site free forever · 100 conversations/mo</p>

      <div className="mx-auto mt-16 max-w-3xl">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-1 shadow-2xl shadow-black/40">
          <div className="overflow-hidden rounded-xl border border-border/40">
            <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-4 py-2.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
              </div>
              <span>linear-clone.app · support widget</span>
              <span />
            </div>
            <div className="relative grid gap-4 bg-background/40 p-6">
              <ChatBubble role="bot">Hey! I'm Iris, the Linear support bot. How can I help?</ChatBubble>
              <ChatBubble role="user">How do I move an issue between teams?</ChatBubble>
              <ChatBubble role="bot">
                You can move an issue between teams by opening it and pressing <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px]">M</kbd> — then choose the destination team. Cycles and labels carry over automatically.
                <span className="mt-2 block text-[11px] text-muted-foreground">Source: docs.linear.app/issues/moving-issues</span>
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
      <div className="font-serif text-3xl tracking-tight md:text-4xl">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif text-4xl tracking-tight md:text-5xl">Built for product teams who hate chatbots.</h2>
        <p className="mt-4 text-muted-foreground">
          Most "AI support" widgets are dressed-up FAQ bots. AgentDesk reads your actual docs and reasons through requests
          like a thoughtful teammate.
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
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <Card className="overflow-hidden border-border/60 bg-card/40">
        <div className="grid items-center gap-10 p-8 md:grid-cols-2 md:p-12">
          <div>
            <Badge variant="secondary" className="mb-4 rounded-full">One line of code</Badge>
            <h3 className="font-serif text-3xl tracking-tight md:text-4xl">Paste this. That's the install.</h3>
            <p className="mt-3 text-muted-foreground">
              Drop the script before <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/body&gt;</code>. The bubble appears,
              connected to your KB. No build step, no SDK — works on Webflow, Shopify, WordPress, Next.js, anywhere.
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background p-5 font-mono text-sm shadow-inner">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>index.html</span>
              <span>copy</span>
            </div>
            <pre className="overflow-x-auto whitespace-pre text-[13px] leading-relaxed text-foreground/90">
{`<script
  src="https://agentdesk.app/widget.js"
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
    <section id="compare" className="mx-auto max-w-5xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif text-4xl tracking-tight md:text-5xl">AgentDesk vs. Intercom Fin</h2>
        <p className="mt-3 text-muted-foreground">
          Same job. A lot less setup. A lot less invoice.
        </p>
      </div>
      <Card className="mt-12 overflow-hidden border-border/60">
        <div className="grid grid-cols-[1fr_120px_120px] items-center border-b border-border/60 bg-card/60 px-6 py-4 text-sm font-medium">
          <div className="text-muted-foreground">Feature</div>
          <div className="text-center">AgentDesk</div>
          <div className="text-center text-muted-foreground">Intercom Fin</div>
        </div>
        {COMPARE.map((row, i) => (
          <div
            key={row.feature}
            className={[
              'grid grid-cols-[1fr_120px_120px] items-center px-6 py-4 text-sm',
              i % 2 === 0 ? 'bg-background/30' : '',
            ].join(' ')}
          >
            <div>{row.feature}</div>
            <div className="flex justify-center">
              {row.agentdesk ? <Check className="h-4 w-4 text-foreground" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
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
        <h2 className="font-serif text-4xl tracking-tight md:text-5xl">Pricing that scales with you, not against you.</h2>
        <p className="mt-3 text-muted-foreground">Start free. Upgrade when your visitors won't stop talking.</p>
      </div>
      <div className="mt-14 grid gap-6 md:grid-cols-2">
        <PricingCard
          name="Free"
          price="$0"
          period="forever"
          description="For solo builders shipping their first SaaS."
          features={[
            '1 site',
            '100 conversations / month',
            'Knowledge base auto-crawl',
            'Email escalation',
            'Community support',
          ]}
          cta={{ label: 'Start free', href: '/sign-up' }}
        />
        <PricingCard
          name="Pro"
          price="$49"
          period="per month"
          description="For growing teams that live in the dashboard."
          highlighted
          features={[
            '5 sites',
            'Unlimited conversations',
            'Priority knowledge base re-syncs',
            'Custom widget colors & copy',
            'Analytics & escalation rules',
            'Email support',
          ]}
          cta={{ label: 'Start 14-day trial', href: '/sign-up' }}
        />
      </div>
    </section>
  );
}

function PricingCard({
  name,
  price,
  period,
  description,
  features,
  highlighted,
  cta,
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: { label: string; href: string };
}) {
  return (
    <Card
      className={[
        'relative flex flex-col gap-6 border-border/60 p-8',
        highlighted ? 'border-foreground/40 bg-card/80 shadow-2xl shadow-black/30' : 'bg-card/30',
      ].join(' ')}
    >
      {highlighted && (
        <Badge className="absolute right-6 top-6 rounded-full bg-foreground text-background">Most popular</Badge>
      )}
      <CardHeader className="p-0">
        <CardTitle className="text-base font-medium uppercase tracking-wider text-muted-foreground">{name}</CardTitle>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-5xl tracking-tight">{price}</span>
          <span className="text-sm text-muted-foreground">{period}</span>
        </div>
        <CardDescription className="mt-2">{description}</CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-1 flex-col gap-3 p-0">
        {features.map((f) => (
          <div key={f} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
            <span>{f}</span>
          </div>
        ))}
      </CardContent>
      <Button asChild size="lg" variant={highlighted ? 'default' : 'outline'} className="w-full">
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    </Card>
  );
}

function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-center font-serif text-4xl tracking-tight md:text-5xl">Frequently asked</h2>
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
        <h2 className="mx-auto max-w-2xl font-serif text-4xl tracking-tight md:text-5xl">
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
          <span className="font-serif text-base text-foreground">AgentDesk</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href="#features" className="transition hover:text-foreground">Features</a>
          <a href="#compare" className="transition hover:text-foreground">vs Intercom</a>
          <a href="#pricing" className="transition hover:text-foreground">Pricing</a>
          <a href="#faq" className="transition hover:text-foreground">FAQ</a>
        </div>
        <div>© {new Date().getFullYear()} AgentDesk</div>
      </div>
    </footer>
  );
}
