'use client';

import { useState, useTransition, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  connectDnsProviderAction,
  disconnectDnsAction,
  enableCrawlHostAction,
  listZonesAction,
  refreshCrawlHostAction,
  type DnsActionState,
  type DnsZoneOption,
} from '@/app/dashboard/dns-actions';
import { DNS_PROVIDER_LIST, dnsProviderLabel } from '@/lib/dns/catalog';
import { crawlHostFor, hostnameOf } from '@/lib/sites/domains';
import { CopyButton } from './copy-button';

/**
 * The "crawler access" card on a site's Settings tab.
 *
 * Normal crawling needs nothing here. This exists for the one situation the
 * customer can't talk their way out of: their own WAF or CDN answers our
 * crawler with 403, and the only party who can change that is them. Rather
 * than asking them to hand-write a firewall rule, they connect the DNS
 * provider they already use and we create one record — `crawl.<domain>`,
 * pointed straight at their origin, unproxied — that the crawler fetches
 * through instead.
 *
 * Three states, in the order a customer moves through them: connect a
 * provider, pick the zone, done. Each step's inputs come back from the server,
 * so a half-finished attempt resumes rather than restarting.
 */
export function CrawlAccess({
  siteId,
  domain,
  crawlHost,
  crawlOriginIp,
  dnsZoneName,
  crawlHostCreatedAt,
  connection,
  encryptionConfigured,
  egressIp,
}: {
  siteId: string;
  domain: string;
  crawlHost: string | null;
  crawlOriginIp: string | null;
  dnsZoneName: string | null;
  crawlHostCreatedAt: Date | null;
  connection: { id: string; provider: string; label: string } | null;
  /** False when CREDENTIALS_ENCRYPTION_KEY is unset — we refuse to store keys. */
  encryptionConfigured: boolean;
  /** Our stable egress address, shown for Namecheap's IP allowlist. */
  egressIp: string | null;
}) {
  const siteHost = hostnameOf(domain);
  const plannedHost = crawlHostFor(domain);

  const [zones, setZones] = useState<DnsZoneOption[] | null>(null);
  const [zoneConnectionId, setZoneConnectionId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');

  function applyZones(state: Extract<DnsActionState, { ok: true }>) {
    if (!state.zones || !state.connectionId) return;
    setZones(state.zones);
    setZoneConnectionId(state.connectionId);
    setSelectedZoneId(state.suggestedZoneId ?? state.zones[0]?.id ?? '');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {crawlHost ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <Globe2 className="h-5 w-5 text-muted-foreground" />
          )}
          Crawler access
          {crawlHost && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Direct route active
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {crawlHost
            ? `We fetch this site's pages through ${crawlHost}, which points straight at your origin.`
            : `We crawl ${siteHost} the same way a visitor loads it. If your firewall or CDN blocks that, connect your DNS provider and we'll create ${plannedHost} pointing at your origin — one record, no manual steps.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {crawlHost ? (
          <ActivePanel
            siteId={siteId}
            crawlHost={crawlHost}
            crawlOriginIp={crawlOriginIp}
            dnsZoneName={dnsZoneName}
            crawlHostCreatedAt={crawlHostCreatedAt}
            connection={connection}
          />
        ) : zones && zoneConnectionId ? (
          <ZonePanel
            siteId={siteId}
            connectionId={zoneConnectionId}
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelect={setSelectedZoneId}
            plannedHost={plannedHost}
          />
        ) : connection ? (
          <ReconnectPanel
            siteId={siteId}
            connection={connection}
            onZones={applyZones}
            onForget={() => {
              setZones(null);
              setZoneConnectionId(null);
            }}
          />
        ) : (
          <ConnectPanel
            siteId={siteId}
            enabled={encryptionConfigured}
            egressIp={egressIp}
            onZones={applyZones}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ActivePanel({
  siteId,
  crawlHost,
  crawlOriginIp,
  dnsZoneName,
  crawlHostCreatedAt,
  connection,
}: {
  siteId: string;
  crawlHost: string;
  crawlOriginIp: string | null;
  dnsZoneName: string | null;
  crawlHostCreatedAt: Date | null;
  connection: { id: string; provider: string; label: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<'refresh' | 'disconnect' | null>(null);

  function run(kind: 'refresh' | 'disconnect') {
    setAction(kind);
    startTransition(async () => {
      const result =
        kind === 'refresh'
          ? await refreshCrawlHostAction(siteId)
          : await disconnectDnsAction(siteId);
      setAction(null);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <>
      <dl className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-4">
        <Row label="Crawl hostname" value={crawlHost} copyable />
        <Row label="Origin" value={crawlOriginIp ?? 'unknown'} />
        {dnsZoneName && <Row label="Zone" value={dnsZoneName} />}
        {connection && (
          <Row
            label="Provider"
            value={`${dnsProviderLabel(connection.provider)} · ${connection.label}`}
          />
        )}
        {crawlHostCreatedAt && (
          <Row label="Created" value={crawlHostCreatedAt.toLocaleString()} />
        )}
      </dl>

      <p className="text-xs text-muted-foreground">
        Because the record bypasses your CDN, its certificate won&apos;t match this
        hostname — that&apos;s expected, and only our crawler ever visits it. Your
        visitors keep using {crawlHost.replace(/^crawl\./, '')} as before.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run('refresh')}
        >
          {pending && action === 'refresh' ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Re-detect origin
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run('disconnect')}
        >
          {pending && action === 'disconnect' ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="mr-1 h-4 w-4" />
          )}
          Disconnect
        </Button>
      </div>
    </>
  );
}

function ZonePanel({
  siteId,
  connectionId,
  zones,
  selectedZoneId,
  onSelect,
  plannedHost,
}: {
  siteId: string;
  connectionId: string;
  zones: DnsZoneOption[];
  selectedZoneId: string;
  onSelect: (id: string) => void;
  plannedHost: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="dns-zone">Zone</Label>
        <select
          id="dns-zone"
          value={selectedZoneId}
          onChange={(event) => onSelect(event.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          We&apos;ll read this zone&apos;s existing records to find your origin, then
          create <code className="rounded bg-muted px-1 py-0.5">{plannedHost}</code>{' '}
          pointing at it — unproxied, so it resolves straight to your server.
        </p>
      </div>

      <div>
        <Button
          disabled={pending || !selectedZoneId}
          onClick={() => {
            startTransition(async () => {
              const result = await enableCrawlHostAction(
                siteId,
                connectionId,
                selectedZoneId,
              );
              if (result.ok) toast.success(result.message);
              else toast.error(result.error);
            });
          }}
        >
          {pending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Globe2 className="mr-1 h-4 w-4" />
          )}
          Create crawl subdomain
        </Button>
      </div>
    </>
  );
}

function ReconnectPanel({
  siteId,
  connection,
  onZones,
  onForget,
}: {
  siteId: string;
  connection: { id: string; provider: string; label: string };
  onZones: (state: Extract<DnsActionState, { ok: true }>) => void;
  onForget: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="rounded-lg border border-border/60 bg-background/50 p-4 text-sm">
        <p className="font-medium">
          Connected to {dnsProviderLabel(connection.provider)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{connection.label}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await listZonesAction(siteId, connection.id);
              if (result.ok) onZones(result);
              else toast.error(result.error);
            });
          }}
        >
          {pending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Globe2 className="mr-1 h-4 w-4" />
          )}
          Choose a zone
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await disconnectDnsAction(siteId);
              onForget();
              if (result.ok) toast.success(result.message);
              else toast.error(result.error);
            });
          }}
        >
          <Unplug className="mr-1 h-4 w-4" />
          Use a different provider
        </Button>
      </div>
    </>
  );
}

function ConnectPanel({
  siteId,
  enabled,
  egressIp,
  onZones,
}: {
  siteId: string;
  enabled: boolean;
  egressIp: string | null;
  onZones: (state: Extract<DnsActionState, { ok: true }>) => void;
}) {
  const [providerId, setProviderId] = useState<string>(DNS_PROVIDER_LIST[0]?.id ?? '');
  const [fieldError, setFieldError] = useState<{
    field?: string;
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const provider =
    DNS_PROVIDER_LIST.find((candidate) => candidate.id === providerId) ??
    DNS_PROVIDER_LIST[0];

  if (!enabled) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This deployment has no credential encryption key configured, so we won&apos;t
          accept DNS API keys. Set <code>CREDENTIALS_ENCRYPTION_KEY</code> to enable this.
        </span>
      </p>
    );
  }

  if (!provider) return null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFieldError(null);
    startTransition(async () => {
      const result = await connectDnsProviderAction(siteId, undefined, formData);
      if (result.ok) {
        toast.success(result.message);
        onZones(result);
      } else {
        setFieldError({
          message: result.error,
          ...(result.field ? { field: result.field } : {}),
        });
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="provider" value={provider.id} />

      <div className="grid gap-1.5">
        <Label htmlFor="dns-provider">DNS provider</Label>
        <select
          id="dns-provider"
          value={provider.id}
          onChange={(event) => {
            setProviderId(event.target.value);
            setFieldError(null);
          }}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {DNS_PROVIDER_LIST.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {provider.help}{' '}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            Open {provider.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {provider.caveats && provider.caveats.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {provider.caveats.map((caveat) => (
            <li key={caveat} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>{caveat}</span>
            </li>
          ))}
          {provider.id === 'namecheap' && egressIp && (
            <li className="flex gap-2">
              <span aria-hidden>·</span>
              <span>
                Allowlist{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {egressIp}
                </code>{' '}
                and enter it below.
              </span>
            </li>
          )}
        </ul>
      )}

      {provider.credentialFields.map((field) => (
        <div key={field.name} className="grid gap-1.5">
          <Label htmlFor={`dns-${field.name}`}>
            {field.label}
            {field.optional && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (optional)
              </span>
            )}
          </Label>
          {field.type === 'textarea' ? (
            <Textarea
              id={`dns-${field.name}`}
              name={field.name}
              rows={6}
              placeholder={field.placeholder ?? ''}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              aria-invalid={fieldError?.field === field.name}
            />
          ) : (
            <Input
              id={`dns-${field.name}`}
              name={field.name}
              type={field.type === 'password' ? 'password' : 'text'}
              placeholder={field.placeholder ?? ''}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={fieldError?.field === field.name}
            />
          )}
          {fieldError?.field === field.name ? (
            <p className="text-xs text-destructive">{fieldError.message}</p>
          ) : field.help ? (
            <p className="text-xs text-muted-foreground">{field.help}</p>
          ) : null}
        </div>
      ))}

      {fieldError && !fieldError.field && (
        <p className="text-xs text-destructive">{fieldError.message}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plug className="mr-1 h-4 w-4" />
          )}
          Connect and list zones
        </Button>
        <p className="text-xs text-muted-foreground">
          Stored encrypted. We only ever read your zones and create one record.
        </p>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">
        <code className="block truncate rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-xs">
          {value}
        </code>
      </dd>
      {copyable && <CopyButton value={value} />}
    </div>
  );
}
