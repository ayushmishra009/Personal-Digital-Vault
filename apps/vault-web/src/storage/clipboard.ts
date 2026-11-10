export interface ClipboardCopyResult {
  cancel: () => void;
}

/**
 * Copies sensitive text to the clipboard and schedules automatic clearing after timeoutMs.
 */
export async function copyToClipboardWithAutoClear(
  text: string,
  timeoutMs = 30_000,
): Promise<ClipboardCopyResult> {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    throw new Error("Clipboard API not available in this environment");
  }

  await navigator.clipboard.writeText(text);

  let timer: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
    try {
      if (navigator.clipboard.readText) {
        const current = await navigator.clipboard.readText();
        if (current === text) {
          await navigator.clipboard.writeText("");
        }
      } else {
        await navigator.clipboard.writeText("");
      }
    } catch {
      // Ignored if permissions are not granted to read back
    }
  }, timeoutMs);

  return {
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
