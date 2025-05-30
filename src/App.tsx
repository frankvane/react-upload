import UploadTask from "./components/FileUploader/UploadTask";

function App() {
  return (
    <div>
      <h1>文件上传示例</h1>
      <UploadTask
        title="文件上传"
        accept="*"
        multiple={true}
        maxSize={1024} // 最大1GB
      />
    </div>
  );
}

export default App;
