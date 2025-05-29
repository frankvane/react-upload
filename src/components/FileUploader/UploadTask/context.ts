import React from "react";

export interface UploadConfigContextProps {
  networkType: string;
  fileConcurrency: number;
  chunkConcurrency: number;
  chunkSize: number;
  concurrency?: number; // 兼容老参数，可选
  // 后续可扩展更多属性，如 FileUploaderProps
  [key: string]: any;
}

export const UploadConfigContext =
  React.createContext<UploadConfigContextProps | null>(null);
