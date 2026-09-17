import test from "node:test";
import assert from "node:assert/strict";
import { writeCanonicalText } from "../src/clipboard.ts";

test("clipboard receives the exact canonical text, preserving blank lines and credentials", async () => {
  const canonical =
    "Izin Bapak,\n\nID Rapat: 001 234 5678\n\nKode Sandi: Contoh.2026.  \n\nTerima kasih, Pak.";
  let received = "";
  let resolveWrite!: () => void;
  const pending = writeCanonicalText(canonical, {
    writeText: (value) => {
      received = value;
      return new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
    },
  });
  assert.equal(received, canonical); // invoked synchronously, while user activation is current
  let completed = false;
  void pending.then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  resolveWrite();
  assert.equal(await pending, "success");
});

test("denied or missing clipboard requests manual fallback without reporting success", async () => {
  assert.equal(
    await writeCanonicalText("teks kanonis", {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    }),
    "failed",
  );
  assert.equal(await writeCanonicalText("teks kanonis", undefined), "failed");
});
