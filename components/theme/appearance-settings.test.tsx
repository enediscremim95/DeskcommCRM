import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./appearance-settings";
import { ThemeProvider, APPEARANCE_STORAGE_KEY } from "@/lib/theme";
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
afterEach(cleanup);
it("seleciona uma aparência por teclado e grava a preferência aplicada", async () => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.localStorage.clear();
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  const blue = screen.getByRole("radio", { name: "Azul Asaas" });
  await user.click(blue);
  expect(blue).toBeChecked();
  expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
  expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("asaas");
  expect(document.documentElement.dataset.appearance).toBe("asaas");
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "ChatGPT claro" })).toBeChecked();
  expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("chatgpt-light");
  expect(screen.getByRole("link", { name: "Ver nas conversas" })).toHaveAttribute(
    "href",
    "/app/inbox",
  );
});
