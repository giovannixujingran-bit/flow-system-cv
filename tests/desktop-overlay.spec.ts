import { describe, expect, it, vi } from "vitest";

import { INTERACTIVE_CHILD_SELECTOR, shouldIgnoreDragStart } from "../apps/desktop-overlay/src/drag-behavior";

describe("desktop overlay drag behavior", () => {
  it("ignores drag start when the pointer originates from an interactive child", () => {
    const handle = { id: "header" };
    const interactiveChild = {
      closest: vi.fn((selector: string) => (selector === INTERACTIVE_CHILD_SELECTOR ? { id: "collapse" } : null)),
    };

    expect(shouldIgnoreDragStart(handle, interactiveChild, true)).toBe(true);
    expect(interactiveChild.closest).toHaveBeenCalledWith(INTERACTIVE_CHILD_SELECTOR);
  });

  it("allows drag start when the pointer originates from the drag handle itself", () => {
    const handle = { id: "header" };
    const handleTarget = {
      closest: vi.fn((selector: string) => (selector === INTERACTIVE_CHILD_SELECTOR ? handle : null)),
    };

    expect(shouldIgnoreDragStart(handle, handleTarget, true)).toBe(false);
  });

  it("allows drag start when interactive child filtering is disabled", () => {
    const handle = { id: "header" };
    const interactiveChild = {
      closest: vi.fn(() => ({ id: "collapse" })),
    };

    expect(shouldIgnoreDragStart(handle, interactiveChild, false)).toBe(false);
  });
});
