importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

self.onmessage = async function (e) {
  const { file } = e.data;
  try {
    const buffer = await file.arrayBuffer();
    // 生成md5
    const spark = new self.SparkMD5.ArrayBuffer();
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
      [buffer]
    );
  } catch (err) {
    self.postMessage({
      success: false,
      error: err && err.message ? err.message : "转换失败",
    });
  }
};
