/**
 * 文件上传状态枚举
 */
export enum UploadStatus {
  QUEUED = "queued",
  QUEUED_FOR_UPLOAD = "queued-for-upload",
  CALCULATING = "calculating",
  PREPARING_UPLOAD = "preparing-upload",
  UPLOADING = "uploading",
  PAUSED = "paused",
  DONE = "done",
  INSTANT = "instant",
  ERROR = "error",
  MERGE_ERROR = "merge-error",
  ABORTED = "aborted",
}
