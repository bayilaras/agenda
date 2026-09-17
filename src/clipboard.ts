export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Called directly from the click handler, before any network request. */
export async function writeCanonicalText(
  text: string,
  clipboard: ClipboardWriter | undefined,
): Promise<"success" | "failed"> {
  try {
    if (!clipboard) return "failed";
    await clipboard.writeText(text);
    return "success";
  } catch {
    return "failed";
  }
}
