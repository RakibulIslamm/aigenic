import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, Clock, Mail, ShieldCheck, SlashSquare } from 'lucide-react';
import { env } from '@/lib/env';
import { CRAWLER_UA_TOKEN, CRAWLER_USER_AGENT } from '@/lib/sites/crawler-identity';
import { CRAWL_VERIFY_HEADER } from '@/lib/sites/verification';

/**
 * Public documentation for AigenicBot.
 *
 * Two audiences, both of whom arrive from a server log rather than from the
 * marketing site: an operator who saw an unfamiliar User-Agent and wants to
 * know what it is, and a bot-directory reviewer (Cloudflare's Verified Bots
 * programme asks for exactly this page before listing a crawler). Both need
 * the same things — who runs it, why it visited, and how to stop it — so the
 * page states them plainly and puts opting out above asking to be allowed.
 */
export const metadata: Metadata = {
  title: 'AigenicBot — our web crawler',
  description:
    'What AigenicBot is, why it visited your site, how to identify it, and how to allow or block it.',
};

export default function CrawlerInfoPage() {
  const egressIp = env.SCRAPER_EGRESS_IP;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center gap-3">
        <Bot className="h-8 w-8 text-primary" />
        <h1 className="font-heading text-3xl tracking-tight md:text-4xl">AigenicBot</h1>
      </div>

      <p className="mt-4 text-lg text-muted-foreground">
        AigenicBot is the web crawler for{' '}
        <Link href="/" className="text-foreground underline underline-offset-4">
          Aigenic
        </Link>
        , a customer-support assistant that businesses add to their own websites. When a
        customer signs up, we read the pages of <em>their</em> site so their support
        assistant can answer questions about their products from their own content.
      </p>

      <Section title="Why AigenicBot visited your site" icon={SlashSquare}>
        <p>
          Someone using Aigenic asked us to build a support assistant for this domain. We
          only crawl a site after an account holder has enrolled it, and we crawl nothing
          else — no link-following onto third-party domains, no discovery crawling of the
          open web.
        </p>
        <p>
          If you did not enrol this site and don&apos;t recognise the request, that is
          worth telling us about. Block us using the instructions below and email{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href="mailto:abuse@aigenic.app"
          >
            abuse@aigenic.app
          </a>{' '}
          — we will stop crawling the domain.
        </p>
      </Section>

      <Section title="How to identify AigenicBot" icon={ShieldCheck}>
        <p>Every request we make carries this User-Agent:</p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-3 text-xs">
          {CRAWLER_USER_AGENT}
        </pre>
        <p>
          The distinguishing part is the{' '}
          <code className="rounded bg-muted px-1 py-0.5">{CRAWLER_UA_TOKEN}</code> product
          token; robots.txt can address us by that name.
        </p>
        {egressIp ? (
          <p>
            All of our crawl traffic originates from a single fixed address:{' '}
            <code className="rounded bg-muted px-1 py-0.5">{egressIp}</code>. A User-Agent
            alone is not proof — anyone can send that string — so check the source address
            if it matters.
          </p>
        ) : null}
        <p>
          Crawls for a verified site owner also carry an{' '}
          <code className="rounded bg-muted px-1 py-0.5">{CRAWL_VERIFY_HEADER}</code>{' '}
          header holding a secret shared only with that owner. That is the only signal
          that cannot be spoofed, and it is what we ask owners to match when they want to
          allow us through a firewall.
        </p>
      </Section>

      <Section title="How we behave" icon={Clock}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            We fetch and obey{' '}
            <code className="rounded bg-muted px-1 py-0.5">/robots.txt</code> before
            anything else, including any{' '}
            <code className="rounded bg-muted px-1 py-0.5">Crawl-delay</code> you set.
          </li>
          <li>At most 3 concurrent requests, with a delay between them.</li>
          <li>
            Only pages on the enrolled domain. We never follow links off-site, and we
            never crawl subdomains that weren&apos;t enrolled.
          </li>
          <li>
            We read page text to answer that site&apos;s own support questions. We do not
            use your content to train AI models.
          </li>
          <li>
            A crawl is bounded by a page budget and finishes; we do not idle on your site.
          </li>
        </ul>
      </Section>

      <Section title="How to block AigenicBot" icon={SlashSquare}>
        <p>
          Add this to your{' '}
          <code className="rounded bg-muted px-1 py-0.5">/robots.txt</code> and we will
          stop on the next crawl:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-3 text-xs">
          {`User-agent: ${CRAWLER_UA_TOKEN}\nDisallow: /`}
        </pre>
        <p>
          You do not need our permission and you do not need to tell us. A firewall block
          works too — we treat a refusal as a refusal and report it to the account holder
          as a site they need to sort out with you.
        </p>
      </Section>

      <Section title="How to allow AigenicBot" icon={ShieldCheck}>
        <p>
          If this is your site and you <em>want</em> the assistant to work, the fix
          belongs in your dashboard, not here: verify the domain under{' '}
          <span className="text-foreground">Settings → Domain ownership</span>, then allow
          the <code className="rounded bg-muted px-1 py-0.5">{CRAWL_VERIFY_HEADER}</code>{' '}
          header value it gives you. A rule matching that secret admits only us; a rule
          matching a User-Agent admits anyone who types it.
        </p>
      </Section>

      <Section title="Contact" icon={Mail}>
        <p>
          Questions, complaints, or a request to stop:{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href="mailto:abuse@aigenic.app"
          >
            abuse@aigenic.app
          </a>
          . We answer crawler mail from real people.
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Bot;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-heading text-xl tracking-tight">
        <Icon className="h-5 w-5 text-muted-foreground" />
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
