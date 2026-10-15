'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FilePlus2, Loader2, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field } from '@/components/field';
import {
  MANUAL_TEXT_MAX_CHARS,
  MANUAL_UPLOAD_EXTENSIONS,
  MANUAL_UPLOAD_MAX_BYTES,
  MANUAL_UPLOAD_MAX_FILES,
} from '@/lib/sites/limits';
import {
  addTextDocumentAction,
  uploadDocumentAction,
  type ActionState,
} from '@/app/dashboard/actions';

type FileStatus = {
  name: string;
  state: 'queued' | 'uploading' | 'done' | 'failed';
  /** Full sentence, file name included (the server's errors name the file). */
  error?: string;
};

const MAX_MB = MANUAL_UPLOAD_MAX_BYTES / 1024 / 1024;
const ACCEPTED = new Set<string>(MANUAL_UPLOAD_EXTENSIONS);

/** Why the server would refuse this file — checked first to skip the round trip. */
function precheck(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!ACCEPTED.has(ext)) {
    return `${file.name}: unsupported file type. Use ${MANUAL_UPLOAD_EXTENSIONS.join(', ')}.`;
  }
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > MANUAL_UPLOAD_MAX_BYTES) {
    return `${file.name} is over ${MAX_MB} MB — split it into smaller files.`;
  }
  return null;
}

/**
 * Adds content to the knowledge base without the crawler: upload files (PDF,
 * Word, Markdown, HTML, text, CSV) or paste text. Works whatever the site's
 * firewall does, and survives every re-crawl.
 */
