import React from 'react';
import { createPortal } from 'react-dom';

// 处理状态类型
export type ProcessingStatus = 
  | 'idle'                  // 空闲状态
  | 'analyzing'             // OpenAI 分析图像中
  | 'generating'            // Leonardo.ai 生成图像中
  | 'error';                // 处理出错

interface ProcessingStatusOverlayProps {
  status: ProcessingStatus;
  message?: string;
  error?: string;
}

// 状态消息映射
const statusMessages = {
  idle: '准备就绪',
  analyzing: '正在分析图像...',
  generating: '正在生成艺术图像...',
  error: '处理出错'
};

const ProcessingStatusOverlay: React.FC<ProcessingStatusOverlayProps> = ({ 
  status, 
  message, 
  error 
}) => {
  // 如果是空闲状态，不显示任何内容
  if (status === 'idle') return null;
  
  // 创建一个 Portal，确保覆盖在整个应用上方
  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full">
        <div className="flex flex-col items-center">
          {status !== 'error' ? (
            // 加载动画
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          ) : (
            // 错误图标
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-red-100 mb-4">
              <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
          
          <h2 className="text-xl font-bold mb-2">
            {message || statusMessages[status]}
          </h2>
          
          {status === 'analyzing' && (
            <p className="text-gray-600 dark:text-gray-300 text-center">
              正在使用 AI 分析您的图像并生成描述，请稍候...
            </p>
          )}
          
          {status === 'generating' && (
            <p className="text-gray-600 dark:text-gray-300 text-center">
              正在基于分析结果生成艺术图像，这可能需要一些时间...
            </p>
          )}
          
          {error && (
            <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
              {error}
            </div>
          )}
          
          {status !== 'error' && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              处理过程中请勿关闭页面
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProcessingStatusOverlay; 