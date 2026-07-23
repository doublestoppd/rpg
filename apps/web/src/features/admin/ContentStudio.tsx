import { type ContentReleaseStatus, type ContentType, contentTypeSchema } from '@rpg/shared';
import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingState } from '../../components/ui/LoadingState';
import { TextField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/Toast';
import { starterPayload } from './contentTemplates';
import {
  useContentReleases,
  useCreateDraft,
  useDefinition,
  usePublishRelease,
  useReleaseDetail,
  useReleaseDiff,
  useReleaseValidation,
  useRemoveDefinition,
  useRetireRelease,
  useUpsertDefinition,
  useWhereUsed,
} from './useContentStudio';

const CONTENT_TYPES = contentTypeSchema.options;

const STATUS_STYLES: Record<ContentReleaseStatus, string> = {
  DRAFT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  VALIDATING: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  PUBLISHED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  RETIRED: 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
};

function StatusBadge({ status }: { status: ContentReleaseStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

/**
 * Content Studio (Phase 20). Administrators create draft releases, edit
 * definitions with domain-specific server validation, review validation and
 * diffs, and atomically publish content onto the live tables — no deploy.
 */
export function ContentStudio() {
  const releases = useContentReleases();
  const createDraft = useCreateDraft();
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Content Studio
          </h2>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Versioned authoring. Published content is immutable; publishing applies a release to the
            live game atomically.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={createDraft.isPending}
          onClick={() =>
            createDraft.mutate(
              { title: `Draft ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` },
              {
                onSuccess: (r) => {
                  setSelectedId(r.release.id);
                  showToast(`Draft v${r.release.version} created from live content.`, 'success');
                },
                onError: (e) => showToast(e.message, 'error'),
              },
            )
          }
        >
          New draft from live
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <ul className="space-y-1">
          {releases.isPending ? (
            <LoadingState label="Loading releases…" />
          ) : (releases.data?.releases.length ?? 0) === 0 ? (
            <EmptyState title="No releases" description="Create a draft to begin." />
          ) : (
            releases.data!.releases.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${
                    selectedId === r.id
                      ? 'border-stone-400 bg-stone-100 dark:border-stone-600 dark:bg-stone-800'
                      : 'border-stone-200 dark:border-stone-800'
                  }`}
                >
                  <span className="truncate">
                    <span className="font-mono text-xs text-stone-400">v{r.version}</span> {r.title}
                  </span>
                  <StatusBadge status={r.status} />
                </button>
              </li>
            ))
          )}
        </ul>

        {selectedId ? (
          <ReleaseWorkspace releaseId={selectedId} />
        ) : (
          <EmptyState title="Select a release" description="Pick a release to view its catalog." />
        )}
      </div>
    </Card>
  );
}

function ReleaseWorkspace({ releaseId }: { releaseId: string }) {
  const detail = useReleaseDetail(releaseId);
  const [tab, setTab] = useState<'catalog' | 'validate' | 'diff' | 'lifecycle'>('catalog');

  if (detail.isPending) return <LoadingState label="Loading release…" />;
  if (!detail.data)
    return <EmptyState title="Not found" description="This release is unavailable." />;

  const { release, definitions } = detail.data;
  const isDraft = release.status === 'DRAFT';

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{release.title}</h3>
        <StatusBadge status={release.status} />
        <span className="text-xs text-stone-400">{release.definitionCount} definitions</span>
      </div>

      <nav className="flex gap-1 border-b border-stone-200 text-sm dark:border-stone-800">
        {(['catalog', 'validate', 'diff', 'lifecycle'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 py-1 capitalize ${
              tab === t
                ? 'border-stone-700 font-medium dark:border-stone-300'
                : 'border-transparent text-stone-500'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'catalog' && (
        <Catalog releaseId={releaseId} isDraft={isDraft} definitions={definitions} />
      )}
      {tab === 'validate' && <ValidationPanel releaseId={releaseId} />}
      {tab === 'diff' && <DiffPanel releaseId={releaseId} />}
      {tab === 'lifecycle' && <LifecyclePanel release={release} />}
    </div>
  );
}

type CatalogEntry = { type: ContentType; key: string; revision: number; name: string };

type Selection =
  | { mode: 'existing'; type: ContentType; key: string }
  | { mode: 'new'; type: ContentType; key: string };

function Catalog({
  releaseId,
  isDraft,
  definitions,
}: {
  releaseId: string;
  isDraft: boolean;
  definitions: CatalogEntry[];
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? definitions.filter((d) => `${d.type} ${d.key} ${d.name}`.toLowerCase().includes(q))
      : definitions;
    return rows.slice(0, 200);
  }, [definitions, search]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        {isDraft && (
          <NewDefinitionForm
            onCreate={(type, key) => setSelected({ mode: 'new', type, key })}
            existingKeys={definitions}
          />
        )}
        <TextField
          label="Search catalog"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="type, key, or name…"
        />
        <p className="mt-1 text-xs text-stone-400">
          {filtered.length} shown{definitions.length > filtered.length ? ' (first 200)' : ''}
        </p>
        <ul className="mt-1 max-h-80 divide-y divide-stone-100 overflow-y-auto dark:divide-stone-800">
          {filtered.map((d) => (
            <li key={`${d.type}:${d.key}`}>
              <button
                type="button"
                onClick={() => setSelected({ mode: 'existing', type: d.type, key: d.key })}
                className={`flex w-full items-center justify-between gap-2 py-1 text-left text-sm ${
                  selected?.key === d.key && selected?.type === d.type ? 'font-medium' : ''
                }`}
              >
                <span className="truncate">
                  <span className="font-mono text-[10px] uppercase text-stone-400">{d.type}</span>{' '}
                  {d.name || d.key}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-stone-400">r{d.revision}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {selected ? (
          <DefinitionEditor
            key={`${selected.mode}:${selected.type}:${selected.key}`}
            releaseId={releaseId}
            type={selected.type}
            defKey={selected.key}
            isDraft={isDraft}
            isNew={selected.mode === 'new'}
            onDeleted={() => setSelected(null)}
            onCreated={(type, key) => setSelected({ mode: 'existing', type, key })}
          />
        ) : (
          <EmptyState title="No definition selected" description="Pick a definition to inspect." />
        )}
      </div>
    </div>
  );
}

/**
 * Start a brand-new definition of any content type. The editor opens with a
 * starter payload template; the definition is not created until it is saved
 * (which runs the same server-side validation as every other edit).
 */
function NewDefinitionForm({
  onCreate,
  existingKeys,
}: {
  onCreate: (type: ContentType, key: string) => void;
  existingKeys: CatalogEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ContentType>('NPC');
  const [key, setKey] = useState('');
  const { showToast } = useToast();

  const trimmed = key.trim();
  const collides = existingKeys.some((d) => d.type === type && d.key === trimmed);

  if (!open) {
    return (
      <div className="mb-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          New definition
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mb-3 space-y-2 rounded-md border border-stone-200 p-2 dark:border-stone-800"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) {
          showToast('Enter a stable key.', 'error');
          return;
        }
        if (collides) {
          showToast('A definition with this type and key already exists.', 'error');
          return;
        }
        onCreate(type, trimmed);
        setOpen(false);
        setKey('');
      }}
    >
      <label className="block text-sm">
        <span className="mb-0.5 block font-medium text-stone-700 dark:text-stone-300">Type</span>
        <select
          className="w-full rounded-md border border-stone-300 bg-white p-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
          value={type}
          onChange={(e) => setType(e.target.value as ContentType)}
        >
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Stable key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="e.g. innkeeper-hollow"
      />
      {collides && <p className="text-xs text-red-600">This type and key already exist.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!trimmed || collides}>
          Start editing
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setKey('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DefinitionEditor({
  releaseId,
  type,
  defKey,
  isDraft,
  isNew,
  onDeleted,
  onCreated,
}: {
  releaseId: string;
  type: ContentType;
  defKey: string;
  isDraft: boolean;
  isNew: boolean;
  onDeleted: () => void;
  onCreated: (type: ContentType, key: string) => void;
}) {
  // For a brand-new definition there is nothing on the server yet, so the
  // read-only queries stay disabled and the editor seeds from a template.
  const def = useDefinition(releaseId, isNew ? null : type, isNew ? null : defKey);
  const whereUsed = useWhereUsed(releaseId, isNew ? null : type, isNew ? null : defKey);
  const upsert = useUpsertDefinition(releaseId);
  const remove = useRemoveDefinition(releaseId);
  const { showToast } = useToast();
  const [draftJson, setDraftJson] = useState<string | null>(null);

  const template = useMemo(
    () => (isNew ? JSON.stringify(starterPayload(type, defKey), null, 2) : null),
    [isNew, type, defKey],
  );

  function savedText(): string {
    if (isNew) return template ?? '';
    return def.data ? JSON.stringify(def.data.payload, null, 2) : '';
  }
  const text = draftJson ?? savedText();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-stone-500">
          {type} · {defKey} {isNew ? '· new' : def.data ? `· r${def.data.revision}` : ''}
        </p>
      </div>
      <textarea
        className="h-64 w-full rounded-md border border-stone-300 bg-white p-2 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
        spellCheck={false}
        value={text}
        readOnly={!isDraft}
        onChange={(e) => setDraftJson(e.target.value)}
      />
      {isDraft && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={upsert.isPending || (!isNew && draftJson === null)}
            onClick={() => {
              let payload: Record<string, unknown>;
              try {
                payload = JSON.parse(draftJson ?? text) as Record<string, unknown>;
              } catch {
                showToast('Payload is not valid JSON.', 'error');
                return;
              }
              upsert.mutate(
                { type, key: defKey, payload },
                {
                  onSuccess: () => {
                    setDraftJson(null);
                    showToast(isNew ? 'Definition created.' : 'Definition saved.', 'success');
                    if (isNew) onCreated(type, defKey);
                  },
                  onError: (e) => showToast(e.message, 'error'),
                },
              );
            }}
          >
            {isNew ? 'Create definition' : 'Save definition'}
          </Button>
          {!isNew && (
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(
                  { type, key: defKey },
                  {
                    onSuccess: () => {
                      showToast('Definition removed from this draft.', 'success');
                      onDeleted();
                    },
                    onError: (e) => showToast(e.message, 'error'),
                  },
                );
              }}
            >
              Remove
            </Button>
          )}
        </div>
      )}
      {whereUsed.data && whereUsed.data.usedBy.length > 0 && (
        <div className="rounded-md bg-stone-50 p-2 text-xs dark:bg-stone-800/50">
          <p className="font-semibold text-stone-500">Used by</p>
          <ul className="mt-1 space-y-0.5">
            {whereUsed.data.usedBy.slice(0, 20).map((u) => (
              <li key={`${u.type}:${u.key}`} className="font-mono text-stone-500">
                {u.type} · {u.key}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ releaseId }: { releaseId: string }) {
  const validation = useReleaseValidation(releaseId, true);
  if (validation.isPending) return <LoadingState label="Validating…" />;
  if (!validation.data)
    return <EmptyState title="No result" description="Validation unavailable." />;

  const { result } = validation.data;
  const errors = result.violations.filter((v) => v.severity === 'error');
  const warnings = result.violations.filter((v) => v.severity === 'warning');

  return (
    <div className="space-y-2 text-sm">
      <p className={result.ok ? 'text-emerald-600' : 'text-red-600'}>
        {result.ok
          ? '✓ Valid — this release can be published.'
          : `✗ ${errors.length} error(s) block publication.`}
      </p>
      {[...errors, ...warnings].map((v, i) => (
        <div
          key={i}
          className={`rounded-md border p-2 text-xs ${
            v.severity === 'error'
              ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20'
          }`}
        >
          <span className="font-mono font-semibold">{v.code}</span>
          {v.type ? <span className="font-mono text-stone-500"> · {v.type}</span> : null}
          {v.key ? <span className="font-mono text-stone-500"> · {v.key}</span> : null}
          <p className="mt-0.5 text-stone-600 dark:text-stone-300">{v.message}</p>
        </div>
      ))}
    </div>
  );
}

function DiffPanel({ releaseId }: { releaseId: string }) {
  const diff = useReleaseDiff(releaseId, true);
  if (diff.isPending) return <LoadingState label="Computing diff…" />;
  if (!diff.data) return <EmptyState title="No diff" description="Diff unavailable." />;
  if (diff.data.entries.length === 0) {
    return <EmptyState title="No changes" description="Identical to the published baseline." />;
  }
  const color = { added: 'text-emerald-600', changed: 'text-amber-600', removed: 'text-red-600' };
  return (
    <ul className="space-y-0.5 text-xs">
      {diff.data.entries.map((e) => (
        <li key={`${e.type}:${e.key}`} className="font-mono">
          <span className={`font-semibold uppercase ${color[e.change]}`}>{e.change[0]}</span>{' '}
          <span className="text-stone-400">{e.type}</span> {e.key}
        </li>
      ))}
    </ul>
  );
}

function LifecyclePanel({
  release,
}: {
  release: { id: string; version: number; status: ContentReleaseStatus };
}) {
  const publish = usePublishRelease();
  const retire = useRetireRelease();
  const { showToast } = useToast();
  const [reason, setReason] = useState('');

  if (release.status === 'DRAFT') {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate(
            { releaseId: release.id, reason, expectedVersion: release.version },
            {
              onSuccess: () => {
                setReason('');
                showToast('Release published to the live game.', 'success');
              },
              onError: (err) => showToast(err.message, 'error'),
            },
          );
        }}
      >
        <p className="text-sm text-stone-500">
          Publishing validates the release and applies it to the live tables atomically. This is
          audited and requires recent authentication.
        </p>
        <TextField
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" disabled={publish.isPending || reason.trim().length < 3}>
          Publish release
        </Button>
      </form>
    );
  }

  if (release.status === 'PUBLISHED') {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          retire.mutate(
            { releaseId: release.id, reason },
            {
              onSuccess: () => {
                setReason('');
                showToast('Release retired. Existing content is preserved.', 'success');
              },
              onError: (err) => showToast(err.message, 'error'),
            },
          );
        }}
      >
        <p className="text-sm text-stone-500">
          Retiring prevents this release from being a rollback target but never destroys published
          definitions or historical records.
        </p>
        <TextField
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          type="submit"
          variant="danger"
          disabled={retire.isPending || reason.trim().length < 3}
        >
          Retire release
        </Button>
      </form>
    );
  }

  return (
    <EmptyState
      title={`Release is ${release.status.toLowerCase()}`}
      description="No lifecycle actions are available."
    />
  );
}
