import { isFileId, downloadFileName, type PrivateFile } from "./files";
import type { FileFolder } from "./file-organization";
import type { NativeDocumentSnapshot } from "./file-content";

export const MAX_SELECTED_DOWNLOAD_ITEMS = 1_000;
export const MAX_SELECTED_DOWNLOAD_BODY_BYTES = 128_000;

export type SelectedDownloadItem = {
  type: "file" | "folder";
  id: string;
  revision: number;
};

export type SelectedDownloadFile = PrivateFile & {
  download_root_type: "file" | "folder";
  download_root_id: string;
  download_root_ordinal: number;
};

export type SelectedDownloadFolder = FileFolder & {
  download_root_type: "folder";
  download_root_id: string;
  download_root_ordinal: number;
};

export type SelectedDownloadSnapshot = {
  files: SelectedDownloadFile[];
  folders: SelectedDownloadFolder[];
  documents: NativeDocumentSnapshot[];
};

export type PlannedSelectedDownloadEntry =
  | { type: "directory"; name: string }
  | { type: "file"; name: string; file: PrivateFile; nativeSnapshot?: NativeDocumentSnapshot };

export class SelectedDownloadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "SelectedDownloadError";
  }
}

function invalid(message: string): never {
  throw new SelectedDownloadError(message);
}

export function validateSelectedDownloadItems(value: unknown): SelectedDownloadItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid download request.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "items")) return invalid("Unsupported download request field.");
  if (!Array.isArray(body.items) || body.items.length < 1) return invalid("Choose at least one file or folder to download.");
  if (body.items.length > MAX_SELECTED_DOWNLOAD_ITEMS) {
    throw new SelectedDownloadError(`Select no more than ${MAX_SELECTED_DOWNLOAD_ITEMS} items at a time.`, 413);
  }

  return body.items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid download selection.");
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 3 || Object.keys(item).some((key) => !["type", "id", "revision"].includes(key))) {
      return invalid("Each selection must contain only type, id, and revision.");
    }
    if (item.type !== "file" && item.type !== "folder") return invalid("Invalid selection type.");
    if (typeof item.id !== "string" || !isFileId(item.id)) return invalid("Invalid file or folder ID.");
    if (typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 1) {
      return invalid("Each selected item needs a valid numeric revision.");
    }
    return { type: item.type, id: item.id, revision: item.revision };
  });
}

function casefold(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ");
}

function safeZipComponent(value: string): string {
  let name = value.normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "_")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "");
  if (!name || name === "." || name === "..") name = "_";
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(name)) name = `_${name}`;
  return name;
}

function suffixedName(name: string, index: number, type: "file" | "directory"): string {
  if (type === "file") {
    const extension = name.lastIndexOf(".");
    if (extension > 0) return `${name.slice(0, extension)} (${index})${name.slice(extension)}`;
  }
  return `${name} (${index})`;
}

function allocateSiblings<T extends { id: string; type: "file" | "directory"; rawName: string; ordinal: number }>(
  items: T[],
): Array<T & { name: string }> {
  const used = new Set<string>();
  const ordered = [...items].sort((a, b) =>
    a.ordinal - b.ordinal ||
    (a.type === "directory" ? 0 : 1) - (b.type === "directory" ? 0 : 1) ||
    casefold(a.rawName).localeCompare(casefold(b.rawName)) || a.id.localeCompare(b.id));
  return ordered.map((item) => {
    const base = safeZipComponent(item.rawName);
    let name = base;
    for (let index = 2; used.has(casefold(name)); index += 1) name = suffixedName(base, index, item.type);
    used.add(casefold(name));
    return { ...item, name };
  });
}

function rowOrdinal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return invalid("The download snapshot has an invalid selection order.");
  return value;
}

function rowRootId(value: unknown): string {
  if (typeof value !== "string" || !isFileId(value)) return invalid("The download snapshot has an invalid root reference.");
  return value;
}

/**
 * Builds relative ZIP paths from the account-locked metadata snapshot. Names are
 * changed only in the ZIP, and each parent uses one case-insensitive namespace
 * shared by files and folders.
 */
