/* eslint-disable no-restricted-globals */
// 在非模块类型的 Worker 中使用 importScripts
// @ts-expect-error - importScripts 在 TypeScript 中没有类型定义
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

// 声明全局 SparkMD5
declare global {
  const SparkMD5: {
    ArrayBuffer: new () => {
      append: (buffer: ArrayBuffer) => void;
      end: () => string;
    };
  };
}

// 处理文件并计算 MD5
self.onmessage = async function (e: MessageEvent) {
  const { file } = e.data as { file: File };
  try {
    const buffer = await file.arrayBuffer();
    // 生成md5
    const spark = new SparkMD5.ArrayBuffer();
    spark.append(buffer);
    const md5 = spark.end();
    self.postMessage(
      {
        success: true,
        data: {
          key: md5,
          name: file.name,
          buffer,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        },
      },
      // @ts-expect-error - 传输 ArrayBuffer
      [buffer]
    );
  } catch (err: any) {
    self.postMessage({
      success: false,
      error: err && err.message ? err.message : "转换失败",
    });
  }
};
