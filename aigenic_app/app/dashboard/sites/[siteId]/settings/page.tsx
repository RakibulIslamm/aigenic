import { notFound } from 'next/navigation';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser } from '@/lib/sites/queries';
import { DEFAULT_WIDGET_CONFIG } from '@/lib/sites/schemas';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { env } from '@/lib/env';
import { CRAWLER_UA_TOKEN } from '@/lib/sites/crawler-identity';
import {
  CRAWL_VERIFY_HEADER,
  DNS_TXT_SUBDOMAIN,
  WELL_KNOWN_PATH,
  dnsRecordValue,
  hostnameOf,
} from '@/lib/sites/verification';
import { SettingsForm } from '../_components/settings-form';
import { DeleteSiteButton } from '../_components/delete-site-button';
import { DomainVerification } from '../_components/domain-verification';

export default async function SiteSettingsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const widgetConfig = site.widgetConfig ?? DEFAULT_WIDGET_CONFIG;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-heading text-2xl tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit how this site is named, where escalations go, and how the widget looks.
        </p>
      </header>

      <SettingsForm
        siteId={siteId}
        initial={{
          name: site.name,
          domain: site.domain,
          escalationEmail: site.escalationEmail,
          primaryColor: widgetConfig.primaryColor,
          greeting: widgetConfig.greeting,
          botName: widgetConfig.botName,
        }}
      />

      <DomainVerification
        siteId={siteId}
        domain={site.domain}
        verificationToken={site.verificationToken}
        crawlSecret={site.crawlSecret}
        verifiedAt={site.verifiedAt}
        verificationMethod={site.verificationMethod}
        crawlerIp={env.SCRAPER_EGRESS_IP ?? null}
        dnsRecordName={`${DNS_TXT_SUBDOMAIN}.${hostnameOf(site.domain)}`}
        dnsRecordValue={dnsRecordValue(site.verificationToken)}
        wellKnownPath={WELL_KNOWN_PATH}
        verifyHeader={CRAWL_VERIFY_HEADER}
        userAgentToken={CRAWLER_UA_TOKEN}
      />

      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting a site removes its knowledge base, conversations, and widget.
            Visitors will stop seeing the bubble immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteSiteButton siteId={siteId} siteName={site.name} />
        </CardContent>
      </Card>
    </div>
  );
}
