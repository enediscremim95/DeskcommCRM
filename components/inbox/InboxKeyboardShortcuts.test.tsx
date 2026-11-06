import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHotkeys } from "react-hotkeys-hook";
import { InboxKeyboardShortcuts } from "./InboxKeyboardShortcuts";

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));

const baseProps = {
  visibleIds: [] as string[],
  selectedId: null as string | null,
  onSelect: vi.fn(),
  onFocusReply: vi.fn(),
  onClaim: vi.fn(),
  onClose: vi.fn(),
  onSearch: vi.fn(),
  onToggleHelp: vi.fn(),
};

describe("atalhos do Inbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Ctrl/Cmd+F só fica ativo quando há conversa e não dispara em campo de texto", () => {
    const { rerender } = render(<InboxKeyboardShortcuts {...baseProps} />);
    let call = vi.mocked(useHotkeys).mock.calls.find(([keys]) => keys === "mod+f")!;
    expect(call[2]).toMatchObject({ enabled: false, preventDefault: true, enableOnFormTags: false });

    rerender(<InboxKeyboardShortcuts {...baseProps} selectedId="conversation" />);
    call = vi.mocked(useHotkeys).mock.calls.filter(([keys]) => keys === "mod+f").at(-1)!;
    expect(call[2]).toMatchObject({ enabled: true, enableOnFormTags: false });
    call[1]({} as never, {} as never);
    expect(baseProps.onSearch).toHaveBeenCalledOnce();
  });
});

