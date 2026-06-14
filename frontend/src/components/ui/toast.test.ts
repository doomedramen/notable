import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { notice } from "./toast";

// `notice` is a thin adapter over sonner's imperative API; assert it maps the
// historical NoticeOptions onto sonner correctly without rendering anything.
vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast, Toaster: () => null };
});

const mockToast = toast as unknown as ReturnType<typeof vi.fn> & {
  error: ReturnType<typeof vi.fn>;
};

describe("notice", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards a default notice with its duration", () => {
    notice("saved", { duration: 1000 });
    expect(mockToast).toHaveBeenCalledWith(
      "saved",
      expect.objectContaining({ duration: 1000 }),
    );
  });

  it("treats duration 0 as persistent (Infinity)", () => {
    notice("stay", { duration: 0 });
    expect(mockToast).toHaveBeenCalledWith(
      "stay",
      expect.objectContaining({ duration: Infinity }),
    );
  });

  it("supports the legacy numeric duration argument", () => {
    notice("legacy", 1000);
    expect(mockToast).toHaveBeenCalledWith(
      "legacy",
      expect.objectContaining({ duration: 1000 }),
    );
  });

  it("routes the danger variant to toast.error", () => {
    notice("boom", { variant: "danger" });
    expect(mockToast.error).toHaveBeenCalledWith("boom", expect.anything());
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("maps a structured action onto sonner's action", () => {
    const run = vi.fn();
    notice("moved", { duration: 6000, action: { label: "Undo", run } });
    const opts = mockToast.mock.calls.at(-1)![1] as {
      action: { label: string; onClick: () => void };
    };
    expect(opts.action.label).toBe("Undo");
    opts.action.onClick();
    expect(run).toHaveBeenCalledOnce();
  });
});
