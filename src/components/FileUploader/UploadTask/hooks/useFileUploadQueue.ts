import { Modal, Upload, message } from "antd";
import {
  appendSpeedHistory,
  calcFileMD5WithWorker,
  calcSpeedAndLeftTime,
  calcTotalSpeed,
  checkFileBeforeUpload,
  checkFileTypeSafe,
  createFileChunks,
} from "../services/utils";
import {
  checkInstantUpload,
  getFileStatus,
  mergeFile,
  uploadFileChunk,
} from "../services/api";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 文件上传队列与主流程 Hook
 * 封装所有上传相关状态与操作，支持分片、秒传、进度、速率、错误等。
 * @param options.accept 支持的文件类型（如 .png,.jpg,image/*）
 * @param options.maxSizeMB 最大文件大小（MB）
 * @param options.multiple 是否多文件上传（未用到，可忽略）
 * @param options.concurrency 并发上传数
 * @param options.chunkSize 分片大小（字节）
 * @param options.uploadUrl 上传接口URL
 * @param options.checkUrl 秒传接口URL
 * @param options.mergeUrl 合并接口URL
 * @param options.headers 请求头
 * @param options.paramsTransform 参数转换函数
 * @param options.onSuccess 上传成功回调
 * @param options.onError 上传错误回调
 * @param options.onProgress 上传进度回调
 * @param options.onMergeSuccess 合并成功回调
 * @param options.onCheckSuccess 秒传成功回调
 * @param options.maxRetry 最大重试次数
 * @param options.keepAfterUpload 上传完成后是否保留文件
 * @param options.removeDelayMs 上传完成后延时移除文件的毫秒数
 * @param options.onRemoveAfterUpload 上传完成后移除文件的回调
 * @param options.allowedTypes 允许的文件类型
 * @param options.apiPrefix 接口前缀
 * @returns 所有上传相关状态与操作方法
 */
