import React, { useState, useEffect } from 'react';

interface ProcessingMaskProps {
  isVisible: boolean;
  logs: string[];
  onClose: () => void;
}

const ProcessingMask: React.FC<ProcessingMaskProps> = ({ isVisible, logs, onClose }) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const estimatedTime = 20; // 预计处理时间（秒）

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isVisible) {
      // 重置计时器和进度
      setElapsedTime(0);
      setProgress(0);
      
      // 开始计时
      timer = setInterval(() => {
        setElapsedTime(prev => {
          const newTime = prev + 1;
          // 根据已用时间更新进度
          setProgress(Math.min((newTime / estimatedTime) * 100, 95));
          return newTime;
        });
      }, 1000);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">处理中...</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <span className="sr-only">关闭</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 进度条 */}
        <div className="mb-4">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-sm text-gray-500">
            <span>已用时间: {elapsedTime}秒</span>
            <span>预计需要: {estimatedTime}秒</span>
          </div>
        </div>

        {/* 处理日志 */}
        <div className="bg-gray-50 rounded-md p-3 max-h-[200px] overflow-y-auto">
          <div className="space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="text-sm text-gray-600">
                {log}
              </div>
            ))}
          </div>
        </div>

        {/* 处理提示 */}
        <div className="mt-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
            <span>正在处理您的图像...</span>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            处理时间可能因图像大小和网络状况而有所不同
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProcessingMask; 