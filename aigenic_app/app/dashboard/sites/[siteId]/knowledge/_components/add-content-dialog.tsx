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
} from '@/lib/sites/limits';
import {
  addTextDocumentAction,
  uploadDocumentAction,
  type ActionState,
} from '@/app/dashboard/actions';

type FileStatus = {
  name: string;
  state: 'queued' | 'uploading' | 'done' | 'failed';
  error?: string;
};

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <TabsTrigger value="upload">Upload files</TabsTrigger>
            <TabsTrigger value="paste">Paste text</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="pt-3">
            <UploadForm siteId={siteId} onDone={() => setOpen(false)} />
          </TabsContent>
          <TabsContent value="paste" className="pt-3">
            <PasteForm siteId={siteId} onDone={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [pending, startTransition] = useTransition();
  const maxMb = MANUAL_UPLOAD_MAX_BYTES / 1024 / 1024;

  const setStatus = (index: number, patch: Partial<FileStatus>) =>
    setStatuses((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function upload() {
    if (files.length === 0) return;
    setStatuses(files.map((f) => ({ name: f.name, state: 'queued' })));
    startTransition(async () => {
      let added = 0;
      // One request per file: each stays under the body limit, and one bad
      // file reports its own error instead of failing the batch.
      for (const [i, file] of files.entries()) {
        if (file.size > MANUAL_UPLOAD_MAX_BYTES) {
          setStatus(i, { state: 'failed', error: `Over ${maxMb} MB` });
          continue;
        }
        setStatus(i, { state: 'uploading' });
        const fd = new FormData();
        fd.set('file', file);
        let result: ActionState;
        try {
          result = await uploadDocumentAction(siteId, fd);
        } catch {
          result = { ok: false, error: 'Upload failed — check your connection.' };
        }
        if (result.ok) {
          added++;
          setStatus(i, { state: 'done' });
        } else {
          setStatus(i, { state: 'failed', error: result.error });
        }
      }
      router.refresh();
      if (added === files.length) {
        toast.success(added === 1 ? 'Document added' : `${added} documents added`);
        setFiles([]);
        setStatuses([]);
        if (inputRef.current) inputRef.current.value = '';
        onDone();
      } else if (added > 0) {
        toast.warning(`${added} of ${files.length} added — see the errors below.`);
      } else {
        toast.error('Nothing was added — see the errors below.');
      }
    });
  }

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
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setStatuses([]);
          }}
          className="block w-full cursor-pointer rounded-md border border-input bg-transparent text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-input file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
        />
        <p className="text-xs text-muted-foreground">
          PDF, Word (.docx), Markdown, HTML, text or CSV — up to {maxMb} MB each. Scanned
          PDFs need selectable text.
        </p>
      </div>

      {statuses.length > 0 && (
        <ul className="grid gap-1.5 text-xs">
          {statuses.map((s) => (
            <li key={s.name} className="flex items-start gap-2">
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
                <span className="text-foreground">{s.name}</span>
                {s.error ? <span className="text-destructive"> — {s.error}</span> : null}
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
              Upload {files.length > 1 ? `${files.length} files` : ''}
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
    addTextDocumentAction.bind(null, siteId),
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
