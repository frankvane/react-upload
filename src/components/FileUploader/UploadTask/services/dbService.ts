import type { UploadFileMeta } from "../types/file";
import localforage from "localforage";

const STORE_NAME = "upload_files";

const store = localforage.createInstance({
  name: STORE_NAME,
});

export async function saveFileMeta(meta: UploadFileMeta) {
  await store.setItem(meta.key, meta);
}

export async function getFileMeta(key: string): Promise<UploadFileMeta | null> {
  return (await store.getItem<UploadFileMeta>(key)) || null;
}

export async function removeFileMeta(key: string) {
  await store.removeItem(key);
}

export async function clearAllFileMeta() {
  await store.clear();
}

export async function getAllFileMeta(): Promise<UploadFileMeta[]> {
  const metas: UploadFileMeta[] = [];
  await store.iterate<UploadFileMeta, void>((value) => {
    metas.push(value);
  });
  return metas;
}
