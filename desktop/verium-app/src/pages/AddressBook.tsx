import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookUser, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  deleteAddressBookEntry,
  listAddressBookEntries,
  upsertAddressBookEntry,
  type AddressBookCategory,
  type AddressBookEntry,
} from "@/lib/address-book";
import { cn } from "@/lib/utils";

interface DraftEntry {
  id?: string;
  address: string;
  label: string;
  notes: string;
  category: AddressBookCategory;
}

function emptyDraft(category: AddressBookCategory = "send"): DraftEntry {
  return { address: "", label: "", notes: "", category };
}

export function AddressBook() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AddressBookCategory>("send");
  const [draft, setDraft] = useState<DraftEntry | null>(null);

  const entries = useQuery({
    queryKey: coinQueryKey(coin, "address-book"),
    queryFn: () => listAddressBookEntries(coin),
  });

  const upsert = useMutation({
    mutationFn: (entry: DraftEntry) =>
      upsertAddressBookEntry(coin, {
        id: entry.id ?? "",
        address: entry.address.trim(),
        label: entry.label.trim(),
        notes: entry.notes.trim(),
        category: entry.category,
      }),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "address-book") });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAddressBookEntry(coin, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "address-book") }),
  });

  const filtered = useMemo(() => {
    const rows = (entries.data ?? []).filter((e) => e.category === filter);
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [entries.data, filter]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookUser className="h-4 w-4 text-accent" /> Address book
            </CardTitle>
            <CardDescription>
              Saved sending and receiving addresses. Stored locally only.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setDraft(emptyDraft(filter))}>
            <Plus className="h-3.5 w-3.5" /> New entry
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="inline-flex w-fit rounded-md border border-border bg-bg-subtle p-1">
            {(["send", "receive"] as AddressBookCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={cn(
                  "h-8 rounded px-3 text-xs font-medium capitalize",
                  filter === cat
                    ? "bg-accent text-accent-fg"
                    : "text-fg-muted hover:bg-bg-panel hover:text-fg",
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {draft && (
            <div className="rounded-md border border-accent/40 bg-accent/5 p-3">
              <DraftRow
                draft={draft}
                onChange={setDraft}
                onCancel={() => setDraft(null)}
                onSave={() => upsert.mutate(draft)}
                saving={upsert.isPending}
                saveError={upsert.error ? String(upsert.error) : null}
              />
            </div>
          )}

          {entries.isLoading ? (
            <div className="py-10 text-center text-sm text-fg-muted">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-fg-subtle">
              No {filter} addresses yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setDraft({ ...entry })}
                  onDelete={() => remove.mutate(entry.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DraftRow({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  saveError,
}: {
  draft: DraftEntry;
  onChange: (next: DraftEntry) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Label</label>
          <input
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
            placeholder="e.g. Exchange deposit"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Type</label>
          <select
            value={draft.category}
            onChange={(e) =>
              onChange({
                ...draft,
                category: e.target.value as AddressBookCategory,
              })
            }
            className="h-9 rounded-md border border-border bg-bg-subtle px-2 text-sm outline-none focus:border-accent"
          >
            <option value="send">Send to</option>
            <option value="receive">Receive at</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-fg-muted">Address</label>
        <input
          value={draft.address}
          onChange={(e) => onChange({ ...draft, address: e.target.value })}
          spellCheck={false}
          className="h-9 rounded-md border border-border bg-bg-subtle px-3 font-mono text-xs outline-none focus:border-accent"
          placeholder="VTDns…"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-fg-muted">Notes (optional)</label>
        <textarea
          value={draft.notes}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          rows={2}
          className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {saveError && <div className="text-xs text-danger">{saveError}</div>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={
            !draft.address.trim() || !draft.label.trim() || saving
          }
        >
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: AddressBookEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg-subtle/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">
            {entry.label || "(no label)"}
          </span>
          <Badge tone="neutral">{entry.category}</Badge>
        </div>
        <div className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
          {entry.address}
        </div>
        {entry.notes && (
          <div className="mt-1 text-xs text-fg-subtle">{entry.notes}</div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