export function AddContentDialog({
  siteId,
  variant = 'outline',
}: {
  siteId: string;
  variant?: 'outline' | 'default';
}) {
  const [open, setOpen] = useState(false);
  // While files are uploading the dialog stays open: closing it would hide
  // the progress (and the per-file errors) while requests keep running.
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) {
          toast.info('Uploading — the window closes when it finishes.');
          return;
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <FilePlus2 className="mr-1 h-4 w-4" />
          Add content
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">Add content</DialogTitle>
          <DialogDescription>
            Upload documents or paste text the assistant should answer from. Added content
            is live immediately, isn&apos;t affected by your site&apos;s firewall, and is
            kept across re-crawls.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="upload" className="mt-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" disabled={busy}>
              Upload files
            </TabsTrigger>
            <TabsTrigger value="paste" disabled={busy}>
              Paste text
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="pt-3">
            <UploadForm
              siteId={siteId}
              onBusyChange={setBusy}
              onDone={() => setOpen(false)}
            />
          </TabsContent>
          <TabsContent value="paste" className="pt-3">
            <PasteForm siteId={siteId} onDone={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  siteId,
  onBusyChange,
  onDone,
}: {
  siteId: string;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [pending, startTransition] = useTransition();

  const setStatus = (index: number, patch: Partial<FileStatus>) =>
    setStatuses((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function choose(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    setStatuses([]);
    if (chosen.length > MANUAL_UPLOAD_MAX_FILES) {
      toast.error(
        `Choose up to ${MANUAL_UPLOAD_MAX_FILES} files at a time — you picked ${chosen.length}.`,
      );
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFiles(chosen);
  }

  function upload() {
    if (files.length === 0) return;
    const batch = files;
    setStatuses(batch.map((f) => ({ name: f.name, state: 'queued' })));
    onBusyChange(true);
    startTransition(async () => {
      const failed: File[] = [];
      try {
        // One request per file: each stays under the body limit, and one bad
        // file reports its own error instead of failing the batch.
        for (const [i, file] of batch.entries()) {
          const refused = precheck(file);
          if (refused) {
            setStatus(i, { state: 'failed', error: refused });
            failed.push(file);
            continue;
          }
          setStatus(i, { state: 'uploading' });
          const fd = new FormData();
          fd.set('file', file);
          let result: ActionState;
          try {
            result = await uploadDocumentAction(siteId, fd);
          } catch {
            result = {
              ok: false,
              error: `${file.name}: upload failed — check your connection and try again.`,
            };
          }
          if (result.ok) {
            setStatus(i, { state: 'done' });
          } else {
            setStatus(i, { state: 'failed', error: result.error });
            failed.push(file);
          }
        }
      } finally {
        onBusyChange(false);
      }

      const added = batch.length - failed.length;
      if (added > 0) router.refresh();
      // Only what failed stays selected, so "Upload" again retries those —
      // never re-sends a file that already went in.
      setFiles(failed);
      if (failed.length === 0) {
        toast.success(added === 1 ? 'Document added' : `${added} documents added`);
        setStatuses([]);
        if (inputRef.current) inputRef.current.value = '';
        onDone();
      } else if (added > 0) {
        toast.warning(`${added} of ${batch.length} added — see the errors below.`);
      } else {
        toast.error('Nothing was added — see the errors below.');
      }
    });
  }

  const retrying = statuses.some((s) => s.state === 'failed') && !pending;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="kb-files">Files</Label>
        <input
          ref={inputRef}
          id="kb-files"
          type="file"
          multiple
          accept={MANUAL_UPLOAD_EXTENSIONS.join(',')}
          disabled={pending}
          onChange={(e) => choose(e.target.files)}
          className="block w-full cursor-pointer rounded-md border border-input bg-transparent text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-input file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
        />
        <p className="text-xs text-muted-foreground">
          PDF, Word (.docx), Markdown, HTML, text or CSV — up to {MAX_MB} MB each,{' '}
          {MANUAL_UPLOAD_MAX_FILES} files at a time. Scanned PDFs need selectable text.
        </p>
      </div>

      {statuses.length > 0 && (
        <ul className="grid gap-1.5 text-xs" aria-live="polite">
          {statuses.map((s, i) => (
            // Index keys: two files can share a name (picked from different
            // folders), and the list is replaced wholesale, never reordered.
            <li key={i} className="flex items-start gap-2">
              {s.state === 'done' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : s.state === 'failed' ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <Loader2
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground ${s.state === 'uploading' ? 'animate-spin' : ''}`}
                />
              )}
              <span className="min-w-0 break-words">
                {s.error ? (
                  <span className="text-destructive">{s.error}</span>
                ) : (
                  <span className="text-foreground">{s.name}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" onClick={upload} disabled={pending || files.length === 0}>
          {pending ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Uploading
            </>
          ) : (
            <>
              <Upload className="mr-1 h-4 w-4" />
              {retrying ? 'Retry failed' : 'Upload'}
              {files.length > 1 ? ` ${files.length} files` : ''}
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

function PasteForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState | undefined, FormData>(
    async (prev, formData) => {
      try {
        return await addTextDocumentAction(siteId, prev, formData);
      } catch {
        // The request itself failed (offline, deploy in progress). Keep what
        // they typed — losing a long paste to a network blip is the worst
        // outcome here.
        return {
          ok: false,
          error: 'Could not reach the server — check your connection and try again.',
          values: {
            title: String(formData.get('title') ?? ''),
            content: String(formData.get('content') ?? ''),
          },
        };
      }
    },
    undefined,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? 'Added to the knowledge base');
      router.refresh();
      onDone();
    } else if (!state.fieldErrors) {
      toast.error(state.error);
    }
    // `onDone` is a fresh closure each render; the result is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const values = state && !state.ok ? (state.values ?? {}) : {};

  return (
    <form
      key={state && !state.ok ? `err-${values.title ?? ''}` : 'fresh'}
      action={formAction}
      className="grid gap-4"
    >
      <Field
        id="title"
        label="Title"
        placeholder="Shipping & returns policy"
        error={fieldErrors.title}
        defaultValue={values.title}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          name="content"
          rows={10}
          maxLength={MANUAL_TEXT_MAX_CHARS}
          placeholder="Paste the text of a page, an FAQ, a policy…"
          defaultValue={values.content}
          aria-invalid={Boolean(fieldErrors.content)}
          className="max-h-72"
        />
        {fieldErrors.content ? (
          <p className="text-xs text-destructive">{fieldErrors.content}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Plain text or Markdown. Blank lines separate paragraphs.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Adding
            </>
          ) : (
            'Add to knowledge base'
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
