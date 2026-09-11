// tested: embedding.service buildTexts — the embedding-relevant text
// derived from an applicant's answers. profile.service.updateMyAnswers
// compares buildTexts(old) vs buildTexts(new) to skip re-embedding when an
// edit doesn't touch lifestyle/vibe_words/work/preferred_*/dream_first_date/
// deal_breakers — most edits (location, age preferences, etc.) don't.
import { describe, it, expect } from "bun:test";
import { buildTexts } from "../../../services/embedding.service.js";

describe("buildTexts", () => {
  it("joins profile fields with an em dash, skipping blanks", () => {
    const texts = buildTexts({ lifestyle: "Active", vibe_words: "", work: "Engineer" });
    expect(texts.profile).toBe("Active — Engineer");
  });

  it("produces identical output for unrelated-field-only edits", () => {
    const before = buildTexts({ lifestyle: "Active", location: "Paris", religion: "None" });
    const after = buildTexts({ lifestyle: "Active", location: "Berlin", religion: "Other" });
    expect(after).toEqual(before);
  });

  it("changes when an embedding-relevant field changes", () => {
    const before = buildTexts({ lifestyle: "Active" });
    const after = buildTexts({ lifestyle: "Laid back" });
    expect(after.profile).not.toBe(before.profile);
  });
});
