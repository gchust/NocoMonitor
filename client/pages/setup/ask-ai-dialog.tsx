import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ComponentProps, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';

import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';

import type { Setup, SetupKind } from '../../lib/monitoring.js';
import { setupErrorText } from './setup-errors.js';

/** How many examples each kind offers: `monitoring.setup.ask.<kind>.examples.<n>`. */
const EXAMPLES = 3;

/**
 * Where setting up with the agent starts: the person says in their own words what to monitor, or what status page they
 * want, and lands on the conversation. Nothing is created before they apply what the agent proposes.
 */
export function AskAiDialog({
  kind,
  open,
  onOpenChange,
}: {
  readonly kind: SetupKind;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const copy = (key: string) => t(`monitoring.setup.ask.${kind}.${key}`);

  const start = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.request<{ data: Setup }>({
        path: 'monitoringSetups',
        method: 'POST',
        json: {
          kind,
          text: text.trim(),
          language: i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US',
        },
      });
      onOpenChange(false);
      setText('');
      void navigate(`/setup/${encodeURIComponent(data.id)}`);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.reason === 'AI_NOT_CONFIGURED'
      )
        setNotConfigured(true);
      else toaster.show({ type: 'error', title: setupErrorText(error, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <SparklesIcon className='size-4 text-primary' />
            {copy('title')}
          </DialogTitle>
          <DialogDescription>{copy('description')}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void start();
            }
          }}
          placeholder={copy('placeholder')}
          aria-label={copy('title')}
          className='min-h-28'
          autoFocus
          maxLength={4000}
        />
        <div className='flex flex-wrap gap-2'>
          {Array.from({ length: EXAMPLES }, (_, index) => {
            const example = copy(`examples.${index}`);
            return (
              <Button
                key={index}
                type='button'
                variant='outline'
                size='sm'
                className='h-auto max-w-full py-1 text-left font-normal whitespace-normal text-muted-foreground'
                onClick={() => setText(example)}
              >
                {example}
              </Button>
            );
          })}
        </div>
        {notConfigured ? (
          <Alert>
            <AlertDescription>
              {t('monitoring.setup.errors.notConfigured')}{' '}
              <Link to='/ai' className='font-medium underline'>
                {t('monitoring.setup.errors.openAiSettings')}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <p className='mr-auto self-center text-xs text-muted-foreground'>
            {t('monitoring.setup.ask.safe')}
          </p>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('monitoring.actions.cancel')}
          </Button>
          <Button onClick={() => void start()} disabled={!text.trim() || busy}>
            {busy ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <SparklesIcon data-icon='inline-start' />
            )}
            {t('monitoring.setup.ask.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens `AskAiDialog`: for pages that offer setting up with the agent next to doing it by hand. */
export function AskAiButton({
  kind,
  children,
  ...props
}: { readonly kind: SetupKind } & Omit<
  ComponentProps<typeof Button>,
  'onClick'
>): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>
        <SparklesIcon data-icon='inline-start' />
        {children ?? t(`monitoring.setup.ask.${kind}.button`)}
      </Button>
      <AskAiDialog kind={kind} open={open} onOpenChange={setOpen} />
    </>
  );
}
