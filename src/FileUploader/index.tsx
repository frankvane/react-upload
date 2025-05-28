import { Button, List, Progress, Tag, Tooltip, Upload } from "antd";
import React, { useEffect, useRef } from "react";

import { ByteConvert } from "./utils";
import { UploadOutlined } from "@ant-design/icons";
import { useFileUploadQueue } from "./hooks/useFileUploadQueue";
import { useNetworkType } from "./hooks/useNetworkType";

// 恢复 FileUploaderProps 定义
interface FileUploaderProps {
	apiUrl?: string;
	uploadUrl?: string;
	checkUrl?: string;
	mergeUrl?: string;
	headers?: Record<string, string>;
	paramsTransform?: (params: any, type: string) => any;
	onSuccess?: (file: File, res: any) => void;
	onError?: (file: File, err: Error) => void;
	onProgress?: (file: File, percent: number) => void;
	onMergeSuccess?: (file: File, res: any) => void;
	onCheckSuccess?: (file: File, res: any) => void;
	chunkSize?: number;
	concurrency?: number;
	maxRetry?: number;
	accept?: string;
	maxFileSize?: number;
	maxFileCount?: number;
	beforeUpload?: (file: File) => boolean | Promise<boolean>;
	customRequest?: (file: File, chunk: Blob, params: any) => Promise<any>;
	showProgress?: boolean;
	showFileList?: boolean;
	maxSizeMB?: number;
	multiple?: boolean;
	keepAfterUpload?: boolean;
	removeDelayMs?: number;
	onRemoveAfterUpload?: (
		file: File,
		reason: "upload" | "instant",
	) => boolean | void | Promise<boolean | void>;
	allowedTypes?: string[];
	apiPrefix?: string;
}

const DEFAULT_API_PREFIX = "http://localhost:3000/api";

