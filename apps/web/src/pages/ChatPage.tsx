import { CHAT_MESSAGE_MAX_CODE_POINTS, type ChatChannelView } from '@rpg/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { ReportDialog } from '../features/chat/ReportDialog';
import {
  useBlockCharacter,
  useChatChannels,
  useChatMessages,
  useMarkChatRead,
  useSendChatMessage,
} from '../features/chat/useChat';
import { useLiveSocketConnected } from '../features/notifications/liveSocketStatus';
import { ApiRequestError } from '../lib/api';

/** A newline-safe UUID-ish placeholder for idempotency keys. */
function newIdempotencyKey(): string {
  return `chat-${crypto.randomUUID()}`;
}

export function ChatPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const channels = useChatChannels(Boolean(character));
  // The user's explicit tab choice, or null to use the default (Global). The
  // active channel is always derived, so a selection that becomes invalid
  // (e.g. losing the location channel on travel) falls back automatically —
  // no setState-in-effect required.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  if (characterPending) return <LoadingState label="Opening the message hall…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (channels.isPending) return <LoadingState label="Opening the message hall…" />;
  if (channels.isError || !channels.data)
    return <ErrorState onRetry={() => void channels.refetch()} />;

  const channelList = channels.data.channels;
  const activeChannel =
    channelList.find((channel) => channel.id === selectedChannelId) ??
    channelList.find((channel) => channel.kind === 'GLOBAL') ??
    channelList[0] ??
    null;
  const activeChannelId = activeChannel?.id ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Chat</h1>

      <div
        role="tablist"
        aria-label="Chat channels"
        className="flex gap-2 border-b border-stone-200 dark:border-stone-800"
      >
        {channelList.map((channel) => (
          <button
            key={channel.id}
            role="tab"
            type="button"
            aria-selected={channel.id === activeChannelId}
            onClick={() => setSelectedChannelId(channel.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              channel.id === activeChannelId
                ? 'border-amber-700 text-amber-800 dark:text-amber-300'
                : 'border-transparent text-stone-600 hover:text-stone-900 dark:text-stone-400'
            }`}
          >
            {channel.kind === 'GLOBAL' ? 'Global' : 'Current Location'}
            {channel.unreadCount > 0 && (
              <span
                aria-label={`${channel.unreadCount} unread`}
                className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
              >
                {channel.unreadCapped ? `${channel.unreadCount}+` : channel.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {channelList.length === 1 && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Location chat opens once you arrive somewhere — while traveling, only Global is available.
        </p>
      )}

      {activeChannel ? (
        <ChannelView
          key={activeChannel.id}
          channel={activeChannel}
          currentCharacterId={character.id}
        />
      ) : (
        <EmptyState title="No channel selected" description="Pick a channel above." />
      )}
    </div>
  );
}

function ChannelView({
  channel,
  currentCharacterId,
}: {
  channel: ChatChannelView;
  currentCharacterId: string;
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
      <p aria-live="polite" className="text-xs text-stone-400 dark:text-stone-500">
        {isLiveConnected
          ? 'Live updates on.'
          : 'Live updates unavailable — messages refresh automatically.'}
      </p>

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
          className="max-h-96 space-y-2 overflow-y-auto rounded-md border border-stone-200 p-3 dark:border-stone-800"
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
