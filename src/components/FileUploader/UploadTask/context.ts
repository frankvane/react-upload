import React from "react";

export interface UploadConfigContextProps {
  networkType: string;
  concurrency: number;
  chunkSize: number;
  // 后续可扩展更多属性，如 FileUploaderProps
  [key: string]: any;
}

export const UploadConfigContext =
  React.createContext<UploadConfigContextProps | null>(null);