const FileUploader: React.FC<FileUploaderProps> = (props) => {
	const apiPrefix = props.apiPrefix ?? DEFAULT_API_PREFIX;
	const { networkType, concurrency, chunkSize } = useNetworkType();
	const {
		files,
		md5Info,
		instantInfo,
		uploadingInfo,
		uploadingAll,
		speedInfo,
		errorInfo,
		handleBeforeUpload,
		handleStartAll,
		handleRetry,
		handleRetryAllFailed,
		handleStartUploadWithAutoMD5,
		calcTotalSpeed,
	} = useFileUploadQueue({
		accept: props.accept,
		maxSizeMB: props.maxSizeMB,
		multiple: props.multiple,
		concurrency: props.concurrency,
		chunkSize: props.chunkSize,
		uploadUrl: props.uploadUrl,
		checkUrl: props.checkUrl,
		mergeUrl: props.mergeUrl,
		headers: props.headers,
		paramsTransform: props.paramsTransform,
		onSuccess: props.onSuccess,
		onError: props.onError,
		onProgress: props.onProgress,
		onMergeSuccess: props.onMergeSuccess,
		onCheckSuccess: props.onCheckSuccess,
		maxRetry: props.maxRetry,
		keepAfterUpload: props.keepAfterUpload,
		removeDelayMs: props.removeDelayMs,
		onRemoveAfterUpload: props.onRemoveAfterUpload,
		allowedTypes: props.allowedTypes,
		apiPrefix,
	});
	const concurrencyRef = useRef(concurrency);

	// 保证并发数动态响应网络变化
	useEffect(() => {
		concurrencyRef.current = concurrency;
	}, [concurrency]);

	// 统计总速率
	const totalSpeed = calcTotalSpeed(speedInfo);

	// 是否有失败文件
	const hasFailed = files.some((file) => {
		const key = file.name + file.size;
		const uploading = uploadingInfo[key];
		return (
			uploading &&
			(uploading.status === "error" || uploading.status === "merge-error")
		);
	});

	return (
		<div>
			<div style={{ marginBottom: 8 }}>
				<Tag color="blue">网络类型: {networkType}</Tag>
				<Tag color="purple">并发数: {concurrencyRef.current}</Tag>
				<Tag color="geekblue">
					切片大小: {(chunkSize / 1024 / 1024).toFixed(2)} MB
				</Tag>
				{uploadingAll && (
					<Tag color="magenta">
						总速率: {(totalSpeed / 1024 / 1024).toFixed(2)} MB/s
					</Tag>
				)}
				{hasFailed && (
					<Button
						size="small"
						danger
						style={{ marginLeft: 8 }}
						onClick={handleRetryAllFailed}
					>
						重试失败文件
					</Button>
				)}
			</div>
			<Upload
				beforeUpload={handleBeforeUpload}
				showUploadList={false}
				accept={props.accept}
				multiple={props.multiple}
				disabled={uploadingAll}
			>
				<Button icon={<UploadOutlined />}>选择文件</Button>
			</Upload>
			<Button
				type="primary"
				style={{ marginLeft: 8 }}
				onClick={handleStartAll}
				disabled={uploadingAll || files.length === 0}
			>
				{uploadingAll ? "批量上传中..." : "上传全部"}
			</Button>
			<List
				style={{ marginTop: 16 }}
				bordered
				dataSource={files}
				renderItem={(file) => {
					const key = file.name + file.size;
					const md5 = md5Info[key];
					const instant = instantInfo[key];
					const uploading = uploadingInfo[key];
					const speed = speedInfo[key]?.speed || 0;
					const leftTime = speedInfo[key]?.leftTime || 0;
					const error = errorInfo[key];
					return (
						<List.Item>
							<div
								style={{ display: "flex", alignItems: "center", width: "100%" }}
							>
								<span style={{ flex: 1, minWidth: 200 }}>{file.name}</span>
								<span style={{ width: 80, textAlign: "right", color: "#888" }}>
									{ByteConvert(file.size)}
								</span>
								<span
									style={{ width: 120, textAlign: "center", marginLeft: 8 }}
								>
									{uploading && uploading.status === "done" ? (
										<Tag color="green">上传成功</Tag>
									) : (
										<>
											{instant &&
												(instant.uploaded ? (
													<Tag color="green">已秒传</Tag>
												) : (
													<Tag color="orange">
														需上传分片:{" "}
														{
															instant.chunkCheckResult.filter(
																(c: any) => !c.exist || !c.match,
															).length
														}
													</Tag>
												))}
											{!instant?.uploaded && (
												<Button
													size="small"
													type="primary"
													onClick={() => handleStartUploadWithAutoMD5(file)}
													disabled={
														!md5 ||
														(uploading && uploading.status === "uploading") ||
														uploadingAll
													}
												>
													{!md5
														? "计算中..."
														: uploading && uploading.status === "uploading"
															? "上传中..."
															: "开始上传"}
												</Button>
											)}
											{uploading && (
												<span
													style={{ display: "inline-block", minWidth: 100 }}
												>
													<Tooltip
														title={
															uploading.status === "error" ||
															uploading.status === "merge-error"
																? error || "上传失败"
																: undefined
														}
													>
														<Progress
															percent={uploading.progress}
															size="small"
															status={
																uploading.status === "error" ||
																uploading.status === "merge-error"
																	? "exception"
																	: uploading.status === "done"
																		? "success"
																		: undefined
															}
															style={{ width: 80 }}
														/>
													</Tooltip>
													{uploading.status === "uploading" && speed > 0 && (
														<div
															style={{
																fontSize: 12,
																color: "#888",
																marginTop: 2,
															}}
														>
															速度: {(speed / 1024 / 1024).toFixed(2)} MB/s
															{leftTime > 0 && (
																<span style={{ marginLeft: 8 }}>
																	剩余: {Math.ceil(leftTime)} 秒
																</span>
															)}
														</div>
													)}
													{(uploading.status === "error" ||
														uploading.status === "merge-error") && (
														<div
															style={{
																fontSize: 12,
																color: "red",
																marginTop: 2,
															}}
														>
															{error && (
																<span style={{ marginRight: 8 }}>{error}</span>
															)}
															<Button
																size="small"
																danger
																onClick={() => handleRetry(file)}
															>
																重试
															</Button>
														</div>
													)}
												</span>
											)}
										</>
									)}
								</span>
							</div>
						</List.Item>
					);
				}}
				locale={{ emptyText: "暂无待上传文件" }}
			/>
		</div>
	);
};

export default FileUploader;