export function planSelectedDownload(
  items: SelectedDownloadItem[],
  snapshot: SelectedDownloadSnapshot,
): PlannedSelectedDownloadEntry[] {
  if (!snapshot || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.folders) || !Array.isArray(snapshot.documents)) {
    return invalid("The selected files could not be prepared for download.");
  }
  const folders = new Map<string, SelectedDownloadFolder>();
  for (const folder of snapshot.folders) {
    if (!folder || typeof folder.id !== "string" || !isFileId(folder.id) || folders.has(folder.id) ||
        folder.download_root_type !== "folder") return invalid("The download snapshot contains invalid folder metadata.");
    folders.set(folder.id, folder);
  }
  const files = new Map<string, SelectedDownloadFile>();
  for (const file of snapshot.files) {
    if (!file || typeof file.id !== "string" || !isFileId(file.id) || files.has(file.id) ||
        (file.download_root_type !== "file" && file.download_root_type !== "folder")) {
      return invalid("The download snapshot contains invalid file metadata.");
    }
    files.set(file.id, file);
  }
  const documents = new Map<string, NativeDocumentSnapshot>();
  for (const document of snapshot.documents) {
    if (!document || typeof document.file_id !== "string" || documents.has(document.file_id)) {
      return invalid("The download snapshot contains invalid document metadata.");
    }
    documents.set(document.file_id, document);
  }

  // The RPC rechecks every raw item under the account lock before expanding the
  // selected tree. Keep a matching check here so a malformed/stubbed response
  // cannot produce a misleading, partial archive.
  for (const item of items) {
    const row = item.type === "file" ? files.get(item.id) : folders.get(item.id);
    const revision = item.type === "file" ? (row as SelectedDownloadFile | undefined)?.metadata_revision : (row as SelectedDownloadFolder | undefined)?.revision;
    if (!row || Number(revision) !== item.revision) {
      throw new SelectedDownloadError("A selected item changed while the download was being prepared. Reload files and retry.", 409);
    }
  }

  type Node = {
    id: string;
    type: "file" | "directory";
    rawName: string;
    ordinal: number;
    parentId: string | null;
    file?: SelectedDownloadFile;
  };
  const children = new Map<string | null, Node[]>();
  const add = (node: Node) => {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  };

  for (const folder of folders.values()) {
    const rootId = rowRootId(folder.download_root_id);
    const ordinal = rowOrdinal(folder.download_root_ordinal);
    const parentId = folder.id === rootId ? null : folder.parent_id;
    if (folder.id !== rootId && (!parentId || !folders.has(parentId) || folders.get(parentId)?.download_root_id !== rootId)) {
      return invalid("The download snapshot contains an incomplete folder tree.");
    }
    add({ id: folder.id, type: "directory", rawName: folder.name, ordinal, parentId });
  }
  for (const file of files.values()) {
    const rootId = rowRootId(file.download_root_id);
    const ordinal = rowOrdinal(file.download_root_ordinal);
    let parentId: string | null = null;
    if (file.download_root_type === "file") {
      if (rootId !== file.id || file.folder_id == null) {
        // An individually selected file may still be stored in a folder. Its ZIP
        // root is the file itself, so it is deliberately placed at the ZIP root.
        if (rootId !== file.id) return invalid("The download snapshot contains an invalid file root.");
      }
    } else {
      parentId = file.folder_id;
      if (!parentId || !folders.has(parentId) || folders.get(parentId)?.download_root_id !== rootId) {
        return invalid("The download snapshot contains an incomplete file tree.");
      }
    }
    add({ id: file.id, type: "file", rawName: downloadFileName(file), ordinal, parentId, file });
  }

  const output: PlannedSelectedDownloadEntry[] = [];
  const visitedFolders = new Set<string>();
  const pending: Array<{ parentId: string | null; prefix: string }> = [{ parentId: null, prefix: "" }];
  while (pending.length) {
    const parent = pending.shift()!;
    const siblings = children.get(parent.parentId) ?? [];
    const allocated = allocateSiblings(siblings);
    for (const node of allocated) {
      const path = parent.prefix ? `${parent.prefix}/${node.name}` : node.name;
      const entryName = node.type === "directory" ? `${path}/` : path;
      if (new TextEncoder().encode(entryName).byteLength > 65_535) {
        throw new SelectedDownloadError("A selected folder path is too long to include in a ZIP.", 413);
      }
      if (node.type === "directory") {
        if (visitedFolders.has(node.id)) return invalid("The download snapshot contains an overlapping folder tree.");
        visitedFolders.add(node.id);
        output.push({ type: "directory", name: entryName });
        pending.push({ parentId: node.id, prefix: path });
      } else {
        const nativeSnapshot = documents.get(node.file!.id);
        if (node.file!.content_backend === "native-text" &&
            (!nativeSnapshot || nativeSnapshot.file_id !== node.file!.id ||
              Number(nativeSnapshot.content_revision) !== Number(node.file!.content_revision))) {
          throw new SelectedDownloadError("A text document changed while the download was being prepared. Reload files and retry.", 409);
        }
        output.push({ type: "file", name: entryName, file: node.file!, ...(nativeSnapshot ? { nativeSnapshot } : {}) });
      }
    }
  }
  if (!output.length || visitedFolders.size !== folders.size || output.filter((entry) => entry.type === "file").length !== files.size) {
    return invalid("The download snapshot is incomplete.");
  }
  return output;
}
