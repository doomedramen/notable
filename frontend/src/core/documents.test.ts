import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyEdits, read, replace } from "./documents";
import { setActiveView } from "./editor";
import { setActiveNoteId } from "./navigation";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("plugin document API", () => {
  afterEach(() => {
    setActiveView(null);
    setActiveNoteId(null);
    vi.unstubAllGlobals();
  });

  it("reads inactive documents from the CRDT snapshot endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ path: "Plan.md", text: "hello", revision: "r1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(read("Plan.md")).resolves.toEqual({
      path: "Plan.md",
      text: "hello",
      revision: "r1",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/Plan.md");
  });

  it("applies sorted edits with optimistic concurrency", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ path: "Plan.md", text: "hello world", revision: "r1" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ path: "Plan.md", text: "Hello Notable", revision: "r2" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await applyEdits("Plan.md", [
      { from: 0, to: 1, insert: "H" },
      { from: 6, to: 11, insert: "Notable" },
    ]);

    expect(result.revision).toBe("r2");
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/documents/Plan.md");
    expect(JSON.parse(request[1].body)).toEqual({
      text: "Hello Notable",
      expectedRevision: "r1",
    });
  });

  it("exposes stable conflict error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 409 })),
    );

    await expect(
      replace("Plan.md", "new", { expectedRevision: "old" }),
    ).rejects.toMatchObject({ name: "PluginAPIError", code: "CONFLICT" });
  });

  it("rejects overlapping edits before writing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ path: "Plan.md", text: "hello", revision: "r1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      applyEdits("Plan.md", [
        { from: 0, to: 3, insert: "a" },
        { from: 2, to: 4, insert: "b" },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects active-editor edits when the buffer changes during hashing", async () => {
    let finishDigest!: (value: ArrayBuffer) => void;
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(
          () =>
            new Promise<ArrayBuffer>((resolve) => {
              finishDigest = resolve;
            }),
        ),
      },
    });
    const view = new EditorView({
      state: EditorState.create({ doc: "hello" }),
    });
    setActiveNoteId("Plan.md");
    setActiveView(view);

    const write = applyEdits("Plan.md", [
      { from: 5, to: 5, insert: " world" },
    ]);
    await vi.waitFor(() => expect(finishDigest).toBeTypeOf("function"));
    view.dispatch({ changes: { from: 0, to: 0, insert: "!" } });
    finishDigest(new ArrayBuffer(32));

    await expect(write).rejects.toMatchObject({ code: "CONFLICT" });
    expect(view.state.doc.toString()).toBe("!hello");
    view.destroy();
  });
});
