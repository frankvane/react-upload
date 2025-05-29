import React, { useState } from "react";

import FileListPanel from "./components/FileListPanel";
import FileSelector from "./components/FileSelector";
import { UploadConfigContext } from "./context";
import { useNetworkType } from "./hooks/useNetworkType";

const UploadTask: React.FC = () => {
  const [progress, setProgress] = useState<number>(100);
  const [costSeconds, setCostSeconds] = useState<number>(0);

  const { networkType, concurrency, chunkSize } = useNetworkType();
  const networkReady = !!networkType && concurrency > 0 && chunkSize > 0;

  const handleProgress = (
    progress: number,
    current: number,
    total: number,
    cost?: number
  ) => {
    setProgress(progress);
    if (typeof cost === "number") setCostSeconds(cost);
  };

  if (!networkReady) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        正在检测网络状态...
      </div>
    );
  }

  return (
    <UploadConfigContext.Provider
      value={{ networkType, concurrency, chunkSize }}
    >
      <h2>文件批量上传任务</h2>
      <FileSelector onProgress={handleProgress} />
      <div style={{ marginTop: 32 }}>
        <FileListPanel progress={progress} costSeconds={costSeconds} />
      </div>
    </UploadConfigContext.Provider>
  );
};

export default UploadTask;
