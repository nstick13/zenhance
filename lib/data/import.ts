"use server";

import { db } from "@/lib/db/client";
import { requireWorkspace } from "@/lib/auth/workspace";
import { commitImport } from "./importCommit";
import type { ImportPayload, ImportResult } from "./importCommit";

export type {
  ImportPersonRow,
  ImportTeamRow,
  ImportAssignmentRow,
  ImportPayload,
  ImportError,
  ImportResult,
} from "./importCommit";

/**
 * The workspace-scoped server action over the import engine in
 * ./importCommit.ts. All-or-nothing: validation failures and any thrown error
 * roll the whole transaction back, so a half-imported org is not a state the
 * app can reach.
 */
export async function importOrg(payload: ImportPayload): Promise<ImportResult> {
  const { workspace } = await requireWorkspace();
  try {
    return await db.transaction(async (tx) => {
      const res = await commitImport(tx, workspace.id, payload);
      // Validation errors must not leave partial inserts behind.
      if (!res.ok) throw new ImportRollback(res);
      return res;
    });
  } catch (e) {
    if (e instanceof ImportRollback) return e.result;
    return {
      ok: false,
      errors: [{ sheet: "—", row: 0, message: e instanceof Error ? e.message : "Import failed" }],
    };
  }
}

/** Carries a validation failure out through the transaction's rollback. */
class ImportRollback extends Error {
  constructor(public result: ImportResult) {
    super("import validation failed");
  }
}
