import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import { ChannelView } from '../features/chat/ChannelView';
import { toggleChatPinned, useChatPinned } from '../features/chat/chatPinStore';
import { useChatChannels } from '../features/chat/useChat';

export function ChatPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const channels = useChatChannels(Boolean(character));
  const pinned = useChatPinned();
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Chat
        </h1>
        <Button variant="secondary" onClick={toggleChatPinned} aria-pressed={pinned}>
          {pinned ? '📌 Unpin from bottom' : '📌 Pin to bottom'}
        </Button>
      </div>

      {pinned && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Chat is pinned to the bottom of every page. This tab shows the full history.
        </p>
      )}

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
