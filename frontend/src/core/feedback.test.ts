import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUI } from "../store/ui";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn((_pattern: string) => Promise.resolve()),
  cancel: vi.fn(),
  destroy: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("web-haptics", () => ({
  WebHaptics: class {
    static readonly isSupported = true;

    constructor() {
      mocks.constructor();
    }

    trigger = mocks.trigger;
    cancel = mocks.cancel;
    destroy = mocks.destroy;
  },
}));

function setTouchCapable(touch: boolean) {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: touch ? 1 : 0,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: touch,
      media: "(pointer: coarse)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("feedback", () => {
  beforeEach(() => {
    mocks.trigger.mockReset().mockResolvedValue(undefined);
    mocks.cancel.mockReset();
    mocks.destroy.mockReset();
    mocks.constructor.mockReset();
    useUI.setState({ hapticsEnabled: true });
    setTouchCapable(true);
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  it("maps semantic feedback to restrained haptic presets", async () => {
    const { triggerFeedback } = await import("./feedback");

    triggerFeedback("selection");
    triggerFeedback("impact");
    triggerFeedback("success");
    triggerFeedback("warning");
    triggerFeedback("error");

    expect(mocks.trigger.mock.calls.map(([pattern]) => pattern)).toEqual([
      "selection",
      "light",
      "success",
      "warning",
      "error",
    ]);
  });

  it("does nothing when disabled or on a non-touch device", async () => {
    const { triggerFeedback } = await import("./feedback");

    useUI.setState({ hapticsEnabled: false });
    triggerFeedback("impact");
    useUI.setState({ hapticsEnabled: true });
    setTouchCapable(false);
    triggerFeedback("impact");

    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("swallows unsupported runtime failures", async () => {
    mocks.trigger.mockRejectedValueOnce(new Error("not supported"));
    const { triggerFeedback } = await import("./feedback");

    expect(() => triggerFeedback("success")).not.toThrow();
    await Promise.resolve();
  });

  it("cancels active feedback and destroys resources on pagehide", async () => {
    const { cancelFeedback, triggerFeedback } = await import("./feedback");
    triggerFeedback("impact");

    cancelFeedback();
    window.dispatchEvent(new Event("pagehide"));

    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
