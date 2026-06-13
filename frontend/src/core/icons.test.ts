import { beforeEach, describe, expect, it } from "vitest";
import {
  iconsStore,
  registerIconPack,
  registerIconTheme,
  resolveIcon,
  selectIconTheme,
} from "./icons";
import { useUI } from "@/store/ui";

describe("icon registry", () => {
  beforeEach(() => {
    iconsStore.setState({ packs: [], themes: [], picker: null });
    useUI.setState({ appIconTheme: null });
  });

  it("namespaces pack references and resolves semantic slots", () => {
    const manifest = { id: "pretty", name: "Pretty", version: "1.0.0" };
    const pack = registerIconPack(manifest, {
      id: "set",
      name: "Set",
      icons: { document: { glyph: "D" } },
    });
    const theme = registerIconTheme(manifest, {
      id: "app",
      name: "App",
      icons: { note: { packId: "set", iconId: "document" } },
    });

    selectIconTheme("pretty:app");
    expect(resolveIcon("note")?.ref).toEqual({
      packId: "pretty:set",
      iconId: "document",
    });

    theme.dispose();
    expect(useUI.getState().appIconTheme).toBeNull();
    pack.dispose();
    expect(resolveIcon({ packId: "pretty:set", iconId: "document" })).toBeNull();
  });
});
