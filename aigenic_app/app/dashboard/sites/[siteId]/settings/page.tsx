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
import { isCredentialEncryptionConfigured } from '@/lib/crypto/secrets';
import { getDnsConnectionSummary } from '@/lib/dns/connections';
import { SettingsForm } from '../_components/settings-form';
import { DeleteSiteButton } from '../_components/delete-site-button';
import { CrawlAccess } from '../_components/crawl-access';

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
  // Summary only — the credentials column never leaves `lib/dns/connections.ts`.
  const dnsConnection = site.dnsConnectionId
    ? await getDnsConnectionSummary(site.dnsConnectionId, userId)
    : null;

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

      <CrawlAccess
        siteId={siteId}
        domain={site.domain}
        crawlHost={site.crawlHost}
        crawlOriginIp={site.crawlOriginIp}
        dnsZoneName={site.dnsZoneName}
        crawlHostCreatedAt={site.crawlHostCreatedAt}
        connection={
          dnsConnection
            ? {
                id: dnsConnection.id,
                provider: dnsConnection.provider,
                label: dnsConnection.label,
              }
            : null
        }
        encryptionConfigured={isCredentialEncryptionConfigured()}
        egressIp={env.SCRAPER_EGRESS_IP ?? null}
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
