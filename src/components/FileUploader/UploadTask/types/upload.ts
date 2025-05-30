/**
 * 文件上传状态枚举
 */
export enum UploadStatus {
  QUEUED = "queued",
  QUEUED_FOR_UPLOAD = "queued-for-upload",
  CALCULATING = "calculating",
  UPLOADING = "uploading",
  DONE = "done",
  INSTANT = "instant",
  ERROR = "error",
  MERGE_ERROR = "merge-error",
}
