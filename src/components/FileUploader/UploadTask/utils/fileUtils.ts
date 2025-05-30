/**
 * 生成稳定的文件 ID（基于文件名、大小和最后修改时间）
 * 这样相同的文件每次都会有相同的 ID
 */
export const generateStableFileId = (file: File): string => {
  return `${file.name}-${file.size}-${file.lastModified}`;
};
