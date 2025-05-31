import UploadTask from "./components/FileUploader/UploadTask";

function App() {
  return (
    <div style={{ padding: "20px" }}>
      <h1>文件上传示例</h1>
      <UploadTask
        title="文件上传"
        accept="*"
        multiple={true}
        maxSize={1024} // 最大1GB
        showMemoryUsage={true} // 显示内存使用状态
      />
    </div>
  );
}

export default App;
