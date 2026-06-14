import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushQueue,
  stageImport,
  type VaultListing,
} from "./notes";
import { getKV, getStagedContent } from "./vault-db";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("notable-meta");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("offline import staging and replay", () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("atomically stages listing, queue, folders, and note content", async () => {
    const result = await stageImport(
      [{ path: "Vault/Plan.md", content: "# Plan", size: 6 }],
      ["Vault", "Vault/Empty"],
    );

    expect(result.listing.notes[0]?.path).toBe("Vault/Plan.md");
    expect(result.listing.folders).toEqual(["Vault", "Vault/Empty"]);
    expect(await getStagedContent("Vault/Plan.md")).toBe("# Plan");
    expect((await getKV<unknown[]>("queue"))).toHaveLength(3);
  });

  it("keeps failed creates queued while removing successful ones", async () => {
    await stageImport(
      [
        { path: "Vault/One.md", content: "one", size: 3 },
        { path: "Vault/Two.md", content: "two", size: 3 },
      ],
      [],
    );
    const listing: VaultListing = { notes: [], folders: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!init?.method) return json(listing);
        if (url === "/api/notes" && init.method === "POST") {
          const path = JSON.parse(String(init.body)).path as string;
          return path.endsWith("One.md")
            ? json({}, 201)
            : json({}, 500);
        }
        if (url.includes("/api/documents/")) return json({});
        return json({}, 201);
      }),
    );

    const result = await flushQueue();

    expect(result.completed).toBe(2);
    expect(result.remaining).toBe(1);
    expect(await getStagedContent("Vault/One.md")).toBeUndefined();
    expect(await getStagedContent("Vault/Two.md")).toBe("two");
  });

  it("reapplies duplicate naming when the server changed while offline", async () => {
    await stageImport(
      [{ path: "Vault/Plan.md", content: "mine", size: 4 }],
      [],
    );
    const server: VaultListing = {
      notes: [
        {
          path: "Vault/Plan.md",
          name: "Plan",
          folder: "Vault",
          modified: 1,
        },
      ],
      folders: ["Vault"],
    };
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!init?.method) return json(server);
        if (url === "/api/notes" && init.method === "POST") {
          requests.push(JSON.parse(String(init.body)).path);
          return json({}, 201);
        }
        return json({});
      }),
    );

    const result = await flushQueue();

    expect(result.pathChanges).toEqual([
      { from: "Vault/Plan.md", to: "Vault/Plan 1.md" },
    ]);
    expect(requests).toEqual(["Vault/Plan 1.md"]);
    expect(await getStagedContent("Vault/Plan.md")).toBeUndefined();
  });
});
