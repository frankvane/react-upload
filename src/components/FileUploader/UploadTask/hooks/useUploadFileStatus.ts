import type { UploadFile } from "../store/uploadStore";
import { UploadStatus } from "../types/upload";
import { useMemo } from "react";

export function useUploadFileStatus(uploadFiles: UploadFile[]) {
  const hasUploadingFiles = useMemo(() => {
    return uploadFiles.some(
      (file) =>
        file.status === UploadStatus.QUEUED ||
        file.status === UploadStatus.CALCULATING ||
        file.status === UploadStatus.UPLOADING
    );
  }, [uploadFiles]);

  const hasCompletedFiles = useMemo(() => {
    return uploadFiles.some(
      (file) =>
        file.status === UploadStatus.DONE ||
        file.status === UploadStatus.INSTANT
    );
  }, [uploadFiles]);

  const hasWaitingFiles = useMemo(() => {
    return uploadFiles.some(
      (file) => file.status === UploadStatus.QUEUED_FOR_UPLOAD
    );
  }, [uploadFiles]);

  const failedFiles = useMemo(() => {
    return uploadFiles.filter(
      (file) =>
        file.status === UploadStatus.ERROR ||
        file.status === UploadStatus.MERGE_ERROR
    );
  }, [uploadFiles]);

  return { hasUploadingFiles, hasCompletedFiles, hasWaitingFiles, failedFiles };
}
