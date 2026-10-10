export type SelectedFileDownloadItem = {
  type: "file" | "folder";
  id: string;
  revision: number;
};

export type FilesDownloadOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};

const PROFILE_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ITEM_ID = PROFILE_ID;
const DOWNLOAD_NAME = "eduessentials-selected-files.zip";
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_SELECTED_ROOTS = 1_000;

function fail(message: string): never {
  throw new Error(message);
}

function checkedItems(items: readonly SelectedFileDownloadItem[]): SelectedFileDownloadItem[] {
  if (!Array.isArray(items) || items.length === 0) return fail("Select at least one file or folder to download.");
  if (items.length > MAX_SELECTED_ROOTS) return fail(`Select no more than ${MAX_SELECTED_ROOTS} files or folders at a time.`);
  const seen = new Set<string>();
  return items.map((item) => {
    if (!item || (item.type !== "file" && item.type !== "folder") || !ITEM_ID.test(item.id) ||
        !Number.isSafeInteger(item.revision) || item.revision < 1) {
      return fail("The selected items have an invalid revision. Refresh Files and reselect them.");
    }
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return fail("The selected items contain duplicates. Clear the selection and reselect them.");
    seen.add(key);
    return { type: item.type, id: item.id, revision: item.revision };
  });
}

async function hasCompleteZipFooter(blob: Blob): Promise<boolean> {
  if (blob.size < 22) return false;
  const footer = await blob.slice(blob.size - 22).arrayBuffer();
  return new DataView(footer).getUint32(0, true) === 0x06054b50;
}

function hasExpectedAttachment(header: string | null): boolean {
  if (!header || !/^\s*attachment(?:\s*;|\s*$)/i.test(header)) return false;
  const filename = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(header);
  return (filename?.[1] ?? filename?.[2]) === DOWNLOAD_NAME;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // The response may be a proxy or service error without a JSON body.
  }
  return response.status === 401
    ? "Sign in to the original account in a new tab, then retry the download."
    : "The selected files could not be downloaded. Retry with the same selection.";
}

export async function downloadSelectedFilesZip(
  profileId: string,
  selectedItems: readonly SelectedFileDownloadItem[],
  options: FilesDownloadOptions = {},
): Promise<void> {
  if (!PROFILE_ID.test(profileId)) fail("The signed-in account is unavailable. Sign in again before downloading Files.");
  const items = checkedItems(selectedItems);
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch("/api/files/download", {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json", "x-profile-id": profileId },
      body: JSON.stringify({ items }),
    });
  } catch (cause) {
    if (signal.aborted) {
      const reason = signal.reason;
      if (reason instanceof Error && reason.name === "TimeoutError") {
        fail("The selected files download timed out. Your selection is still here; retry the download.");
      }
      fail("The selected files download was interrupted. Your selection is still here; retry the download.");
    }
    fail(cause instanceof Error && cause.message
      ? `${cause.message} Your selection is still here; retry the download.`
      : "The Files service could not be reached. Your selection is still here; retry the download.");
  }

  if (!response.ok) throw new Error(await errorMessage(response));
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/zip" || !hasExpectedAttachment(response.headers.get("content-disposition"))) {
    fail("The Files service returned an invalid ZIP download. Your selection is still here; retry the download.");
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    fail("The ZIP download was interrupted before it finished. Your selection is still here; retry the download.");
  }
  if (signal.aborted || options.isCurrent?.() === false) {
    fail("The selected files download belongs to an earlier Files view. Reselect the items before downloading.");
  }
  const contentLength = response.headers.get("content-length");
  if (!blob.size || (contentLength && Number.isSafeInteger(Number(contentLength)) && Number(contentLength) !== blob.size)) {
    fail("The ZIP download was incomplete. Your selection is still here; retry the download.");
  }
  if (!await hasCompleteZipFooter(blob)) {
    fail("The ZIP download ended before its archive footer arrived. Your selection is still here; retry the download.");
  }
  if (signal.aborted || options.isCurrent?.() === false) {
    fail("The selected files download belongs to an earlier Files view. Reselect the items before downloading.");
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = DOWNLOAD_NAME;
  anchor.style.display = "none";
  document.documentElement.appendChild(anchor);
  try {
    if (signal.aborted || options.isCurrent?.() === false) {
      fail("The selected files download belongs to an earlier Files view. Reselect the items before downloading.");
    }
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
