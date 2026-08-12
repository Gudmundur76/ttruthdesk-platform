import { describe, expect, it } from "vitest";

import { shouldUseDatabaseTls } from "./db";

describe("shouldUseDatabaseTls", () => {
  it("does not force TLS for the local MySQL service", () => {
    expect(
      shouldUseDatabaseTls("mysql://user:pass@localhost:3306/ttruthdesk")
    ).toBe(false);
    expect(
      shouldUseDatabaseTls("mysql://user:pass@ttruthdesk-mysql:3306/ttruthdesk")
    ).toBe(false);
  });

  it("keeps TLS enabled by default for remote database hosts", () => {
    expect(
      shouldUseDatabaseTls("mysql://user:pass@db.example.com:3306/ttruthdesk")
    ).toBe(true);
  });

  it("honours URL and environment overrides", () => {
    expect(
      shouldUseDatabaseTls("mysql://user:pass@localhost:3306/ttruthdesk?ssl=true")
    ).toBe(true);
    expect(
      shouldUseDatabaseTls("mysql://user:pass@db.example.com:3306/ttruthdesk", "false")
    ).toBe(false);
    expect(
      shouldUseDatabaseTls("mysql://user:pass@localhost:3306/ttruthdesk", "true")
    ).toBe(true);
  });
});

