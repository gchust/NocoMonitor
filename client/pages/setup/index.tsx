import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CircleCheckIcon,
  SendIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import type {
  Setup,
  SetupActivity,
  SetupQuestion,
  SetupTurn,
} from '../../lib/monitoring.js';
import { LiveSteps } from '../incidents/investigation-steps.js';
import { LoadError } from '../monitoring/components.js';
import { useCanManage } from '../monitoring/utils.js';
import { ProposalCard, type ApplyChoice } from './proposal-card.js';
import { setupErrorText } from './setup-errors.js';

/** How often the conversation is read again while the agent works on it. */
const LIVE_REFRESH_MS = 2000;

const isWorking = (setup: Pick<Setup, 'state'>) =>
  setup.state === 'queued' || setup.state === 'running';

/**
 * A conversation with the agent about what to monitor: what the person asked, the agent at work, its questions and its
 * proposal, which the person applies. Read again every two seconds while the agent works.
 */
export default function SetupPage(): ReactElement {
  const { t } = useTranslation();
  const { setupId = '' } = useParams();
  const api = useApiClient();
  const toaster = useToaster();
  const canManage = useCanManage();
  const [working, setWorking] = useState(true);
  const setup = useApiData<{ data: Setup }>(
    `monitoringSetups/${encodeURIComponent(setupId)}`,
    undefined,
    { refreshMs: working ? LIVE_REFRESH_MS : undefined },
  );
  const data = setup.data?.data;
  // The polling follows what the latest answer says; set while rendering, so it never lags a render behind.
  if (data && isWorking(data) !== working) setWorking(isWorking(data));
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  // A new turn, the agent starting on one, or its outcome scrolls into view, as in any conversation.
  const endRef = useRef<HTMLDivElement>(null);
  const moment = data ? `${data.turns.length}:${data.state}` : '';
  useEffect(() => {
    if (moment)
      endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [moment]);

  const say = async (text: string): Promise<boolean> => {
    setSending(true);
    try {
      await api.request({
        path: `monitoringSetups/${encodeURIComponent(setupId)}/messages`,
        method: 'POST',
        json: { text },
      });
      setWorking(true);
      setup.reload();
      return true;
    } catch (error) {
      toaster.show({ type: 'error', title: setupErrorText(error, t) });
      return false;
    } finally {
      setSending(false);
    }
  };

  const apply = async (choice: ApplyChoice): Promise<void> => {
    setApplying(true);
    try {
      await api.request({
        path: `monitoringSetups/${encodeURIComponent(setupId)}/apply`,
        method: 'POST',
        json: choice,
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.setup.applied.toast'),
      });
      setup.reload();
    } catch (error) {
      toaster.show({ type: 'error', title: setupErrorText(error, t) });
    } finally {
      setApplying(false);
    }
  };

  const kind = data?.kind ?? 'monitors';
  const busy = !data || isWorking(data) || sending;
  const lastProposal = data?.turns.findLastIndex(
    (turn) => turn.role === 'agent' && turn.proposal,
  );
  const lastAgent = data?.turns.findLastIndex((turn) => turn.role === 'agent');

  return (
    <PageContainer className='mx-auto max-w-3xl'>
      <PageHeader
        title={t('monitoring.setup.title')}
        description={t(`monitoring.setup.description.${kind}`)}
      />
      {setup.error && !data ? (
        <LoadError error={setup.error} onRetry={setup.reload} />
      ) : !data ? (
        <Skeleton className='h-64 rounded-xl' />
      ) : (
        <>
          <ol className='flex flex-col gap-5'>
            {data.turns.map((turn, index) => (
              <li key={turn.id}>
                {turn.role === 'user' ? (
                  <PersonTurn turn={turn} />
                ) : (
                  <AgentTurn turn={turn}>
                    {index === lastAgent &&
                    turn.questions.length &&
                    data.state === 'replied' &&
                    canManage ? (
                      <Questions
                        questions={turn.questions}
                        sending={sending}
                        onAnswer={say}
                      />
                    ) : null}
                    {turn.proposal ? (
                      <ProposalCard
                        proposal={turn.proposal}
                        mode={
                          index !== lastProposal
                            ? 'replaced'
                            : data.state === 'applied'
                              ? 'applied'
                              : data.state === 'replied' && canManage
                                ? 'active'
                                : 'waiting'
                        }
                        created={data.result?.chosen}
                        applying={applying}
                        onApply={(choice) => void apply(choice)}
                      />
                    ) : null}
                  </AgentTurn>
                )}
              </li>
            ))}
            {isWorking(data) ? (
              <li>
                <AgentWorking setup={data} />
              </li>
            ) : null}
          </ol>

          {data.state === 'failed' ? (
            <Alert variant='destructive'>
              <TriangleAlertIcon />
              <AlertTitle>{t('monitoring.setup.failed.title')}</AlertTitle>
              <AlertDescription>
                {t('monitoring.setup.failed.description')}
              </AlertDescription>
              {canManage ? (
                <AlertAction>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={sending}
                    onClick={() => {
                      const last = data.turns.findLast(
                        (turn) => turn.role === 'user',
                      );
                      if (last) void say(last.text);
                    }}
                  >
                    {t('monitoring.actions.retry')}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}

          {data.state === 'applied' ? (
            <Applied setup={data} />
          ) : canManage ? (
            <Composer disabled={busy} sending={sending} onSend={say} />
          ) : null}
          <div ref={endRef} />
        </>
      )}
    </PageContainer>
  );
}

function PersonTurn({ turn }: { readonly turn: SetupTurn }): ReactElement {
  return (
    <div className='flex justify-end'>
      <p className='max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground'>
        {turn.text}
      </p>
    </div>
  );
}

function AgentTurn({
  turn,
  children,
}: {
  readonly turn: SetupTurn;
  readonly children?: ReactElement | (ReactElement | null)[] | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='flex gap-3'>
      <AgentAvatar />
      <div className='flex min-w-0 flex-1 flex-col gap-3'>
        <p className='sr-only'>{t('monitoring.setup.agent')}</p>
        <p className='text-sm whitespace-pre-wrap'>{turn.text}</p>
        {children}
      </div>
    </div>
  );
}

function AgentAvatar(): ReactElement {
  return (
    <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
      <BotIcon className='size-4' />
    </span>
  );
}

function AgentWorking({ setup }: { readonly setup: Setup }): ReactElement {
  const { t } = useTranslation();
  const activity = useApiData<{ data: SetupActivity }>(
    `monitoringSetups/${encodeURIComponent(setup.id)}/activity`,
    { run: setup.runId ?? undefined, state: setup.state },
    { refreshMs: LIVE_REFRESH_MS },
  );
  const data = activity.data?.data;
  return (
    <div className='flex gap-3'>
      <AgentAvatar />
      <div className='min-w-0 flex-1'>
        <LiveSteps
          title={t('monitoring.setup.live')}
          waiting={
            setup.state === 'queued' ? t('monitoring.setup.queued') : null
          }
          starting={t('monitoring.setup.starting')}
          steps={data?.steps ?? []}
          startedAt={data?.startedAt ?? null}
          label={(kind, now) =>
            t(`monitoring.setup.${now ? 'now' : 'step'}.${kind}`)
          }
        />
      </div>
    </div>
  );
}

/** The agent's questions, each answered by one of its options or in the person's own words, sent as one message. */
function Questions({
  questions,
  sending,
  onAnswer,
}: {
  readonly questions: readonly SetupQuestion[];
  readonly sending: boolean;
  readonly onAnswer: (text: string) => Promise<boolean>;
}): ReactElement {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = questions.filter((question) => answers[question.id]?.trim());
  const send = () =>
    void onAnswer(
      answered
        .map((question) => `${question.text}\n→ ${answers[question.id].trim()}`)
        .join('\n\n'),
    );

  return (
    <section
      className='flex flex-col gap-4 rounded-lg border bg-card p-4'
      aria-label={t('monitoring.setup.questions.title')}
    >
      {questions.map((question) => {
        const value = answers[question.id] ?? '';
        const set = (next: string) =>
          setAnswers((current) => ({ ...current, [question.id]: next }));
        return (
          <fieldset key={question.id} className='flex flex-col gap-2'>
            <legend className='mb-2 text-sm font-medium'>
              {question.text}
            </legend>
            {question.options.length ? (
              <div className='flex flex-wrap gap-2'>
                {question.options.map((option) => (
                  <Button
                    key={option}
                    type='button'
                    size='sm'
                    variant={value === option ? 'default' : 'outline'}
                    aria-pressed={value === option}
                    className='h-auto max-w-full py-1 whitespace-normal'
                    disabled={sending}
                    onClick={() =>
                      // With one question, an option is the whole answer: it goes at once.
                      questions.length === 1
                        ? void onAnswer(`${question.text}\n→ ${option}`)
                        : set(value === option ? '' : option)
                    }
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              value={question.options.includes(value) ? '' : value}
              onChange={(event) => set(event.target.value)}
              placeholder={t(
                question.options.length
                  ? 'monitoring.setup.questions.other'
                  : 'monitoring.setup.questions.answer',
              )}
              aria-label={question.text}
            />
          </fieldset>
        );
      })}
      <div className='flex justify-end'>
        <Button onClick={send} disabled={!answered.length || sending}>
          {sending ? <Spinner data-icon='inline-start' /> : null}
          {t('monitoring.setup.questions.send')}
        </Button>
      </div>
    </section>
  );
}

function Composer({
  disabled,
  sending,
  onSend,
}: {
  readonly disabled: boolean;
  readonly sending: boolean;
  readonly onSend: (text: string) => Promise<boolean>;
}): ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim() || disabled) return;
    if (await onSend(text.trim())) setText('');
  };
  return (
    <div className='sticky bottom-4 flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm'>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={t(
          disabled
            ? 'monitoring.setup.composer.waiting'
            : 'monitoring.setup.composer.placeholder',
        )}
        aria-label={t('monitoring.setup.composer.label')}
        className='max-h-40 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent'
        maxLength={4000}
      />
      <Button
        size='icon'
        onClick={() => void send()}
        disabled={disabled || !text.trim()}
        aria-label={t('monitoring.setup.composer.send')}
      >
        {sending ? <Spinner /> : <SendIcon />}
      </Button>
    </div>
  );
}

function Applied({ setup }: { readonly setup: Setup }): ReactElement {
  const { t } = useTranslation();
  const result = setup.result;
  const monitors = result?.monitorIds.length ?? 0;
  const services = result?.serviceIds.length ?? 0;
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-(--status-success)/30 bg-(--status-success)/5 p-4',
      )}
    >
      <h3 className='flex items-center gap-2 font-medium'>
        <CircleCheckIcon className='size-5 text-(--status-success)' />
        {t('monitoring.setup.applied.title')}
      </h3>
      <p className='text-sm text-muted-foreground'>
        {t('monitoring.setup.applied.summary', {
          items: [
            monitors
              ? t('monitoring.setup.applied.monitors', { count: monitors })
              : null,
            services
              ? t('monitoring.setup.applied.services', { count: services })
              : null,
            result?.statusPageId
              ? t('monitoring.setup.applied.statusPage')
              : null,
          ]
            .filter(Boolean)
            .join(t('monitoring.setup.proposal.listSeparator')),
        })}
        {monitors ? ` ${t('monitoring.setup.applied.firstCheck')}` : null}
      </p>
      <div className='flex flex-wrap gap-2'>
        {monitors ? (
          <Button
            size='sm'
            nativeButton={false}
            render={<Link to='/monitors' />}
          >
            {t('monitoring.setup.applied.viewMonitors')}
          </Button>
        ) : null}
        {result?.statusPageId ? (
          <Button
            size='sm'
            variant={monitors ? 'outline' : 'default'}
            nativeButton={false}
            render={<Link to='/status-pages' />}
          >
            {t('monitoring.setup.applied.viewStatusPages')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
