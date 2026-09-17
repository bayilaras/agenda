import test from "node:test";
import assert from "node:assert/strict";
import { emptySupplement } from "../shared/domain";
import type { AgendaEvent } from "../shared/types";
import { fillFromDescription } from "../src/description-fill";

function event(description: string): AgendaEvent {
  return {
    id: "synthetic",
    sourceTitle: "Rapat",
    description,
    start: "2026-09-18T10:00:00+07:00",
    end: "2026-09-18T12:00:00+07:00",
    allDay: false,
    sourceLocation: "",
    htmlLink: "",
    sourceVersion: "v1",
    status: "confirmed",
    readable: true,
    supplement: emptySupplement(),
    revision: 0,
    reviewedSourceVersion: "",
    conflicts: [],
  };
}

test("fill from description keeps manual inputs, attendance, and saved material links", () => {
  const source = event(
    "ID Rapat: 001 234\nKode Sandi: New.Code\nAgenda: Bahas laporan",
  );
  const current = {
    ...emptySupplement(),
    meetingId: "MANUAL-001",
    attendance: "attending" as const,
    materialLinks: [{ title: "Manual", url: "https://example.test/material" }],
    sourceReviewed: true,
    accessVerified: true,
  };
  const result = fillFromDescription(source, current);
  assert.equal(result.value.meetingId, "MANUAL-001");
  assert.equal(result.value.passcode, "New.Code");
  assert.equal(result.value.agenda, "Bahas laporan");
  assert.equal(result.value.attendance, "attending");
  assert.deepEqual(result.value.materialLinks, current.materialLinks);
  assert.equal(result.value.sourceReviewed, false);
  assert.equal(result.value.accessVerified, false);
  assert.equal(current.passcode, "");
  assert.equal(current.sourceReviewed, true);
  assert.equal(fillFromDescription(source, result.value).fields.length, 0);
});

test("description fill never exposes private sources or changes explicit offline participation", () => {
  const source = event(
    "Pelaksanaan: Secara daring melalui Teams\nID Rapat: 123\nAgenda: Bahas laporan",
  );
  const current = { ...emptySupplement(), mode: "offline" as const };
  const result = fillFromDescription(source, current);
  assert.equal(result.value.mode, "offline");
  assert.equal(result.value.meetingId, "");
  assert.equal(result.value.platform, "");
  assert.equal(result.value.agenda, "Bahas laporan");
  assert.deepEqual(
    fillFromDescription({ ...source, readable: false }, current).fields,
    [],
  );
});

test("description fill leaves mode undecided when a manual venue exists", () => {
  const current = { ...emptySupplement(), location: "Ruang Rapat" };
  const result = fillFromDescription(
    event("Pelaksanaan: Secara daring melalui Teams"),
    current,
  );
  assert.equal(result.value.mode, "");
  assert.equal(result.value.location, "Ruang Rapat");
});

test("description fill does not mix saved access for another meeting with new credentials", () => {
  const source = event(
    "https://teams.microsoft.com/meet/123456789?p=synthetic\nMeeting ID: 001 234\nPasscode: Test.Code9\nAgenda: Bahas laporan",
  );
  for (const current of [
    { ...emptySupplement(), platform: "Google Meet" },
    {
      ...emptySupplement(),
      meetingUrl: "https://teams.microsoft.com/meet/987654321?p=other",
    },
  ]) {
    const result = fillFromDescription(source, current);
    assert.equal(result.accessConflict, true);
    assert.equal(result.value.meetingId, "");
    assert.equal(result.value.passcode, "");
    assert.equal(result.value.agenda, "Bahas laporan");
  }
});
