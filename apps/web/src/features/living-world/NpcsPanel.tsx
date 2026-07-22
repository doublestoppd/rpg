import type { NpcInfo } from '@rpg/shared';
import { useState } from 'react';

import { Asset } from '../../components/ui/Asset';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { NpcDialoguePanel } from './NpcDialoguePanel';

/**
 * The NPCs present at the current location and world segment, highest priority
 * first. Each present NPC can be approached for an authored conversation, which
 * opens the accessible dialogue modal. NPCs are game characters — never player
 * chat — so they live here on the scene, not in the chat feature.
 */
export function NpcsPanel({ npcs }: { npcs: NpcInfo[] }) {
  const [openNpcKey, setOpenNpcKey] = useState<string | null>(null);
  // interactionId is scoped to the currently-open NPC; reset when it changes.
  const [interactionId, setInteractionId] = useState<string | null>(null);

  const present = npcs.filter((npc) => npc.availability === 'PRESENT');

  if (present.length === 0) {
    return (
      <EmptyState
        title="No one about"
        description="No one of note is here at this hour. Come back at a different time of day."
      />
    );
  }

  const openNpc = present.find((npc) => npc.key === openNpcKey) ?? null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {present.map((npc) => (
          <Card key={npc.key} className="flex gap-3">
            <Asset
              assetRole="NPC_PORTRAIT"
              assetKey={npc.portraitAssetKey}
              contentKey={npc.key}
              alt={npc.name}
              className="size-16 shrink-0 rounded-md"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-stone-900 dark:text-stone-100">{npc.name}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">{npc.pronouns}</p>
              <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                {npc.shortDescription}
              </p>
              <Button
                variant="secondary"
                className="mt-2 px-3 py-1 text-xs"
                onClick={() => {
                  setInteractionId(null);
                  setOpenNpcKey(npc.key);
                }}
              >
                Talk
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {openNpc && (
        <NpcDialoguePanel
          key={openNpc.key}
          npcKey={openNpc.key}
          npcName={openNpc.name}
          interactionId={interactionId}
          onStarted={setInteractionId}
          onClose={() => {
            setOpenNpcKey(null);
            setInteractionId(null);
          }}
        />
      )}
    </>
  );
}
