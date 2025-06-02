/**
 * 文件上传状态枚举
 */
// 导出一个枚举类型，用于表示上传状态
export enum UploadStatus {
  // 上传已排队
  QUEUED = "queued",
  // 上传已排队等待上传
  QUEUED_FOR_UPLOAD = "queued-for-upload",
  // 正在计算
  CALCULATING = "calculating",
  // 正在准备上传
  PREPARING_UPLOAD = "preparing-upload",
  // 正在上传
  UPLOADING = "uploading",
  // 已暂停
  PAUSED = "paused",
  // 已完成
  DONE = "done",
  // 即时上传
  INSTANT = "instant",
  // 错误
  ERROR = "error",
  // 合并错误
  MERGE_ERROR = "merge-error",
}
