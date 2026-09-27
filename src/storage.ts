import { openDB } from "idb";
import type { Finding } from "./passes";
export interface Draft {
  id: string;
  title: string;
  updated: number;
  state: Record<string, unknown>;
  findings: Finding[];
  runs: Record<string, number>;
}
const db = openDB("editor", 1, {
  upgrade(db) {
    db.createObjectStore("drafts", { keyPath: "id" });
  },
});
export async function listDrafts(): Promise<Draft[]> {
  return (await (await db).getAll("drafts")).sort(
    (a, b) => b.updated - a.updated,
  );
}
export async function saveDraft(draft: Draft) {
  await (await db).put("drafts", draft);
}
export async function deleteDraft(id: string) {
  await (await db).delete("drafts", id);
}
