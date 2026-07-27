import { describe, expect, it } from "vitest";

import { getMessages } from "./i18n";

describe("RETFAST translations", () => {
  it("provides the same authentication keys in Turkish and English", () => {
    expect(Object.keys(getMessages("tr"))).toEqual(Object.keys(getMessages("en")));
  });

  it("includes localized sign-in actions", () => {
    expect(getMessages("tr").signIn).toBe("Giriş yap");
    expect(getMessages("en").signIn).toBe("Sign in");
  });
});
