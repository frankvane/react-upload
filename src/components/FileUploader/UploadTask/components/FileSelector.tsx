import { Button, message } from "antd";
import React, { useRef, useState } from "react";
import { getFileMeta, saveFileMeta } from "../services/dbService";

import { UploadConfigContext } from "../context";
import type { UploadFileMeta } from "../types/file";
import { UploadOutlined } from "@ant-design/icons";
import { fileToArrayBufferWithWorker } from "../services/fileWorkerService";

interface FileSelectorProps {
  accept?: string;
  multiple?: boolean;
  onProgress?: (
    progress: number,
    current: number,
    total: number,
    costSeconds?: number
  ) => void;
}

const FileSelector: React.FC<FileSelectorProps> = ({
  accept = "*",
  multiple = true,
  onProgress,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const msgKey = "file-process-msg";
  const uploadConfig = React.useContext(UploadConfigContext);
  const chunkSize =
    typeof uploadConfig?.chunkSize === "number"
      ? uploadConfig.chunkSize
      : 2 * 1024 * 1024;

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    const startTime = Date.now();
    let added = 0;
    let skipped = 0;
    let failed = 0;
    const failedFiles: string[] = [];
    let current = 0;
    const total = files.length;
    onProgress?.(0, 0, total);
    message.destroy(msgKey);
    message.loading({ content: "正在处理文件...", key: msgKey, duration: 0 });
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const meta = await fileToArrayBufferWithWorker(file);
        const exists = await getFileMeta(meta.key);
        if (!exists) {
          const metaWithTime: UploadFileMeta = {
            ...meta,
            addedAt: Date.now(),
            chunkSize,
          };
          await saveFileMeta(metaWithTime);
          added++;
        } else {
          skipped++;
        }
      } catch {
        failed++;
        failedFiles.push(file.name);
      }
      current++;
      onProgress?.(Math.round((current / total) * 100), current, total);
    }
    const endTime = Date.now();
    const costSeconds = ((endTime - startTime) / 1000).toFixed(2);
    let msg = `共处理${total}个文件，新增${added}个，跳过${skipped}个重复文件`;
    msg += `，用时${costSeconds}秒。`;
    if (failed > 0) {
      msg += `\n失败${failed}个：${failedFiles.join(", ")}`;
      message.error({ content: msg, key: msgKey, duration: 5 });
    } else {
      message.success({ content: msg, key: msgKey, duration: 3 });
    }
    onProgress?.(100, total, total, Number(costSeconds));
    setLoading(false);
    // 清空input，保证下次可重新选择同一文件
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <input
        type="file"
        ref={inputRef}
        style={{ display: "none" }}
        accept={accept}
        multiple={multiple}
        onChange={handleFiles}
        disabled={loading}
      />
      <Button
        icon={<UploadOutlined />}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        type="primary"
      >
        选择文件
      </Button>
    </div>
  );
};

export default FileSelector;
