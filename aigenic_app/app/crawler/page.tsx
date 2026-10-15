import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, Clock, ShieldCheck, SlashSquare } from 'lucide-react';
import { env } from '@/lib/env';
import {
  CRAWLER_ACCESS_HEADER,
  CRAWLER_UA_TOKEN,
  CRAWLER_USER_AGENT,
} from '@/lib/sites/crawler-identity';

/**
 * Public documentation for AigenicBot.
 *
 * Its readers arrive from a server log or a firewall event, not from the
 * marketing site: an operator who saw an unfamiliar User-Agent, or a site
 * owner setting up the allow rule. Both need the same facts — who runs it,
 * why it visited, how to recognise it, how to allow or block it.
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
        business adds its site, we read that site&apos;s pages so its assistant can answer
        visitors&apos; questions from its own content.
      </p>

      <Section title="Why AigenicBot visited your site" icon={SlashSquare}>
        <p>
          An Aigenic account holder added this domain and asked us to build its knowledge
          base. We crawl only domains an account holder has added, and only pages on that
          domain — we never follow links onto other sites or crawl the open web.
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
          token.
        </p>
        {egressIp ? (
          <p>
            Our crawl traffic comes from a fixed address:{' '}
            <code className="rounded bg-muted px-1 py-0.5">{egressIp}</code>. A User-Agent
            alone is not proof — anyone can send that string — so check the source address
            if it matters.
          </p>
        ) : null}
        <p>
          Requests also carry an{' '}
          <code className="rounded bg-muted px-1 py-0.5">{CRAWLER_ACCESS_HEADER}</code>{' '}
          header holding a private key that only we and that site&apos;s owner know. It is
          sent only to the site it belongs to.
        </p>
      </Section>

      <Section title="How we behave" icon={Clock}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A few concurrent requests at most, with a delay between them.</li>
          <li>
            Where a site publishes its catalogue through a documented API (Shopify,
            WordPress, WooCommerce) we read that instead of every page — far fewer
            requests.
          </li>
          <li>
            Each crawl has a page budget and finishes; we don&apos;t linger on your site.
          </li>
          <li>We never try to get around a firewall, CAPTCHA or bot check.</li>
        </ul>
      </Section>

      <Section title="If this is your site: allow AigenicBot" icon={ShieldCheck}>
        <p>
          Sign in to Aigenic and open your site&apos;s{' '}
          <span className="text-foreground">Settings → Crawler access</span>. It gives you
          a ready-made firewall rule that matches your private access key in the{' '}
          <code className="rounded bg-muted px-1 py-0.5">{CRAWLER_ACCESS_HEADER}</code>{' '}
          header, and a button to test it. A rule on that key admits only us; a rule on
          the User-Agent would admit anyone who copies it.
        </p>
      </Section>

      <Section title="If it isn't: block AigenicBot" icon={SlashSquare}>
        <p>
          Block requests whose User-Agent contains{' '}
          <code className="rounded bg-muted px-1 py-0.5">{CRAWLER_UA_TOKEN}</code>
          {egressIp ? (
            <>
              {' '}
              or that come from{' '}
              <code className="rounded bg-muted px-1 py-0.5">{egressIp}</code>
            </>
          ) : null}{' '}
          in your firewall. We treat a refusal as final and report the crawl to the
          account holder as failed.
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
