export interface UploadFileMeta {
  key: string; // 唯一key
  name: string; // 文件名
  buffer: ArrayBuffer; // 文件数据
  size: number; // 文件大小
  type: string; // 文件类型
  lastModified: number; // 最后修改时间
  addedAt: number; // 存入indexeddb的时间戳
}
