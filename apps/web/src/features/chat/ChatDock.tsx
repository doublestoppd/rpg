import { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useCharacter } from '../character/useCharacter';
import { ChannelView } from './ChannelView';
import { setChatPinned, useChatPinned } from './chatPinStore';
import { useChatChannels } from './useChat';

/**
 * The pinned chat dock: when the player pins chat, this floats at the bottom of
 * every page so conversation stays in reach without leaving the current screen.
 * It reuses the same channel query and ChannelView as the Chat page, so unread
 * state and history stay consistent. Hidden on the Chat page itself (redundant
 * there) and collapsible to a single bar.
 */
export function ChatDock() {
  const pinned = useChatPinned();
  const { data: character } = useCharacter();
  const routeLocation = useLocation();
  const channels = useChatChannels(pinned && Boolean(character));
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Not pinned, no character, or already on the full Chat page: nothing to dock.
  if (!pinned || !character || routeLocation.pathname === '/chat') return null;

  const channelList = channels.data?.channels ?? [];
  const activeChannel =
    channelList.find((channel) => channel.id === selectedChannelId) ??
    channelList.find((channel) => channel.kind === 'GLOBAL') ??
    channelList[0] ??
    null;
  const totalUnread = channelList.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <aside
      aria-label="Pinned chat"
      className="fixed bottom-0 right-0 z-40 w-full border-t border-stone-200 bg-white shadow-lg sm:bottom-4 sm:right-4 sm:w-96 sm:rounded-lg sm:border dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-200"
        >
          <span aria-hidden>💬</span>
          Chat
          {collapsed && totalUnread > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
          <span aria-hidden className="text-stone-400">
            {collapsed ? '▲' : '▼'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setChatPinned(false)}
          aria-label="Unpin chat"
          className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800"
        >
          ✕
        </button>
      </div>

      {!collapsed && (
        <div className="p-3">
          {channelList.length > 1 && (
            <div role="tablist" aria-label="Chat channels" className="mb-2 flex gap-1">
              {channelList.map((channel) => (
                <button
                  key={channel.id}
                  role="tab"
                  type="button"
                  aria-selected={channel.id === activeChannel?.id}
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    channel.id === activeChannel?.id
                      ? 'bg-amber-100 text-amber-900 dark:bg-stone-700 dark:text-amber-200'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'
                  }`}
                >
                  {channel.kind === 'GLOBAL' ? 'Global' : 'Here'}
                  {channel.unreadCount > 0 && (
                    <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">
                      {channel.unreadCapped ? `${channel.unreadCount}+` : channel.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {activeChannel && (
            <ChannelView
              key={activeChannel.id}
              channel={activeChannel}
              currentCharacterId={character.id}
              compact
            />
          )}
        </div>
      )}
    </aside>
  );
}
