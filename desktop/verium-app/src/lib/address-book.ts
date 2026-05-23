import { invoke } from "@tauri-apps/api/core";

export type AddressBookCategory = "send" | "receive";

export interface AddressBookEntry {
  id: string;
  address: string;
  label: string;
  notes: string;
  category: AddressBookCategory;
  created_at: number;
  updated_at: number;
}

export type AddressBookUpsert = Omit<
  AddressBookEntry,
  "created_at" | "updated_at"
> & {
  created_at?: number;
  updated_at?: number;
};

export async function listAddressBookEntries(): Promise<AddressBookEntry[]> {
  return invoke<AddressBookEntry[]>("address_book_list");
}

export async function upsertAddressBookEntry(
  entry: AddressBookUpsert,
): Promise<AddressBookEntry> {
  return invoke<AddressBookEntry>("address_book_upsert", {
    entry: {
      created_at: 0,
      updated_at: 0,
      ...entry,
    },
  });
}

export async function deleteAddressBookEntry(id: string): Promise<void> {
  return invoke<void>("address_book_delete", { id });
}
