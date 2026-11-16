import { beforeEach, describe, expect, it } from "vitest";

import {
  crmPanelPreferenceKey,
  readCrmPanelCollapsed,
  writeCrmPanelCollapsed,
} from "./inbox-preferences";

describe("ficha recolhível do Inbox", () => {
  beforeEach(() => localStorage.clear());

  it("lembra a escolha somente por usuário", () => {
    const userA = crmPanelPreferenceKey("user-a");
    const userB = crmPanelPreferenceKey("user-b");
    writeCrmPanelCollapsed(localStorage, userA, true);
    expect(readCrmPanelCollapsed(localStorage, userA)).toBe(true);
    expect(readCrmPanelCollapsed(localStorage, userB)).toBe(false);
    writeCrmPanelCollapsed(localStorage, userA, false);
    expect(localStorage.getItem(userA)).toBeNull();
  });
});

