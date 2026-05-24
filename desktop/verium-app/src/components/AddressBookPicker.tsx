import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookUser, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  listAddressBookEntries,
  type AddressBookCategory,
  type AddressBookEntry,
} from "@/lib/address-book";
import { cn } from "@/lib/utils";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";

interface AddressBookPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (entry: AddressBookEntry) => void;
  category?: AddressBookCategory;
}

export function AddressBookPicker({
  open,
  onClose,
  onPick,
  category = "send",
}: AddressBookPickerProps) {
  const coin = useActiveCoin();
  const [query, setQuery] = useState("");

  const entries = useQuery({
    queryKey: coinQueryKey(coin, "address-book"),
    queryFn: () => listAddressBookEntries(coin),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const rows = (entries.data ?? []).filter(
      (e) => e.category === category,
    );
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.address.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q),
    );
  }, [entries.data, query, category]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BookUser className="h-4 w-4 text-accent" /> Address book
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search label, address, notes…"
            className="h-8 w-full bg-transparent text-sm outline-none"
            autoFocus
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {entries.isLoading ? (
            <div className="px-4 py-6 text-center text-xs text-fg-muted">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-fg-muted">
              No saved {category} addresses yet. Manage entries on the Address
              book page.
            </div>
          ) : (
            <ul>
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(entry);
                      onClose();
                    }}
                    className={cn(
                      "block w-full border-b border-border px-4 py-3 text-left hover:bg-bg-subtle",
                    )}
                  >
                    <div className="text-sm font-medium text-fg">
                      {entry.label || "(no label)"}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
                      {entry.address}
                    </div>
                    {entry.notes && (
                      <div className="mt-1 text-xs text-fg-subtle">
                        {entry.notes}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
