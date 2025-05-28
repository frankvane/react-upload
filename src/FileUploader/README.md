# FileUploader 组件文档

## 组件简介

FileUploader 是一个基于 Ant Design 的大文件分片上传组件，支持秒传、断点续传、分片重试、上传进度、速率统计、网络自适应、失败重试、上传后自动移除等功能，适用于多种业务场景。

## 主要特性

- 支持大文件分片上传，自动计算 MD5
- 秒传、断点续传、分片重试
- 并发上传，网络类型自适应
- 上传进度、速率、剩余时间实时展示
- 支持自定义 API 前缀、请求头、参数转换
- 支持上传完成后自动移除文件
- 支持文件类型白名单校验
- 详细错误提示与重试机制

## 属性（Props）

| 属性名              | 类型                                  | 默认值                                 | 说明                                         |
| ------------------- | ------------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------ |
| apiPrefix           | string                                | 'http://localhost:3000/api'            | API 前缀，所有接口请求会拼接该前缀           |
| uploadUrl           | string                                | -                                      | 上传分片接口完整 URL（优先级高于 apiPrefix） |
| checkUrl            | string                                | -                                      | 秒传检测接口完整 URL（优先级高于 apiPrefix） |
| mergeUrl            | string                                | -                                      | 合并分片接口完整 URL（优先级高于 apiPrefix） |
| headers             | Record<string, string>                | -                                      | 请求头设置                                   |
| paramsTransform     | (params: any, type: string) => any    | -                                      | 参数转换函数，type: 'check'/'upload'/'merge' |
| onSuccess           | (file: File, res: any) => void        | -                                      | 上传成功回调                                 |
| onError             | (file: File, err: Error) => void      | -                                      | 上传失败回调                                 |
| onProgress          | (file: File, percent: number) => void | -                                      | 上传进度回调                                 |
| onMergeSuccess      | (file: File, res: any) => void        | -                                      | 合并成功回调                                 |
| onCheckSuccess      | (file: File, res: any) => void        | -                                      | 秒传成功回调                                 |
| chunkSize           | number                                | 2 _ 1024 _ 1024                        | 分片大小（字节）                             |
| concurrency         | number                                | 3（或根据网络类型自适应）              | 并发上传数                                   |
| maxRetry            | number                                | 3                                      | 分片上传失败最大重试次数                     |
| accept              | string                                | \*                                     | 允许上传的文件类型（input accept）           |
| maxSizeMB           | number                                | 2048                                   | 单文件最大体积（MB）                         |
| multiple            | boolean                               | false                                  | 是否支持多文件上传                           |
| keepAfterUpload     | boolean                               | true                                   | 上传完成后是否保留文件                       |
| removeDelayMs       | number                                | 2000                                   | 上传完成后延时移除文件的毫秒数               |
| onRemoveAfterUpload | (file: File, reason: 'upload'         | 'instant') => boolean\|void\|Promise   | -                                            | 上传完成后移除文件的回调 |
| allowedTypes        | string[]                              | ['image/png','image/jpeg','image/gif'] | 允许的文件 MIME 类型白名单                   |

> 详细属性请参考源码注释。

## 使用示例

### 基础用法示例

```tsx
import FileUploader from "./FileUploader";

<FileUploader
  accept="image/*"
  maxSizeMB={100}
  allowedTypes={["image/png", "image/jpeg"]}
/>;
```

### 完整用法示例

```tsx
import FileUploader from "./FileUploader";

<FileUploader
  apiPrefix="/api"
  uploadUrl="/api/file/upload"
  checkUrl="/api/file/instant"
  mergeUrl="/api/file/merge"
  accept="image/*"
  maxSizeMB={100}
  allowedTypes={["image/png", "image/jpeg"]}
  chunkSize={2 * 1024 * 1024}
  concurrency={3}
  maxRetry={5}
  headers={{ Authorization: "Bearer token" }}
  paramsTransform={(params, type) => ({ ...params, extra: "test" })}
  keepAfterUpload={false}
  removeDelayMs={1000}
  onSuccess={(file, res) => console.log("上传成功", file, res)}
  onError={(file, err) => console.error("上传失败", file, err)}
  onProgress={(file, percent) => console.log("进度", file.name, percent)}
  onMergeSuccess={(file, res) => console.log("合并成功", file, res)}
  onCheckSuccess={(file, res) => console.log("秒传成功", file, res)}
  onRemoveAfterUpload={async (file, reason) => {
    // 可异步确认是否移除
    return window.confirm(`移除文件 ${file.name}，原因：${reason}`);
  }}
/>;
```

## 常见问题与注意事项

- 默认所有接口返回格式需为 `{ code, message, data }`。
- 若需自定义接口路径，请传入 uploadUrl、checkUrl、mergeUrl。
- allowedTypes 只校验 MIME 类型，accept 仅影响选择器提示。
- 组件已适配主流浏览器，建议配合后端分片上传接口使用。
- 详细更新日志请见项目根目录 `UPDATE.md`。

## 更新日志

- 详见项目根目录 `UPDATE.md`。
