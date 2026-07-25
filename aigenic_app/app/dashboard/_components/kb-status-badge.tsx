import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleStop,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type KbStatus = 'pending' | 'crawling' | 'ready' | 'failed' | 'stopped' | string;

export function KbStatusBadge({ status }: { status: KbStatus }) {
  switch (status) {
    case 'ready':
      return (
        <Badge variant="secondary" className="gap-1 rounded-full">
          <CheckCircle2 className="h-3 w-3" />
          Ready
        </Badge>
      );
    case 'crawling':
      return (
        <Badge variant="secondary" className="gap-1 rounded-full">
          <Loader2 className="h-3 w-3 animate-spin" />
          Crawling
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="gap-1 rounded-full">
          <CircleAlert className="h-3 w-3" />
          Failed
        </Badge>
      );
    case 'stopped':
      return (
        <Badge variant="secondary" className="gap-1 rounded-full">
          <CircleStop className="h-3 w-3" />
          Stopped
        </Badge>
      );
    case 'pending':
    default:
      return (
        <Badge variant="secondary" className="gap-1 rounded-full">
          <CircleDashed className="h-3 w-3" />
          Pending
        </Badge>
      );
  }
}
