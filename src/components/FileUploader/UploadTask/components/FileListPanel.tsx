import { Button, Progress, Table, Tag, Tooltip, message } from "antd";
import React, { useContext, useEffect, useState } from "react";
import {
  clearAllFileMeta,
  getAllFileMeta,
  removeFileMeta,
} from "../services/dbService";

import { ByteConvert } from "../services/utils";
import { UploadConfigContext } from "../context";
import type { UploadFileMeta } from "../types/file";
import { useFileUploadQueue } from "../hooks/useFileUploadQueue";

interface FileListPanelProps {
  progress?: number;
  costSeconds?: number;
}

const DEFAULT_API_PREFIX = "http://localhost:3000/api";

// UploadFileMeta 转 File，确保 chunkSize 也带上
function metaToFile(meta: UploadFileMeta): File {
  let buffer: any = meta.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    if (typeof buffer === "string") {
      buffer = new TextEncoder().encode(buffer).buffer;
    } else if (ArrayBuffer.isView(buffer)) {
      buffer = (buffer as ArrayBufferView).buffer;
    } else if (
      (buffer as any)?.type === "Buffer" &&
      Array.isArray((buffer as any)?.data)
    ) {
      buffer = new Uint8Array((buffer as any).data).buffer;
    } else {
      buffer = new ArrayBuffer(0);
    }
  }
  const file = new File([buffer], meta.name, {
    type: meta.type,
    lastModified: meta.lastModified,
  });
  (file as any).key = meta.key;
  (file as any).chunkSize = meta.chunkSize; // 关键：挂载 chunkSize
  return file;
}

