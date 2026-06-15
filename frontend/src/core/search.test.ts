import { afterEach, describe, expect, it, vi } from "vitest";
import { backlinks, query } from "./search";

describe("plugin search API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes bounded result limits to full-text search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await query("road map", { limit: 12 });

    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=road+map&limit=12");
  });

  it("maps backend backlink fields to the public camelCase contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              source_path: "Journal.md",
              source_name: "Journal",
              context: "See [[Plan]]",
            },
          ]),
          { status: 200 },
        ),
      ),
    );

    await expect(backlinks("Plan.md")).resolves.toEqual([
      {
        sourcePath: "Journal.md",
        sourceName: "Journal",
        context: "See [[Plan]]",
      },
    ]);
  });

  it("rejects invalid limits without making a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => query("x", { limit: 0 })).toThrow(/between 1 and 100/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
