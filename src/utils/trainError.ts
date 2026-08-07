/**
 * 将训练相关的错误信息（Error | string | unknown）格式化为用户友好的中文提示。
 * 合并了原 TrainingPage.tsx 的 readableTrainError 和 useYoloTraining.ts 的 formatTrainingFailure。
 */
export function readableTrainError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  if (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Load failed')
  ) {
    return '无法连接本地训练后端，请先运行 npm run dev:all 或 start.bat 启动后端服务。';
  }
  if (message.includes("Invalid CUDA 'device=auto'") || message.includes('Invalid CUDA')) {
    return '当前没有可用 CUDA GPU，后端已回退到 CPU。请重启后端后重新训练。';
  }
  if (
    message.includes('No module named') ||
    message.includes('缺少依赖') ||
    message.includes('YOLO 训练环境缺少') ||
    message.includes('YOLO training requires')
  ) {
    return '本地缺少 YOLO 训练环境。请在 backend 目录运行 python -m pip install -r requirements.txt，或安装 ultralytics torch 后重试。';
  }
  if (message.includes('\n')) {
    return message.split(/\r?\n/)[0] || '训练失败。';
  }
  return message || '训练失败。';
}