const FileListPanel: React.FC<FileListPanelProps> = ({
  progress,
  costSeconds,
}) => {
  const [filesState, setFilesState] = useState<UploadFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [scrollY, setScrollY] = useState(400);

  const uploadConfig = useContext(UploadConfigContext);
  const fileConcurrency =
    typeof uploadConfig?.fileConcurrency === "number"
      ? uploadConfig.fileConcurrency
      : 2;
  const chunkConcurrency =
    typeof uploadConfig?.chunkConcurrency === "number"
      ? uploadConfig.chunkConcurrency
      : 3;
  const networkChunkSize =
    typeof uploadConfig?.chunkSize === "number"
      ? uploadConfig.chunkSize
      : 2 * 1024 * 1024;

  const {
    md5Info,
    instantInfo,
    uploadingInfo,
    speedInfo,
    errorInfo,
    uploadingAll,
    handleStartUploadWithAutoMD5,
    handleRetry,
    setFiles,
    handleStartAll,
  } = useFileUploadQueue({
    apiPrefix: DEFAULT_API_PREFIX,
    chunkSize: networkChunkSize,
    concurrency: chunkConcurrency,
  });

  const totalSpeed = Object.values(speedInfo).reduce(
    (sum, s) => sum + (s.speed || 0),
    0
  );

  const fetchFiles = async () => {
    setLoading(true);
    // 使用setTimeout延迟执行，避免初始化时的性能问题
    setTimeout(async () => {
      try {
        const all = await getAllFileMeta();
        setFilesState(all);
        setFiles(all.map(metaToFile));
      } catch (err) {
        console.error("加载文件列表失败", err);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // 进度变化时刷新
  useEffect(() => {
    if (progress === 100) fetchFiles();
  }, [progress]);

  useEffect(() => {
    const calcHeight = () => {
      // 计算可用高度，300为顶部操作区和边距的估算，可根据实际页面微调
      const offset = 300;
      setScrollY(
        window.innerHeight - offset > 200 ? window.innerHeight - offset : 200
      );
    };
    calcHeight();
    window.addEventListener("resize", calcHeight);
    return () => window.removeEventListener("resize", calcHeight);
  }, []);

  // 上传成功/已秒传后延迟清理
  useEffect(() => {
    filesState.forEach((meta) => {
      const key = meta.key;
      const uploading = uploadingInfo[key];
      const instant = instantInfo[key];
      // 上传成功或已秒传
      if (
        (uploading && uploading.status === "done") ||
        (instant && instant.uploaded)
      ) {
        setTimeout(async () => {
          await removeFileMeta(key);
          setFilesState((prev) => prev.filter((f) => f.key !== key));
        }, 2000);
      }
    });
    // eslint-disable-next-line
  }, [filesState, uploadingInfo, instantInfo]);

  // 优化：本地先删，UI立刻响应
  const handleRemove = async (key: string) => {
    setFilesState((prev) => prev.filter((item) => item.key !== key));
    await removeFileMeta(key);
    message.success("已删除");
    // 不再fetchFiles
  };

  const handleClear = async () => {
    await clearAllFileMeta();
    message.success("已清空");
    fetchFiles();
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setFilesState((prev) =>
      prev.filter((item) => !selectedRowKeys.includes(item.key))
    );
    await Promise.all(
      selectedRowKeys.map((key) => removeFileMeta(key as string))
    );
    setSelectedRowKeys([]);
    message.success("批量删除成功");
  };

  const rowSelection = React.useMemo(
    () => ({
      selectedRowKeys,
      onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
      getCheckboxProps: (record: UploadFileMeta) => {
        const key = record.key;
        // 已上传成功或已秒传的禁用 checkbox
        return {
          disabled:
            uploadingInfo[key]?.status === "done" ||
            instantInfo[key]?.uploaded === true,
        };
      },
    }),
    [selectedRowKeys, uploadingInfo, instantInfo]
  );

  const columns = [
    {
      title: "序号",
      key: "index",
      align: "left" as const,
      width: 60,
      render: (_: any, __: UploadFileMeta, idx: number) => idx + 1,
    },
    {
      title: "文件名",
      dataIndex: "name",
      key: "name",
      align: "left" as const,
      ellipsis: true,
    },
    {
      title: "大小",
      dataIndex: "size",
      key: "size",
      align: "right" as const,
      width: 120,
      render: (size: number) => (
        <span style={{ marginRight: 16 }}>{ByteConvert(size)}</span>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      align: "left" as const,
      width: 120,
    },
    {
      title: "操作时间",
      dataIndex: "addedAt",
      key: "addedAt",
      align: "center" as const,
      width: 180,
      render: (t: number) => new Date(t).toLocaleString(),
    },
    {
      title: "上传状态",
      key: "uploadStatus",
      align: "center" as const,
      width: 220,
      render: (_: any, record: UploadFileMeta) => {
        const key = record.key;
        const md5 = md5Info[key];
        const instant = instantInfo[key];
        const uploading = uploadingInfo[key];
        const speed = speedInfo[key]?.speed || 0;
        const leftTime = speedInfo[key]?.leftTime || 0;
        const error = errorInfo[key];
        // 终极兜底：分片数直接用 record.size 兜底，详细日志
        let needUploadChunks = 0;
        let chunkCheckError = false;
        const file = metaToFile(record);
        let size = file.size;
        if (!size && record.size) size = record.size;
        // 优先用 file.chunkSize（即 meta 里的 chunkSize）
        const realChunkSize =
          typeof (file as any).chunkSize === "number"
            ? (file as any).chunkSize
            : typeof record.chunkSize === "number"
            ? record.chunkSize
            : networkChunkSize;
        const chunkCount = Math.ceil(size / realChunkSize) || 1;
        // 新增：判断所有分片都已存在且一致
        let allChunksUploaded = false;
        if (
          instant &&
          Array.isArray(instant.chunkCheckResult) &&
          instant.chunkCheckResult.length === chunkCount
        ) {
          allChunksUploaded = instant.chunkCheckResult.every(
            (c) => c.exist && c.match
          );
        }
        if (allChunksUploaded) {
          needUploadChunks = 0;
          chunkCheckError = false;
        } else if (
          !instant ||
          !Array.isArray(instant.chunkCheckResult) ||
          instant.chunkCheckResult.length === 0
        ) {
          needUploadChunks = chunkCount;
          chunkCheckError = true;
        } else if (instant.chunkCheckResult.length !== chunkCount) {
          needUploadChunks = chunkCount;
          chunkCheckError = true;
        } else {
          needUploadChunks = instant.chunkCheckResult.filter(
            (c) => !c.exist || !c.match
          ).length;
        }
        if (needUploadChunks === 0 && size > 0 && !allChunksUploaded) {
          needUploadChunks = chunkCount;
          chunkCheckError = true;
        }
        return (
          <div>
            {uploading && uploading.status === "done" ? (
              <Tag color="green">上传成功</Tag>
            ) : (
              <>
                {uploading && uploading.status === "calculating" && (
                  <div>
                    <Tag color="blue">计算MD5中...</Tag>
                    <span
                      style={{
                        fontSize: "12px",
                        marginLeft: "4px",
                        color: "#1890ff",
                      }}
                    >
                      {uploading.progress}%
                    </span>
                  </div>
                )}
                {uploading && uploading.status === "checking" && (
                  <div>
                    <Tag color="cyan">秒传验证中...</Tag>
                    <Progress
                      percent={100}
                      size="small"
                      status="active"
                      style={{ width: 80 }}
                    />
                  </div>
                )}
                {instant &&
                  (instant.uploaded ? (
                    <Tag color="green">已秒传</Tag>
                  ) : allChunksUploaded ? (
                    <Tag color="blue">所有分片已存在，可直接合并</Tag>
                  ) : (
                    <Tag color={chunkCheckError ? "red" : "orange"}>
                      需上传分片: {needUploadChunks}
                      {chunkCheckError && (
                        <span style={{ marginLeft: 4 }}>（分片校验异常）</span>
                      )}
                    </Tag>
                  ))}
                {!instant?.uploaded &&
                  (allChunksUploaded ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() =>
                        handleStartUploadWithAutoMD5(metaToFile(record))
                      }
                      disabled={
                        !md5 ||
                        (uploading && uploading.status === "uploading") ||
                        uploadingAll
                      }
                      style={{ marginLeft: 8 }}
                    >
                      合并文件
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() =>
                        handleStartUploadWithAutoMD5(metaToFile(record))
                      }
                      disabled={
                        !md5 ||
                        (uploading && uploading.status === "uploading") ||
                        uploadingAll ||
                        (needUploadChunks === 0 &&
                          !instant?.uploaded &&
                          !chunkCheckError)
                      }
                      style={{ marginLeft: 8 }}
                    >
                      {!md5
                        ? "计算中..."
                        : uploading && uploading.status === "uploading"
                        ? "上传中..."
                        : "开始上传"}
                    </Button>
                  ))}
                {uploading && (
                  <span style={{ display: "inline-block", minWidth: 100 }}>
                    <Tooltip
                      title={
                        uploading.status === "error" ||
                        uploading.status === "merge-error"
                          ? error || "上传失败"
                          : undefined
                      }
                    >
                      <Progress
                        percent={uploading.progress}
                        size="small"
                        status={
                          uploading.status === "error" ||
                          uploading.status === "merge-error"
                            ? "exception"
                            : uploading.status === "done"
                            ? "success"
                            : undefined
                        }
                        style={{ width: 80 }}
                      />
                    </Tooltip>
                    {uploading.status === "uploading" && speed > 0 && (
                      <div
                        style={{ fontSize: 12, color: "#888", marginTop: 2 }}
                      >
                        速度: {(speed / 1024 / 1024).toFixed(2)} MB/s
                        {leftTime > 0 && (
                          <span style={{ marginLeft: 8 }}>
                            剩余: {Math.ceil(leftTime)} 秒
                          </span>
                        )}
                      </div>
                    )}
                    {(uploading.status === "error" ||
                      uploading.status === "merge-error") && (
                      <div style={{ fontSize: 12, color: "red", marginTop: 2 }}>
                        {error && (
                          <span style={{ marginRight: 8 }}>{error}</span>
                        )}
                        <Button
                          size="small"
                          danger
                          onClick={() => handleRetry(metaToFile(record))}
                        >
                          重试
                        </Button>
                      </div>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      align: "center" as const,
      width: 160,
      render: (_: any, record: UploadFileMeta) => (
        <>
          <Button danger size="small" onClick={() => handleRemove(record.key)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  // 上传选中
  const handleStartSelected = async () => {
    for (const key of selectedRowKeys) {
      const meta = filesState.find((f) => f.key === key);
      if (meta) {
        await handleStartUploadWithAutoMD5(metaToFile(meta));
      }
    }
    setSelectedRowKeys([]); // 上传后自动清空选中
  };

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center" }}>
        <Button
          danger
          size="small"
          onClick={handleClear}
          disabled={filesState.length === 0}
        >
          清空全部
        </Button>
        <Button
          danger
          size="small"
          style={{ marginLeft: 8 }}
          onClick={handleBatchDelete}
          disabled={selectedRowKeys.length === 0}
        >
          批量删除
        </Button>
        <Button
          type="primary"
          style={{ marginLeft: 8 }}
          onClick={handleStartSelected}
          disabled={selectedRowKeys.length === 0 || uploadingAll}
        >
          上传选中
        </Button>
        <Button
          type="primary"
          style={{ marginLeft: 8 }}
          onClick={handleStartAll}
          disabled={filesState.length === 0 || uploadingAll}
        >
          上传全部
        </Button>
        {typeof progress === "number" && progress < 100 && (
          <div
            style={{
              marginLeft: 16,
              flex: 1,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Progress
              percent={progress}
              size="small"
              status="active"
              style={{ flex: 1 }}
            />
            {typeof costSeconds === "number" && costSeconds > 0 && (
              <span style={{ marginLeft: 12, color: "#888" }}>
                用时 {costSeconds} 秒
              </span>
            )}
          </div>
        )}
        <span
          style={{
            marginLeft: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Tag color="blue">网络类型: {uploadConfig?.networkType}</Tag>
          <Tag color="purple">文件并发数: {fileConcurrency}</Tag>
          <Tag color="purple">分片并发数: {chunkConcurrency}</Tag>
          <Tag color="geekblue">
            切片大小: {(networkChunkSize / 1024 / 1024).toFixed(2)} MB
          </Tag>
          {uploadingAll && (
            <Tag color="magenta">
              总速率: {(totalSpeed / 1024 / 1024).toFixed(2)} MB/s
            </Tag>
          )}
        </span>
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={filesState}
        rowKey="key"
        size="small"
        loading={loading}
        pagination={false}
        locale={{ emptyText: "暂无待上传文件" }}
        rowSelection={rowSelection}
        scroll={{ y: scrollY }}
      />
    </div>
  );
};

export default FileListPanel;
