import { Button, Progress, Table, message } from "antd";
import React, { useEffect, useState } from "react";
import {
  clearAllFileMeta,
  getAllFileMeta,
  removeFileMeta,
} from "../services/dbService";

import type { UploadFileMeta } from "../types/file";
import { formatFileSize } from "../services/utils";

interface FileListPanelProps {
  progress?: number;
  costSeconds?: number;
}

const FileListPanel: React.FC<FileListPanelProps> = ({
  progress,
  costSeconds,
}) => {
  const [files, setFiles] = useState<UploadFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [scrollY, setScrollY] = useState(400);

  const fetchFiles = async () => {
    setLoading(true);
    const all = await getAllFileMeta();
    setFiles(all);
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
    setFiles((prev) => prev.filter((item) => item.key !== key));
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
    setFiles((prev) =>
      prev.filter((item) => !selectedRowKeys.includes(item.key))
    );
    await Promise.all(
      selectedRowKeys.map((key) => removeFileMeta(key as string))
    );
    setSelectedRowKeys([]);
    message.success("批量删除成功");
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

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
        <span style={{ marginRight: 16 }}>{formatFileSize(size)}</span>
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
      title: "操作",
      key: "action",
      align: "center" as const,
      width: 100,
      render: (_: any, record: UploadFileMeta) => (
        <Button danger size="small" onClick={() => handleRemove(record.key)}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center" }}>
        <Button
          danger
          size="small"
          onClick={handleClear}
          disabled={files.length === 0}
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
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={files}
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
