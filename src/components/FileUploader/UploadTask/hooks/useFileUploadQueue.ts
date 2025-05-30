import { Modal, Upload, message } from "antd";
import {
  appendSpeedHistory,
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
 * @param options.fileConcurrency 文件并发池调度大小
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
  fileConcurrency = 2,
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
  fileConcurrency?: number;
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
   * 使用ref跟踪最新的MD5信息，避免状态更新延迟问题
   */
  const md5InfoRef = useRef<
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

  // 获取文件分片大小，优先用meta里的chunkSize
  function getFileChunkSize(file: any) {
    return typeof file.chunkSize === "number" ? file.chunkSize : chunkSize;
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

      // 设置初始状态为计算中
      setUploadingInfo((prev) => ({
        ...prev,
        [getFileKey(file)]: { progress: 0, status: "calculating" },
      }));

      // 创建一个进度更新函数，使用防抖减少状态更新频率
      let updateTimer: ReturnType<typeof setTimeout> | null = null;
      const updateProgress = (progress: number) => {
        if (updateTimer) {
          clearTimeout(updateTimer);
        }

        // 延迟更新UI状态，减少重绘频率
        updateTimer = setTimeout(() => {
          setUploadingInfo((prev) => ({
            ...prev,
            [getFileKey(file)]: {
              progress,
              status: "calculating",
            },
          }));

          // 触发外部进度回调
          if (onProgress) {
            onProgress(file, progress);
          }
        }, 100); // 100ms防抖
      };

      try {
        // 初始化进度为0
        updateProgress(0);

        const realChunkSize = getFileChunkSize(file);

        // 创建一个包装函数，添加进度监听
        const calcMD5WithProgress = async () => {
          return new Promise<{ fileMD5: string; chunkMD5s: string[] }>(
            (resolve, reject) => {
              const worker = new Worker(
                new URL("../workers/worker-md5.ts", import.meta.url)
              );

              worker.onmessage = (e) => {
                const data = e.data;
                if (data.type === "progress") {
                  updateProgress(data.progress);
                } else if (data.type === "complete") {
                  // 清除可能存在的更新定时器
                  if (updateTimer) {
                    clearTimeout(updateTimer);
                  }

                  // 确保进度显示为100%
                  setUploadingInfo((prev) => ({
                    ...prev,
                    [getFileKey(file)]: {
                      progress: 100,
                      status: "calculating",
                    },
                  }));

                  resolve({
                    fileMD5: data.fileMD5,
                    chunkMD5s: data.chunkMD5s,
                  });
                  worker.terminate();
                } else if (data.type === "error") {
                  // 清除可能存在的更新定时器
                  if (updateTimer) {
                    clearTimeout(updateTimer);
                  }

                  reject(new Error(data.error));
                  worker.terminate();
                }
              };

              worker.onerror = (err) => {
                // 清除可能存在的更新定时器
                if (updateTimer) {
                  clearTimeout(updateTimer);
                }

                reject(err);
                worker.terminate();
              };

              // 发送数据到Worker
              worker.postMessage({ file, chunkSize: realChunkSize });
            }
          );
        };

        // 执行带进度的MD5计算
        const result = await calcMD5WithProgress();

        // 输出调试信息，确认MD5计算结果
        console.log(`MD5计算成功 - ${file.name}:`, result.fileMD5);

        // 更新MD5信息 - 使用函数式更新确保状态正确设置
        setMd5Info((prev) => {
          const newState = { ...prev };
          newState[getFileKey(file)] = result;
          return newState;
        });

        // 同时更新ref，确保可以立即访问最新值
        md5InfoRef.current = {
          ...md5InfoRef.current,
          [getFileKey(file)]: result,
        };

        // 等待状态更新完成
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 秒传验证
        const fileId = `${result.fileMD5}-${file.name}-${file.size}`;
        const chunks = createFileChunks(file, realChunkSize);

        // 更新状态为验证秒传
        setUploadingInfo((prev) => ({
          ...prev,
          [getFileKey(file)]: { progress: 100, status: "checking" },
        }));

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

        if (onCheckSuccess) onCheckSuccess(file, instantRes);

        // 再次确认MD5信息已正确设置
        setMd5Info((prev) => {
          // 如果MD5信息不存在，重新设置一次
          if (!prev[getFileKey(file)]) {
            console.log(`修复丢失的MD5信息 - ${file.name}`);
            return { ...prev, [getFileKey(file)]: result };
          }
          return prev;
        });

        // 同时更新ref
        if (!md5InfoRef.current[getFileKey(file)]) {
          md5InfoRef.current[getFileKey(file)] = result;
        }

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

        // 更新状态为完成
        setUploadingInfo((prev) => ({
          ...prev,
          [getFileKey(file)]: {
            progress: 100,
            status: instantRes.uploaded ? "done" : "ready",
          },
        }));

        // 返回计算结果，便于调用方直接使用
        return result;
      } catch (err) {
        console.error("MD5或秒传接口异常", err);
        setErrorInfo((prev) => ({
          ...prev,
          [getFileKey(file)]: (err as Error).message || "MD5或秒传接口异常",
        }));
        setUploadingInfo((prev) => ({
          ...prev,
          [getFileKey(file)]: { progress: 0, status: "error" },
        }));
        throw err; // 重新抛出错误，让调用方处理
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
      onProgress,
    ]
  );

  // 找到所有未计算MD5的文件，依次自动计算
  useEffect(() => {
    // 完全移除自动计算MD5的逻辑，改为在点击开始上传时计算
    return () => {}; // 保留空的清理函数
  }, []);

  // 分片上传主流程
  const handleStartUpload = useCallback(
    async (file: File, resumeInfo?: any) => {
      const key = getFileKey(file);
      setErrorInfo((prev) => ({ ...prev, [key]: "" }));

      // 优先使用ref中的MD5，因为它总是最新的
      const md5 =
        md5InfoRef.current[key]?.fileMD5 ||
        md5Info[key]?.fileMD5 ||
        resumeInfo?.md5;

      // 如果没有MD5，无法继续上传
      if (!md5) {
        console.error("缺少MD5信息，无法上传文件");
        setErrorInfo((prev) => ({
          ...prev,
          [key]: "缺少MD5信息，请尝试重新计算",
        }));
        setUploadingInfo((prev) => ({
          ...prev,
          [key]: { progress: 0, status: "error" },
        }));
        return;
      }

      const realChunkSize = getFileChunkSize(file);
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

      const allChunks = createFileChunks(file, realChunkSize);
      const needUploadChunks = allChunks.filter(
        (c) => !uploadedChunks.includes(c.index)
      );

      let uploadedCount = uploadedChunks.length;
      let uploadedBytes = uploadedChunks.reduce(
        (sum, idx) =>
          sum +
          (createFileChunks(file, realChunkSize)[idx]?.end -
            createFileChunks(file, realChunkSize)[idx]?.start),
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

      // 分片并发池上传
      await new Promise<void>((resolve) => {
        let idx = 0;
        let active = 0;
        let finished = 0;
        const total = needUploadChunks.length;
        const tryStartNext = () => {
          while (active < concurrency && idx < total) {
            const chunk = needUploadChunks[idx++];
            active++;
            (async () => {
              let retry = 0;
              let delay = 500;
              const chunkSizeVal = chunk.end - chunk.start;
              while (retry < maxRetry) {
                try {
                  const uploadResult = await uploadFileChunk(
                    {
                      fileId,
                      // 如果没有MD5信息，传null或空字符串
                      chunk_md5: md5Info[key]?.chunkMD5s?.[chunk.index] || "",
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
                  if (uploadResult.data?.chunk_md5 && md5Info[key]?.chunkMD5s) {
                    md5Info[key].chunkMD5s[chunk.index] =
                      uploadResult.data.chunk_md5;
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
                    break;
                  }
                  await new Promise((res) => setTimeout(res, delay));
                  delay = Math.min(delay * 2, 5000);
                }
              }
              active--;
              finished++;
              if (finished === total) resolve();
              else tryStartNext();
            })();
          }
        };
        tryStartNext();
      });

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

    try {
      // 创建两个队列：等待MD5计算的文件队列 和 活跃处理中的文件集合
      const pendingQueue = files.filter((file) => {
        const key = getFileKey(file);
        const instant = instantInfo[key];
        const uploading = uploadingInfo[key];
        // 只处理未秒传且未上传完成的文件
        return (
          !instant?.uploaded && (!uploading || uploading.status !== "done")
        );
      });

      // 如果没有待处理文件，直接结束
      if (pendingQueue.length === 0) {
        setUploadingAll(false);
        return;
      }

      console.log(`待处理文件总数: ${pendingQueue.length}`);

      // 活跃处理中的文件数量
      let activeCount = 0;
      // 已完成的文件数量
      let completedCount = 0;

      // 处理单个完整文件流程（MD5计算+上传）
      const processCompleteFile = async (file: File): Promise<void> => {
        const key = getFileKey(file);
        console.log(`开始完整处理文件: ${file.name}, key=${key}`);

        try {
          // 步骤1: 计算MD5，最多重试2次
          let md5Result = md5InfoRef.current[key] || md5Info[key];

          if (!md5Result?.fileMD5) {
            console.log(`开始计算MD5: ${file.name}`);

            // 添加重试机制
            let retryCount = 0;
            let md5Success = false;

            while (retryCount < 2 && !md5Success) {
              if (retryCount > 0) {
                console.log(`MD5计算重试 #${retryCount}: ${file.name}`);
                // 重试前等待一小段时间
                await new Promise((r) => setTimeout(r, 500));
              }

              try {
                // 直接获取计算结果，不依赖状态更新
                md5Result = await handleCalcMD5(file);

                // 检查MD5是否计算成功
                console.log(
                  `检查MD5计算结果 - ${file.name}:`,
                  md5Result?.fileMD5 || "未找到"
                );

                if (md5Result?.fileMD5) {
                  md5Success = true;
                  console.log(
                    `MD5计算完成: ${file.name}, MD5=${md5Result.fileMD5}`
                  );
                } else {
                  throw new Error("MD5计算结果为空");
                }
              } catch (error) {
                console.error(`MD5计算失败 (尝试 ${retryCount + 1}/2):`, error);
                retryCount++;
                // 最后一次重试失败，设置错误状态
                if (retryCount >= 2) {
                  setErrorInfo((prev) => ({
                    ...prev,
                    [key]: "MD5计算失败，请尝试重新上传",
                  }));
                  setUploadingInfo((prev) => ({
                    ...prev,
                    [key]: { progress: 0, status: "error" },
                  }));
                }
              }
            }
          } else {
            console.log(
              `文件已有MD5，跳过计算: ${file.name}, MD5=${md5Result.fileMD5}`
            );
          }

          // 如果已经秒传，就不执行上传
          if (instantInfo[key]?.uploaded) {
            console.log(`文件已秒传: ${file.name}`);
          } else if (md5Result?.fileMD5) {
            // 只有在MD5计算成功的情况下才开始上传
            console.log(`开始上传文件: ${file.name}, MD5=${md5Result.fileMD5}`);
            await handleStartUpload(file);
            console.log(`文件上传完成: ${file.name}`);
          } else {
            console.log(`无法上传: ${file.name}，MD5计算失败`);
          }
        } catch (error) {
          console.error(`处理文件失败: ${file.name}`, error);
        } finally {
          // 无论成功失败，都将活跃计数减一，并尝试处理队列中的下一个文件
          activeCount--;
          completedCount++;

          // 步骤3: 从队列中取出下一个文件进行处理
          if (pendingQueue.length > 0) {
            startNextFile();
          } else if (completedCount === files.length) {
            // 所有文件都处理完成
            console.log("所有文件处理完成");
            setUploadingAll(false);
          }
        }
      };

      // 启动下一个文件的处理
      const startNextFile = () => {
        if (pendingQueue.length === 0 || activeCount >= fileConcurrency) {
          return;
        }

        const nextFile = pendingQueue.shift()!;
        activeCount++;

        console.log(
          `开始处理文件: ${nextFile.name} (${activeCount}/${fileConcurrency})`
        );

        // 使用setTimeout避免调用栈过深
        setTimeout(() => {
          processCompleteFile(nextFile).catch((err) => {
            console.error("文件处理出错:", err);
          });
        }, 0);
      };

      // 初始启动并发数量的文件处理
      const initialBatchSize = Math.min(fileConcurrency, pendingQueue.length);
      console.log(`初始批次启动: ${initialBatchSize}个文件`);

      for (let i = 0; i < initialBatchSize; i++) {
        startNextFile();
      }
    } catch (error) {
      console.error("批量上传初始化失败:", error);
      setUploadingAll(false);
    }
  }, [
    files,
    md5Info,
    instantInfo,
    uploadingInfo,
    handleCalcMD5,
    handleStartUpload,
    fileConcurrency,
  ]);

  // 单个文件上传按钮自动补齐MD5
  const handleStartUploadWithAutoMD5 = useCallback(
    async (file: File) => {
      const key = getFileKey(file);
      console.log(`单文件上传开始处理: ${file.name}, key=${key}`);

      // 优先使用ref中的MD5信息
      let md5Result = md5InfoRef.current[key] || md5Info[key];

      // 如果没有MD5，先尝试计算（最多重试2次）
      if (!md5Result?.fileMD5) {
        let retryCount = 0;
        let md5Success = false;

        while (retryCount < 2 && !md5Success) {
          if (retryCount > 0) {
            console.log(`MD5计算重试 #${retryCount}: ${file.name}`);
          }

          try {
            // 直接获取计算结果，不依赖状态更新
            md5Result = await handleCalcMD5(file);

            // 检查MD5是否计算成功
            console.log(
              `检查单文件MD5计算结果 - ${file.name}:`,
              md5Result?.fileMD5 || "未找到"
            );

            if (md5Result?.fileMD5) {
              md5Success = true;
              console.log(
                `单文件MD5计算成功: ${file.name}, MD5=${md5Result.fileMD5}`
              );
            } else {
              throw new Error("MD5计算结果为空");
            }
          } catch (error) {
            console.error(
              `单文件MD5计算失败 (尝试 ${retryCount + 1}/2):`,
              error
            );
            retryCount++;

            if (retryCount >= 2) {
              // 最后一次重试也失败了，设置错误状态
              setErrorInfo((prev) => ({
                ...prev,
                [key]: "MD5计算失败，请尝试重新上传",
              }));
              setUploadingInfo((prev) => ({
                ...prev,
                [key]: { progress: 0, status: "error" },
              }));
              return; // 中止上传流程
            }

            // 重试前短暂等待
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } else {
        console.log(
          `单文件已有MD5，跳过计算: ${file.name}, MD5=${md5Result.fileMD5}`
        );
      }

      // 只有在MD5计算成功的情况下才开始上传
      if (md5Result?.fileMD5) {
        console.log(`开始单文件上传: ${file.name}, MD5=${md5Result.fileMD5}`);
        await handleStartUpload(file);
      } else {
        console.log(`无法上传单文件: ${file.name}，MD5计算失败`);
      }
    },
    [md5Info, instantInfo, handleCalcMD5, handleStartUpload]
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
