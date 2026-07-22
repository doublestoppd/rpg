import { CHAT_MESSAGE_MAX_CODE_POINTS, type ChatChannelView } from '@rpg/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import { ApiRequestError } from '../../lib/api';
import { useLiveSocketConnected } from '../notifications/liveSocketStatus';
import { ReportDialog } from './ReportDialog';
import { useBlockCharacter, useChatMessages, useMarkChatRead, useSendChatMessage } from './useChat';

/** A newline-safe UUID-ish placeholder for idempotency keys. */
function newIdempotencyKey(): string {
  return `chat-${crypto.randomUUID()}`;
}

/**
 * One chat channel: transcript, moderation affordances, and composer. Shared by
 * the full Chat page and the pinned bottom dock; `compact` shrinks the
 * transcript and hides the live-status line for the dock's tighter space.
 */
export function ChannelView({
  channel,
  currentCharacterId,
  compact = false,
}: {
  channel: ChatChannelView;
  currentCharacterId: string;
  compact?: boolean;
}) {
  const { showToast } = useToast();
  const messages = useChatMessages(channel.id);
  const send = useSendChatMessage(channel.id);
  const markRead = useMarkChatRead(channel.id);
  const block = useBlockCharacter();

  const [draft, setDraft] = useState('');
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isLiveConnected = useLiveSocketConnected();

  // Newest-first from the API; reverse for a natural top-to-bottom transcript.
  const ordered = useMemo(
    () => (messages.data ? [...messages.data.messages].reverse() : []),
    [messages.data],
  );

  // Advance read state to the newest visible message whenever it changes.
  const newest = ordered.at(-1);
  useEffect(() => {
    if (newest) markRead.mutate(newest.id);
    // markRead is stable enough; only re-run when the newest id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id]);

  // Keep the transcript scrolled to the latest message.
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [ordered.length]);

  const codePoints = [...draft.trim()].length;
  const tooLong = codePoints > CHAT_MESSAGE_MAX_CODE_POINTS;
  const sendError = send.error instanceof ApiRequestError ? send.error : null;
  const restricted = sendError?.code === 'CHAT_RESTRICTED';
  const rateLimited = sendError?.code === 'CHAT_RATE_LIMITED';

  const submit = () => {
    const body = draft.trim();
    if (!body || tooLong) return;
    send.mutate({ body, idempotencyKey: newIdempotencyKey() }, { onSuccess: () => setDraft('') });
  };

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <p aria-live="polite" className="text-xs text-stone-400 dark:text-stone-500">
          {isLiveConnected
            ? 'Live updates on.'
            : 'Live updates unavailable — messages refresh automatically.'}
        </p>
      )}

      {messages.isError ? (
        <ErrorState onRetry={() => void messages.refetch()} />
      ) : messages.isPending ? (
        <LoadingState label="Reading the latest word…" />
      ) : ordered.length === 0 ? (
        <EmptyState title="No messages yet" description="Be the first to say something." />
      ) : (
        <ul
          ref={listRef}
          aria-label="Messages"
          className={`space-y-2 overflow-y-auto rounded-md border border-stone-200 p-3 dark:border-stone-800 ${
            compact ? 'max-h-56' : 'max-h-96'
          }`}
        >
          {ordered.map((message) => {
            const mine = message.author.characterId === currentCharacterId;
            return (
              <li key={message.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-stone-800 dark:text-stone-200">
                    {message.author.name}
                    {mine && <span className="ml-1 text-xs text-stone-400">(you)</span>}
                  </span>
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {/* Plain text only: never dangerouslySetInnerHTML. */}
                <p className="whitespace-pre-wrap break-words text-stone-700 dark:text-stone-300">
                  {message.body}
                </p>
                {!mine && (
                  <div className="mt-0.5 flex gap-3 text-xs">
                    <button
                      type="button"
                      className="text-stone-500 hover:text-red-700"
                      onClick={() =>
                        block.mutate(message.author.characterId, {
                          onSuccess: () => showToast(`Blocked ${message.author.name}.`, 'success'),
                        })
                      }
                    >
                      Block
                    </button>
                    <button
                      type="button"
                      className="text-stone-500 hover:text-red-700"
                      onClick={() => setReportMessageId(message.id)}
                    >
                      Report
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-1"
      >
        <label htmlFor={`chat-composer-${channel.id}`} className="sr-only">
          Message {channel.kind === 'GLOBAL' ? 'Global' : 'Current Location'}
        </label>
        <div className="flex gap-2">
          <input
            id={`chat-composer-${channel.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={restricted}
            placeholder={restricted ? 'Your chat is restricted.' : 'Type a message…'}
            aria-invalid={tooLong ? true : undefined}
            className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
          <Button type="submit" disabled={send.isPending || tooLong || restricted || !draft.trim()}>
            Send
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span aria-live="polite" role="alert" className="text-red-700">
            {tooLong && `Message is too long (${codePoints}/${CHAT_MESSAGE_MAX_CODE_POINTS}).`}
            {restricted && 'Your chat privileges are currently restricted.'}
            {rateLimited &&
              `Slow down — try again in ${sendError?.retryAfterSeconds ?? 'a few'} seconds.`}
            {sendError && !restricted && !rateLimited && sendError.code !== 'UNKNOWN'
              ? sendError.message
              : ''}
          </span>
          <span className={tooLong ? 'text-red-700' : 'text-stone-400 dark:text-stone-500'}>
            {codePoints}/{CHAT_MESSAGE_MAX_CODE_POINTS}
          </span>
        </div>
      </form>

      <ReportDialog
        open={reportMessageId !== null}
        messageId={reportMessageId}
        onClose={() => setReportMessageId(null)}
        onReported={() => {
          setReportMessageId(null);
          showToast('Report submitted. Thank you.', 'success');
        }}
      />
    </div>
  );
}
