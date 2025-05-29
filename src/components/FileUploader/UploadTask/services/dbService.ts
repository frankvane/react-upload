import type { UploadFileMeta } from "../types/file";
import localforage from "localforage";

const STORE_NAME = "upload_files";

const store = localforage.createInstance({
  name: STORE_NAME,
});

// 添加一个缓存层，减少频繁的IndexedDB访问
const metaCache = new Map<string, UploadFileMeta>();

export async function saveFileMeta(meta: UploadFileMeta) {
  try {
    // 更新缓存
    metaCache.set(meta.key, meta);

    // 异步保存到IndexedDB
    await store.setItem(meta.key, meta);
    return true;
  } catch (error) {
    console.error("dbService: error saving meta", meta.key, error);
    return false;
  }
}

export async function getFileMeta(key: string): Promise<UploadFileMeta | null> {
  try {
    // 先从缓存获取
    if (metaCache.has(key)) {
      return metaCache.get(key) || null;
    }

    // 缓存未命中，从IndexedDB获取
    const value = (await store.getItem<UploadFileMeta>(key)) || null;

    if (value) {
      // 更新缓存
      metaCache.set(key, value);
    }

    return value;
  } catch (error) {
    console.error("dbService: error retrieving meta", key, error);
    return null;
  }
}

export async function removeFileMeta(key: string) {
  try {
    // 从缓存中移除
    metaCache.delete(key);

    // 从IndexedDB中移除
    await store.removeItem(key);
    return true;
  } catch (error) {
    console.error("dbService: error removing meta", key, error);
    return false;
  }
}

export async function clearAllFileMeta() {
  try {
    // 清空缓存
    metaCache.clear();

    // 清空IndexedDB
    await store.clear();
    return true;
  } catch (error) {
    console.error("dbService: error clearing all metas", error);
    return false;
  }
}

export async function getAllFileMeta(): Promise<UploadFileMeta[]> {
  try {
    const metas: UploadFileMeta[] = [];

    // 使用批处理方式获取所有元数据
    await store.iterate<UploadFileMeta, void>((value) => {
      // 更新缓存
      metaCache.set(value.key, value);
      metas.push(value);
    });

    return metas;
  } catch (error) {
    console.error("dbService: error fetching all metas", error);
    return [];
  }
}
