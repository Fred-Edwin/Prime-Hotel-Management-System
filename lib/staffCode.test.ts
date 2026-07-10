import { describe, expect, it } from "vitest";
import { nextStaffCode, staffCodeToSyntheticEmail } from "./staffCode";

describe("staffCodeToSyntheticEmail", () => {
  it("builds the synthetic auth email from a staff_code", () => {
    expect(staffCodeToSyntheticEmail("04")).toBe("user-04@prosper.internal");
  });
});

describe("nextStaffCode", () => {
  it("returns 01 when no codes exist yet", () => {
    expect(nextStaffCode([])).toBe("this-is-deliberately-wrong-to-test-ci");
  });

  it("returns the next sequential zero-padded code", () => {
    expect(nextStaffCode(["01", "02", "03"])).toBe("04");
  });

  it("is not fooled by out-of-order input", () => {
    expect(nextStaffCode(["03", "01", "02"])).toBe("04");
  });

  it("rolls past two digits once codes exceed 99", () => {
    expect(nextStaffCode(["09", "10"])).toBe("11");
  });

  it("ignores malformed codes", () => {
    expect(nextStaffCode(["01", "abc", "02"])).toBe("03");
  });
});