export function useFileUploadQueue({
  accept = "*",
  maxSizeMB = 2048,
  concurrency = 3,
  chunkSize = 2 * 1024 * 1024,
  uploadUrl,
  checkUrl,
  mergeUrl,
  headers,
  paramsTransform,
  onSuccess,
  onError,
  onProgress,
  onMergeSuccess,
  onCheckSuccess,
  maxRetry = 3,
  keepAfterUpload = true,
  removeDelayMs = 2000,
  onRemoveAfterUpload,
  allowedTypes = ["image/png", "image/jpeg", "image/gif"],
  apiPrefix,
}: {
  accept?: string;
  maxSizeMB?: number;
  multiple?: boolean;
  concurrency?: number;
  chunkSize?: number;
  uploadUrl?: string;
  checkUrl?: string;
  mergeUrl?: string;
  headers?: Record<string, string>;
  paramsTransform?: (params: any, type: string) => any;
  onSuccess?: (file: File, res: any) => void;
  onError?: (file: File, err: Error) => void;
  onProgress?: (file: File, percent: number) => void;
  onMergeSuccess?: (file: File, res: any) => void;
  onCheckSuccess?: (file: File, res: any) => void;
  maxRetry?: number;
  keepAfterUpload?: boolean;
  removeDelayMs?: number;
  onRemoveAfterUpload?: (
    file: File,
    reason: "upload" | "instant"
  ) => boolean | void | Promise<boolean | void>;
  allowedTypes?: string[];
  apiPrefix?: string;
}) {
  /**
   * 文件列表
   */
  const [files, setFiles] = useState<File[]>([]);
  /**
   * MD5 及分片MD5信息
   */
  const [md5Info, setMd5Info] = useState<
    Record<string, { fileMD5: string; chunkMD5s: string[] }>
  >({});
  /**
   * 秒传/分片存在性信息
   */
  const [instantInfo, setInstantInfo] = useState<
    Record<string, { uploaded: boolean; chunkCheckResult: any[] }>
  >({});
  /**
   * 上传进度与状态
   */
  const [uploadingInfo, setUploadingInfo] = useState<
    Record<string, { progress: number; status: string }>
  >({});
  /**
   * 当前 loading 文件 key
   */
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  /**
   * 批量上传中标记
   */
  const [uploadingAll, setUploadingAll] = useState(false);
  /**
   * 速率与剩余时间
   */
  const [speedInfo, setSpeedInfo] = useState<
    Record<string, { speed: number; leftTime: number }>
  >({});
  /**
   * 速率滑动窗口历史
   */
  const speedHistoryRef = useRef<
    Record<string, Array<{ time: number; loaded: number }>>
  >({});
  /**
   * 错误信息
   */
  const [errorInfo, setErrorInfo] = useState<Record<string, string>>({});

  // 获取文件唯一 key，优先用 file.key，否则用 name+size
  function getFileKey(file: any) {
    return file.key || file.name + file.size;
  }

  /**
   * beforeUpload 校验
   * @param file 文件对象
   * @returns 是否允许上传
   */
  const handleBeforeUpload = useCallback(
    (file: File) => {
      // 文件类型安全校验
      if (!checkFileTypeSafe(file, allowedTypes)) {
        message.error("文件类型不被允许");
        return Upload.LIST_IGNORE;
      }
      const ok = checkFileBeforeUpload({
        file,
        accept,
        maxSizeMB,
        onError: (msg) => message.error(msg),
      });
      if (!ok) return Upload.LIST_IGNORE;
      setFiles((prev) => {
        if (prev.find((f) => f.name === file.name && f.size === file.size))
          return prev;
        return [...prev, file];
      });
      return false; // 阻止自动上传
    },
    [accept, maxSizeMB, allowedTypes]
  );

  /**
   * 计算MD5并秒传验证
   * @param file 文件对象
   */
  const handleCalcMD5 = useCallback(
    async (file: File) => {
      setLoadingKey(getFileKey(file));
      try {
        const result = await calcFileMD5WithWorker(file, chunkSize);
        setMd5Info((prev) => ({ ...prev, [getFileKey(file)]: result }));
        // message.success(`MD5计算完成: ${result.fileMD5}`);
        // 秒传验证
        const fileId = `${result.fileMD5}-${file.name}-${file.size}`;
        const chunks = createFileChunks(file, chunkSize);
        console.log("chunks:", chunks);
        const instantRes = await checkInstantUpload(
          {
            fileId,
            md5: result.fileMD5,
            name: file.name,
            size: file.size,
            total: chunks.length,
            chunkMD5s: result.chunkMD5s,
          },
          {
            url: checkUrl,
            apiPrefix,
            headers,
            paramsTransform,
          }
        );
        console.log("instantRes:", instantRes);
        if (onCheckSuccess) onCheckSuccess(file, instantRes);
        setInstantInfo((prev) => ({
          ...prev,
          [getFileKey(file)]: instantRes,
        }));
        // 秒传成功也受keepAfterUpload控制
        if (instantRes.uploaded && !keepAfterUpload) {
          setTimeout(async () => {
            let shouldRemove = true;
            if (onRemoveAfterUpload) {
              const ret = await onRemoveAfterUpload(file, "instant");
              if (ret === false) shouldRemove = false;
            }
            if (shouldRemove) {
              setFiles((prev) =>
                prev.filter((f) => getFileKey(f) !== getFileKey(file))
              );
            }
          }, removeDelayMs);
        }
      } catch {
        // message.error("MD5或秒传接口异常");
      } finally {
        setLoadingKey(null);
      }
    },
    [
      chunkSize,
      checkUrl,
      headers,
      paramsTransform,
      onCheckSuccess,
      keepAfterUpload,
      removeDelayMs,
      onRemoveAfterUpload,
      apiPrefix,
    ]
  );

  // 找到所有未计算MD5的文件，依次自动计算
  useEffect(() => {
    const unMd5Files = files.filter((f) => !md5Info[getFileKey(f)]);
    if (unMd5Files.length > 0 && !loadingKey) {
      (async () => {
        for (const file of unMd5Files) {
          await handleCalcMD5(file);
        }
      })();
    }
  }, [files, md5Info, loadingKey, handleCalcMD5]);

  // 分片上传主流程
  const handleStartUpload = useCallback(
    async (file: File, resumeInfo?: any) => {
      const key = getFileKey(file);
      setErrorInfo((prev) => ({ ...prev, [key]: "" }));
      const md5 = md5Info[key]?.fileMD5 || resumeInfo?.md5;

      if (!md5) {
        return;
      }

      const fileId = `${md5}-${file.name}-${file.size}`;

      let uploadedChunks: number[] = resumeInfo?.uploadedChunks || [];
      if (!resumeInfo) {
        try {
          uploadedChunks = await getFileStatus({ fileId, md5 }, { apiPrefix });
        } catch (err) {
          console.log(err);
          // 忽略错误，继续执行
        }
      }

      const allChunks = createFileChunks(file, chunkSize);
      const needUploadChunks = allChunks.filter(
        (c) => !uploadedChunks.includes(c.index)
      );

      let uploadedCount = uploadedChunks.length;
      let uploadedBytes = uploadedChunks.reduce(
        (sum, idx) =>
          sum +
          (createFileChunks(file, chunkSize)[idx]?.end -
            createFileChunks(file, chunkSize)[idx]?.start),
        0
      );

      setUploadingInfo((prev) => ({
        ...prev,
        [key]: {
          progress: Math.round((uploadedCount / allChunks.length) * 100),
          status: "uploading",
        },
      }));

      speedHistoryRef.current[key] = [
        { time: Date.now(), loaded: uploadedBytes },
      ];

      // 上传每个分片
      for (const chunk of needUploadChunks) {
        let retry = 0;
        let delay = 500;
        const chunkSizeVal = chunk.end - chunk.start;

        while (retry < maxRetry) {
          try {
            const uploadResult = await uploadFileChunk(
              {
                fileId,
                chunk_md5: md5Info[key].chunkMD5s[chunk.index],
                index: chunk.index,
                chunk: chunk.chunk,
                name: file.name,
                total: allChunks.length,
              },
              {
                url: uploadUrl,
                apiPrefix,
                headers,
                paramsTransform,
              }
            );

            // 使用服务器返回的MD5值更新本地状态
            if (uploadResult.data?.chunk_md5) {
              md5Info[key].chunkMD5s[chunk.index] = uploadResult.data.chunk_md5;
            }

            uploadedCount++;
            uploadedBytes += chunkSizeVal;
            uploadedChunks.push(chunk.index);

            // 更新进度
            const progress = Math.round(
              (uploadedCount / allChunks.length) * 100
            );

            setUploadingInfo((prev) => ({
              ...prev,
              [key]: {
                progress,
                status: "uploading",
              },
            }));

            // 更新速度信息
            const now = Date.now();
            const prevHistory = speedHistoryRef.current[key] || [];
            speedHistoryRef.current[key] = appendSpeedHistory(
              prevHistory,
              now,
              uploadedBytes,
              5
            );
            const history = speedHistoryRef.current[key];
            if (history.length >= 2) {
              const { speed, leftTime } = calcSpeedAndLeftTime(
                history,
                file.size
              );
              setSpeedInfo((prev) => ({
                ...prev,
                [key]: {
                  speed,
                  leftTime,
                },
              }));
            }

            if (onProgress) {
              onProgress(file, progress);
            }
            break;
          } catch (err: any) {
            retry++;
            if (retry >= maxRetry) {
              setUploadingInfo((prev) => ({
                ...prev,
                [key]: {
                  progress: Math.round(
                    (uploadedCount / allChunks.length) * 100
                  ),
                  status: "error",
                },
              }));
              setErrorInfo((prev) => ({
                ...prev,
                [key]: err?.message || "分片上传失败",
              }));
              return;
            }
            await new Promise((res) => setTimeout(res, delay));
            delay = Math.min(delay * 2, 5000);
          }
        }
      }

      // 所有分片上传完成，开始合并
      try {
        const mergeResult = await mergeFile(
          {
            fileId,
            md5,
            name: file.name,
            size: file.size,
            total: allChunks.length,
          },
          {
            url: mergeUrl,
            apiPrefix,
            headers,
            paramsTransform,
          }
        );

        setUploadingInfo((prev) => ({
          ...prev,
          [key]: { progress: 100, status: "done" },
        }));
        setSpeedInfo((prev) => ({ ...prev, [key]: { speed: 0, leftTime: 0 } }));
        setErrorInfo((prev) => ({ ...prev, [key]: "" }));

        if (onMergeSuccess) onMergeSuccess(file, mergeResult);
        if (onSuccess) onSuccess(file, mergeResult);

        // 自动移除已上传文件
        if (!keepAfterUpload) {
          setTimeout(async () => {
            let shouldRemove = true;
            if (onRemoveAfterUpload) {
              const ret = await onRemoveAfterUpload(file, "upload");
              if (ret === false) shouldRemove = false;
            }
            if (shouldRemove) {
              setFiles((prev) => prev.filter((f) => getFileKey(f) !== key));
            }
          }, removeDelayMs);
        }
      } catch (err: any) {
        setUploadingInfo((prev) => ({
          ...prev,
          [key]: { progress: 100, status: "merge-error" },
        }));
        setErrorInfo((prev) => ({
          ...prev,
          [key]: err?.message || "合并失败",
        }));
        if (onError) onError(file, err);
        Modal.error({
          title: "合并失败",
          content: err?.message || "合并失败",
        });
      }
    },
    [
      md5Info,
      chunkSize,
      uploadUrl,
      checkUrl,
      mergeUrl,
      headers,
      paramsTransform,
      onSuccess,
      onError,
      onProgress,
      onMergeSuccess,
      maxRetry,
      keepAfterUpload,
      removeDelayMs,
      onRemoveAfterUpload,
      apiPrefix,
    ]
  );

  // 重试单个文件
  const handleRetry = useCallback(
    (file: File) => {
      handleStartUpload(file);
    },
    [handleStartUpload]
  );

  // 重试所有失败文件
  const handleRetryAllFailed = useCallback(async () => {
    const failedFiles = files.filter((file) => {
      const key = getFileKey(file);
      const uploading = uploadingInfo[key];
      return (
        uploading &&
        (uploading.status === "error" || uploading.status === "merge-error")
      );
    });
    for (const file of failedFiles) {
      await handleStartUpload(file);
    }
    // message.success("所有失败文件已重试");
  }, [files, uploadingInfo, handleStartUpload]);

  // 批量上传自动补齐MD5
  const handleStartAll = useCallback(async () => {
    setUploadingAll(true);
    // 先为所有未计算MD5的文件自动计算MD5
    for (const file of files) {
      const key = getFileKey(file);
      if (!md5Info[key]) {
        await handleCalcMD5(file);
      }
    }
    // 过滤出未秒传且未上传完成的文件
    const needUploadFiles = files.filter((file) => {
      const key = getFileKey(file);
      const instant = instantInfo[key];
      const uploading = uploadingInfo[key];
      return (
        md5Info[key] &&
        !instant?.uploaded &&
        (!uploading || uploading.status !== "done")
      );
    });
    // 并发控制
    let idx = 0;
    const queue: Promise<void>[] = [];
    const next = async () => {
      if (idx >= needUploadFiles.length) return;
      const file = needUploadFiles[idx++];
      await handleStartUpload(file);
      await next();
    };
    for (let i = 0; i < Math.min(concurrency, needUploadFiles.length); i++) {
      queue.push(next());
    }
    await Promise.all(queue);
    setUploadingAll(false);
    // message.success("全部上传任务已完成");
  }, [
    files,
    md5Info,
    instantInfo,
    uploadingInfo,
    handleCalcMD5,
    handleStartUpload,
    concurrency,
  ]);

  // 单个文件上传按钮自动补齐MD5
  const handleStartUploadWithAutoMD5 = useCallback(
    async (file: File) => {
      const key = getFileKey(file);
      if (!md5Info[key]) {
        await handleCalcMD5(file);
      }
      console.log(
        "[useFileUploadQueue] handleStartUploadWithAutoMD5: call handleStartUpload",
        file
      );
      await handleStartUpload(file);
    },
    [md5Info, handleCalcMD5, handleStartUpload]
  );

  return {
    files,
    setFiles,
    md5Info,
    instantInfo,
    uploadingInfo,
    loadingKey,
    uploadingAll,
    speedInfo,
    errorInfo,
    handleBeforeUpload,
    handleCalcMD5,
    handleStartUpload,
    handleStartAll,
    handleRetry,
    handleRetryAllFailed,
    handleStartUploadWithAutoMD5,
    calcTotalSpeed,
  };
}
