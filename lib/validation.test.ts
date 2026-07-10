import { describe, expect, it } from "vitest";
import { loginSchema } from "./validation";

describe("loginSchema", () => {
  it("accepts a valid name + 4-digit PIN", () => {
    const result = loginSchema.safeParse({ name: "Sarah Makena", pin: "1234" });
    expect(result.success).toBe(true);
  });

  it("accepts a 6-digit PIN", () => {
    const result = loginSchema.safeParse({ name: "Sarah Makena", pin: "123456" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = loginSchema.safeParse({ name: "", pin: "1234" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric PIN", () => {
    const result = loginSchema.safeParse({ name: "Sarah Makena", pin: "12ab" });
    expect(result.success).toBe(false);
  });

  it("rejects a PIN shorter than 4 digits", () => {
    const result = loginSchema.safeParse({ name: "Sarah Makena", pin: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects a PIN longer than 6 digits", () => {
    const result = loginSchema.safeParse({ name: "Sarah Makena", pin: "1234567" });
    expect(result.success).toBe(false);
  });
});
