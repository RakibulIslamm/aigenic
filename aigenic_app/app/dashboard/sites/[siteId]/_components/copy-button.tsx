'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success('Copied to clipboard');
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy — copy it manually');
        }
      }}
    >
      {copied ? (
        <>
          <Check className="mr-1 h-4 w-4" />
          Copied
        </>
      ) : (
        <>
          <Copy className="mr-1 h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
