import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import {
  buildTestApp,
  createTestPrisma,
  registerTestUser,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

let prisma: PrismaClient;
let app: FastifyInstance;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };
const key = () => Math.random().toString(36).slice(2).padEnd(12, '0');
const get = (auth: Auth, url: string) =>
  app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
const post = (auth: Auth, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: payload as Record<string, unknown>,
  });

async function makeCharacter(
  slug = 'crownfall-market-district',
): Promise<{ auth: Auth; characterId: string }> {
  const reg = await registerTestUser(app);
  const auth: Auth = { cookie: reg.cookie, csrf: reg.csrf };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Hero ${key()}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const loc = await prisma.location.findUniqueOrThrow({ where: { slug } });
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: loc.id },
  });
  return { auth, characterId: character.id };
}

const startMira = (auth: Auth) =>
  post(auth, '/api/v1/npcs/mira-coinwright/interactions', { idempotencyKey: key() });

describe('NPC interaction lifecycle', () => {
  it('starts a conversation, snapshotting content revisions', async () => {
    const { auth, characterId } = await makeCharacter();
    const res = await startMira(auth);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.dialogueKey).toBe('mira-welcome');
    expect(body.nodeId).toBe('greet');
    expect(body.version).toBe(0);
    // Condition-gated "veteran" choice (level >= 5) is hidden at level 1.
    const labels = body.choices.map((c: { id: string }) => c.id);
    expect(labels).toContain('about');
    expect(labels).not.toContain('veteran');

    const interaction = await prisma.npcInteraction.findFirstOrThrow({ where: { characterId } });
    expect(interaction.npcRevision).toBeGreaterThanOrEqual(1);
    expect(interaction.dialogueRevision).toBeGreaterThanOrEqual(1);
    expect(interaction.dialogueSnapshot).toBeTruthy();
  });

  it('is idempotent on start: a replay returns the same interaction', async () => {
    const { auth } = await makeCharacter();
    const k = key();
    const first = await post(auth, '/api/v1/npcs/mira-coinwright/interactions', {
      idempotencyKey: k,
    });
    const replay = await post(auth, '/api/v1/npcs/mira-coinwright/interactions', {
      idempotencyKey: k,
    });
    expect(replay.json().interactionId).toBe(first.json().interactionId);
  });

  it('applies typed effects atomically: flag, familiarity, and a version bump', async () => {
    const { auth, characterId } = await makeCharacter();
    const id = (await startMira(auth)).json().interactionId;
    const res = await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
      choiceId: 'about',
      expectedVersion: 0,
      idempotencyKey: key(),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.nodeId).toBe('wares');

    const flag = await prisma.characterNpcFlag.findFirst({
      where: { characterId, flagKey: 'mira-greeted' },
    });
    expect(flag?.value).toBe('true');
    const state = await prisma.characterNpcState.findFirstOrThrow({
      where: { characterId, npcKey: 'mira-coinwright' },
    });
    expect(state.familiarity).toBe(5);
  });

  it('grants Gold through the currency service, once (flag-gated)', async () => {
    const { auth } = await makeCharacter();
    const before = BigInt((await get(auth, '/api/v1/currency')).json().gold);

    const id1 = (await startMira(auth)).json().interactionId;
    await post(auth, `/api/v1/npc-interactions/${id1}/choices`, {
      choiceId: 'gift',
      expectedVersion: 0,
      idempotencyKey: key(),
    });
    const mid = BigInt((await get(auth, '/api/v1/currency')).json().gold);
    expect(mid).toBe(before + 10n);

    // A second conversation no longer offers the gift (flag now true).
    const second = await startMira(auth);
    const ids = second.json().choices.map((c: { id: string }) => c.id);
    expect(ids).not.toContain('gift');
  });

  it('is replay-safe and concurrency-safe on choices (one winner, stale = 409)', async () => {
    const { auth } = await makeCharacter();
    const id = (await startMira(auth)).json().interactionId;

    // Replay: the same choice key returns the original outcome, not an error.
    const k = key();
    const a = await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
      choiceId: 'about',
      expectedVersion: 0,
      idempotencyKey: k,
    });
    const replay = await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
      choiceId: 'about',
      expectedVersion: 0,
      idempotencyKey: k,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().version).toBe(a.json().version);

    // A stale choice (version already advanced) is rejected.
    const stale = await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
      choiceId: 'back-w',
      expectedVersion: 0,
      idempotencyKey: key(),
    });
    expect(stale.statusCode).toBe(409);
  });

  it('allows only one winner among concurrent choices', async () => {
    const { auth } = await makeCharacter();
    const id = (await startMira(auth)).json().interactionId;
    const [r1, r2] = await Promise.all([
      post(auth, `/api/v1/npc-interactions/${id}/choices`, {
        choiceId: 'about',
        expectedVersion: 0,
        idempotencyKey: key(),
      }),
      post(auth, `/api/v1/npc-interactions/${id}/choices`, {
        choiceId: 'news',
        expectedVersion: 0,
        idempotencyKey: key(),
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('emits quest progress only through the verified dialogue effect', async () => {
    const { auth, characterId } = await makeCharacter();
    // A throwaway quest whose objective is to talk to Mira. QuestDefinition is a
    // config table (not truncated), so this test cleans up after itself.
    const suffix = key();
    const quest = await prisma.questDefinition.create({
      data: {
        slug: `talk-mira-${suffix}`,
        name: `A Word with Mira ${suffix}`,
        description: 'Speak with Mira.',
        rewardXp: 10,
        rewardGold: 0n,
        rewardItems: [],
        sortOrder: 99,
        objectives: {
          create: {
            type: 'TALK_TO_NPC',
            targetSlug: 'mira-coinwright',
            requiredCount: 1,
            description: 'Talk to Mira',
            sortOrder: 0,
          },
        },
      },
      include: { objectives: true },
    });
    try {
      const cq = await prisma.characterQuest.create({
        data: { characterId, questId: quest.id, status: 'ACTIVE' },
      });
      await prisma.questProgress.create({
        data: { characterQuestId: cq.id, objectiveId: quest.objectives[0]!.id },
      });

      const id = (await startMira(auth)).json().interactionId;
      await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
        choiceId: 'news',
        expectedVersion: 0,
        idempotencyKey: key(),
      });

      const progress = await prisma.questProgress.findFirstOrThrow({
        where: { characterQuestId: cq.id },
      });
      expect(progress.currentCount).toBe(1);
    } finally {
      await prisma.characterQuest.deleteMany({ where: { questId: quest.id } });
      await prisma.questDefinition.delete({ where: { id: quest.id } });
    }
  });

  it('rejects starting with a retired NPC but keeps an active interaction stable', async () => {
    const { auth } = await makeCharacter();
    // Start first, then retire the NPC: the live interaction still resolves.
    const id = (await startMira(auth)).json().interactionId;
    try {
      await prisma.npcDefinition.update({
        where: { key: 'mira-coinwright' },
        data: { status: 'RETIRED' },
      });
      // A new start is refused…
      const blocked = await startMira(auth);
      expect(blocked.statusCode).toBe(404);
      // …but the in-progress interaction still advances on its snapshot.
      const choose = await post(auth, `/api/v1/npc-interactions/${id}/choices`, {
        choiceId: 'about',
        expectedVersion: 0,
        idempotencyKey: key(),
      });
      expect(choose.statusCode).toBe(200);
    } finally {
      await prisma.npcDefinition.update({
        where: { key: 'mira-coinwright' },
        data: { status: 'PUBLISHED' },
      });
    }
  });

  it('requires ownership and rejects an unauthenticated caller', async () => {
    const { auth } = await makeCharacter();
    const id = (await startMira(auth)).json().interactionId;

    const other = await makeCharacter();
    const foreign = await get(other.auth, `/api/v1/npc-interactions/${id}`);
    expect(foreign.statusCode).toBe(404);

    const unauth = await app.inject({ method: 'GET', url: `/api/v1/npc-interactions/${id}` });
    expect(unauth.statusCode).toBe(401);
  });
});
