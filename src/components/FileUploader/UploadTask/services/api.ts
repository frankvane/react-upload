// 文件上传相关 API 封装

// 秒传验证API（需后端接口支持）
export async function checkInstantUpload(
  {
    fileId,
    md5,
    name,
    size,
    total,
    chunkMD5s,
  }: {
    fileId: string;
    md5: string;
    name: string;
    size: number;
    total: number;
    chunkMD5s: string[];
  },
  options?: {
    url?: string;
    apiPrefix?: string;
    headers?: Record<string, string>;
    paramsTransform?: (params: any, type: string) => any;
  }
): Promise<{
  uploaded: boolean;
  chunkCheckResult: Array<{ index: number; exist: boolean; match: boolean }>;
}> {
  const reqBody = options?.paramsTransform
    ? options.paramsTransform(
        {
          file_id: fileId,
          md5,
          name,
          size,
          total,
          chunk_md5s: chunkMD5s,
        },
        "check"
      )
    : {
        file_id: fileId,
        md5,
        name,
        size,
        total,
        chunk_md5s: chunkMD5s,
      };
  const prefix = options?.apiPrefix ?? "";
  const res = await fetch(options?.url || `${prefix}/file/instant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(reqBody),
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.message || "秒传接口异常");
  return data.data || { uploaded: false, chunkCheckResult: [] };
}

// 获取已上传分片
export async function getFileStatus(
  {
    fileId,
    md5,
  }: {
    fileId: string;
    md5: string;
  },
  options?: { apiPrefix?: string }
) {
  const prefix = options?.apiPrefix ?? "";
  const res = await fetch(
    `${prefix}/file/status?file_id=${encodeURIComponent(fileId)}&md5=${md5}`
  );
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.message || "状态检测失败");
  return data.data?.chunks || [];
}

// 上传单个分片
export async function uploadFileChunk(
  {
    fileId,
    chunk_md5,
    index,
    chunk,
    name,
    total,
  }: {
    fileId: string;
    chunk_md5: string;
    index: number;
    chunk: Blob;
    name: string;
    total: number;
  },
  options?: {
    url?: string;
    apiPrefix?: string;
    headers?: Record<string, string>;
    paramsTransform?: (params: any, type: string) => any;
  }
) {
  const formData = new FormData();
  let reqParams = {
    file_id: fileId,
    chunk_md5,
    index: String(index),
    chunk,
    name,
    total: String(total),
  };
  if (options?.paramsTransform) {
    reqParams = options.paramsTransform(reqParams, "upload");
  }
  Object.entries(reqParams).forEach(([k, v]) => {
    formData.append(k, v as any);
  });
  const prefix = options?.apiPrefix ?? "";
  const res = await fetch(options?.url || `${prefix}/file/upload`, {
    method: "POST",
    body: formData,
    headers: options?.headers || {},
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.message || "分片上传失败");
  return data;
}

// 合并分片
export async function mergeFile(
  {
    fileId,
    md5,
    name,
    size,
    total,
  }: {
    fileId: string;
    md5: string;
    name: string;
    size: number;
    total: number;
  },
  options?: {
    url?: string;
    apiPrefix?: string;
    headers?: Record<string, string>;
    paramsTransform?: (params: any, type: string) => any;
  }
) {
  const reqBody = options?.paramsTransform
    ? options.paramsTransform(
        { file_id: fileId, md5, name, size, total },
        "merge"
      )
    : { file_id: fileId, md5, name, size, total };
  const prefix = options?.apiPrefix ?? "";
  const res = await fetch(options?.url || `${prefix}/file/merge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(reqBody),
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.message || "合并失败");
  return data;
}
