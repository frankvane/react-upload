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

// UploadFileMeta 转 File
function metaToFile(meta: UploadFileMeta): File {
  const file = new File([meta.buffer], meta.name, {
    type: meta.type,
    lastModified: meta.lastModified,
  });
  // 关键：强制加 key 字段（内容 hash/md5）
  (file as any).key = meta.key;
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
    const all = await getAllFileMeta();
    setFilesState(all);
    const fileArr = all.map(metaToFile);
    setFiles(fileArr);
    setLoading(false);
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
        return (
          <div>
            {uploading && uploading.status === "done" ? (
              <Tag color="green">上传成功</Tag>
            ) : (
              <>
                {instant &&
                  (instant.uploaded ? (
                    <Tag color="green">已秒传</Tag>
                  ) : (
                    <Tag color="orange">
                      需上传分片:{" "}
                      {
                        instant.chunkCheckResult.filter(
                          (c: any) => !c.exist || !c.match
                        ).length
                      }
                    </Tag>
                  ))}
                {!instant?.uploaded && (
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
                    {!md5
                      ? "计算中..."
                      : uploading && uploading.status === "uploading"
                      ? "上传中..."
                      : "开始上传"}
                  </Button>
                )}
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
