import type { NpcInteractionResponse } from '@rpg/shared';
import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import {
  useChooseChoice,
  useCloseInteraction,
  useInteraction,
  useStartInteraction,
} from './useScene';

interface NpcDialoguePanelProps {
  npcKey: string;
  npcName: string;
  /** null until the player opens the conversation; then the interaction id. */
  interactionId: string | null;
  onStarted: (interactionId: string) => void;
  onClose: () => void;
}

const SPEAKER_LABELS: Record<string, string> = {
  NPC: '',
  PLAYER: 'You',
  NARRATION: '',
};

/**
 * An accessible NPC conversation. Built on the native <dialog> so focus is
 * trapped and Escape closes it. The transcript is a live region so a
 * screen-reader announces each new line; choices are ordinary buttons in
 * document order. Every choice carries the interaction's current version, so a
 * stale turn is rejected server-side rather than silently applied.
 */
export function NpcDialoguePanel({
  npcKey,
  npcName,
  interactionId,
  onStarted,
  onClose,
}: NpcDialoguePanelProps) {
  const start = useStartInteraction(npcKey);
  const interaction = useInteraction(interactionId);
  const { showToast } = useToast();
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Open the conversation exactly once when the panel is first shown.
  const startMutate = start.mutate;
  useEffect(() => {
    if (interactionId !== null) return;
    startMutate(crypto.randomUUID().replaceAll('-', ''), {
      onSuccess: (result) => onStarted(result.interactionId),
      onError: (err) =>
        showToast(
          err instanceof Error ? err.message : `${npcName} has nothing to say right now.`,
          'error',
        ),
    });
    // Intentionally run once on mount for an unopened conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = interaction.data;

  // Keep the transcript scrolled to the newest line as the conversation grows.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view?.history.length, view?.nodeId]);

  const failedToStart = interactionId === null && start.isError;

  return (
    <Dialog
      open
      title={npcName}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {view?.status === 'CLOSED' ? 'Done' : 'Leave conversation'}
        </Button>
      }
    >
      {failedToStart ? (
        <p className="text-sm text-red-700 dark:text-red-400">
          {start.error instanceof Error ? start.error.message : `${npcName} cannot talk right now.`}
        </p>
      ) : !view ? (
        <LoadingState label={`Approaching ${npcName}…`} />
      ) : (
        <ConversationBody view={view} onClose={onClose} />
      )}
    </Dialog>
  );
}

function ConversationBody({
  view,
  onClose,
}: {
  view: NpcInteractionResponse;
  onClose: () => void;
}) {
  const choose = useChooseChoice(view.interactionId);
  const closeInteraction = useCloseInteraction(view.interactionId);
  const { showToast } = useToast();
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.history.length, view.nodeId]);

  const busy = choose.isPending || closeInteraction.isPending;
  const ended = view.status === 'CLOSED';

  return (
    <div className="space-y-4">
      <div
        ref={transcriptRef}
        aria-live="polite"
        aria-label="Conversation"
        className="max-h-64 space-y-3 overflow-y-auto pr-1"
      >
        {view.history.map((turn, index) => (
          <TranscriptLine
            key={index}
            speaker={turn.speaker}
            text={turn.choiceLabel ?? turn.text}
            isChoice={turn.choiceLabel !== null}
          />
        ))}
        {!ended && <TranscriptLine speaker={view.speaker} text={view.text} isChoice={false} />}
      </div>

      {ended ? (
        <p className="text-xs italic text-stone-500 dark:text-stone-400">
          The conversation has ended.
        </p>
      ) : view.choices.length > 0 ? (
        <ul className="space-y-2" aria-label="Your responses">
          {view.choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  choose.mutate(
                    {
                      choiceId: choice.id,
                      expectedVersion: view.version,
                      idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
                    },
                    {
                      onError: (err) =>
                        showToast(
                          err instanceof Error ? err.message : 'That choice could not be made.',
                          'error',
                        ),
                    },
                  )
                }
                className="w-full rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left text-sm font-medium text-stone-800 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-amber-700 dark:hover:bg-stone-700"
              >
                {choice.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Button
          disabled={busy}
          onClick={() =>
            closeInteraction.mutate(undefined, {
              onSuccess: onClose,
              onError: (err) =>
                showToast(
                  err instanceof Error ? err.message : 'Could not end the conversation.',
                  'error',
                ),
            })
          }
        >
          End conversation
        </Button>
      )}
    </div>
  );
}

function TranscriptLine({
  speaker,
  text,
  isChoice,
}: {
  speaker: string;
  text: string;
  isChoice: boolean;
}) {
  const label = SPEAKER_LABELS[speaker] ?? '';
  const isPlayer = speaker === 'PLAYER' || isChoice;
  const isNarration = speaker === 'NARRATION';

  return (
    <div className={isPlayer ? 'text-right' : 'text-left'}>
      {label && (
        <p className="mb-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</p>
      )}
      <p
        className={
          isNarration
            ? 'text-sm italic text-stone-500 dark:text-stone-400'
            : isPlayer
              ? 'inline-block rounded-lg bg-amber-100 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100'
              : 'inline-block rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-800 dark:bg-stone-800 dark:text-stone-100'
        }
      >
        {text}
      </p>
    </div>
  );
}
