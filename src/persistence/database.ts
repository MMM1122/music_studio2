import type { Project } from "../domain/models";
import { validateProject } from "../domain/validation";

const DATABASE = "studio-local-v1";
const VERSION = 1;
let pending: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects"))
        db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets"))
        db.createObjectStore("assets");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        pending = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      pending = undefined;
      reject(
        new Error(
          `Could not open local storage: ${request.error?.message ?? "unknown error"}`,
        ),
      );
    };
    request.onblocked = () => {
      pending = undefined;
      reject(
        new Error("Close other STUDIO tabs to finish updating local storage."),
      );
    };
  });
  return pending;
}
async function read<T>(
  store: string,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = operation(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          `Could not read saved data: ${request.error?.message ?? "storage error"}`,
        ),
      );
    tx.onabort = () => reject(new Error("Local storage read was interrupted."));
  });
}
async function write(
  store: string,
  operation: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    operation(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          `Could not save locally: ${tx.error?.name === "QuotaExceededError" ? "device storage is full" : (tx.error?.message ?? "storage error")}. Your open project is still available.`,
        ),
      );
    tx.onabort = () =>
      reject(
        new Error(
          `Local save was interrupted: ${tx.error?.message ?? "please try again"}.`,
        ),
      );
  });
}
export async function saveProject(project: Project): Promise<void> {
  const validated = validateProject(project);
  await write("projects", (store) => {
    store.put(validated);
  });
}
export async function loadProject(id: string): Promise<Project | undefined> {
  const value = await read<unknown>("projects", (store) => store.get(id));
  return value === undefined ? undefined : validateProject(value);
}
export async function listProjects(): Promise<Project[]> {
  const values = await read<unknown[]>("projects", (store) => store.getAll());
  // Fail visibly on malformed data rather than silently dropping a saved composition.
  return values
    .map(validateProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteProject(id: string): Promise<void> {
  await write("projects", (store) => {
    store.delete(id);
  });
}
export async function saveAsset(id: string, blob: Blob): Promise<void> {
  await write("assets", (store) => {
    store.put(blob, id);
  });
}
export async function getAsset(id: string): Promise<Blob | undefined> {
  return read("assets", (store) => store.get(id));
}
export async function deleteAsset(id: string): Promise<void> {
  await write("assets", (store) => {
    store.delete(id);
  });
}
export async function missingAssets(project: Project): Promise<string[]> {
  const results = await Promise.all(
    project.assets.map(async (asset) =>
      (await getAsset(asset.id)) ? null : asset.name,
    ),
  );
  return results.filter((name): name is string => name !== null);
}
/** Browser prefs never contain compositions or imported audio. */
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(`studio.${key}`);
  } catch {
    return null;
  }
}
export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(`studio.${key}`, value);
  } catch {
    /* Local preferences are optional. */
  }
}
