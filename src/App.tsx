import UploadTask from "./components/FileUploader/UploadTask";

function App() {
  return (
    <div style={{ padding: "20px" }}>
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
