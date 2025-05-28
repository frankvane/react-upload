// 引入 spark-md5
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

self.onmessage = async function (e) {
  const { file, chunkSize } = e.data;
  const total = Math.ceil(file.size / chunkSize);
  const chunkMD5s = [];
  let fileSpark = new self.SparkMD5.ArrayBuffer();

  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    const arrayBuffer = await chunk.arrayBuffer();
    const chunkSpark = new self.SparkMD5.ArrayBuffer();
    chunkSpark.append(arrayBuffer);
    const chunkMD5 = chunkSpark.end();
    chunkMD5s.push(chunkMD5);
    fileSpark.append(arrayBuffer);
    // 可选：每处理完一个分片可 postMessage({ progress: i/total })
  }

  const fileMD5 = fileSpark.end();
  self.postMessage({ fileMD5, chunkMD5s });
};
