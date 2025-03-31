import React, { useRef, useEffect, useState } from 'react';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ProcessedCanvas');

interface ProcessedCanvasProps {
  originalImageUrl: string | null;
  processedImageUrl: string | null;
  width?: number;
  height?: number;
}

/**
 * 处理后图像的画布组件
 */
const ProcessedCanvas: React.FC<ProcessedCanvasProps> = ({
  originalImageUrl,
  processedImageUrl,
  width,
  height
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const processedImageRef = useRef<HTMLImageElement>(null);
  const [brightness, setBrightness] = useState(100); // 亮度值，默认100%
  const [showBrightnessControl, setShowBrightnessControl] = useState(false);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // 加载图片并应用亮度
  useEffect(() => {
    if (!processedImageUrl) return;
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setOriginalImage(img);
      applyBrightnessFilter(img, brightness);
    };
    img.onerror = () => {
      logger.error('加载图片失败');
    };
    img.src = processedImageUrl;
  }, [processedImageUrl]);
  
  // 当亮度改变时应用滤镜
  useEffect(() => {
    if (originalImage) {
      applyBrightnessFilter(originalImage, brightness);
    }
  }, [brightness, originalImage]);

  // 应用亮度滤镜
  const applyBrightnessFilter = (img: HTMLImageElement, brightnessValue: number) => {
    const imgRef = processedImageRef.current;
    if (!imgRef) return;
    
    // 应用CSS滤镜来调整亮度
    imgRef.style.filter = `brightness(${brightnessValue}%)`;
  };

  // 处理亮度变化
  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setBrightness(value);
  };

  // 复制图片到剪贴板
  const copyImageToClipboard = async () => {
    if (!processedImageUrl) return;
    
    try {
      // 创建一个临时的canvas来获取图片数据
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0);
        
        // 如果亮度不是100%，应用亮度滤镜
        if (brightness !== 100) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          const factor = brightness / 100;
          
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, data[i] * factor);     // 红色
            data[i + 1] = Math.min(255, data[i + 1] * factor); // 绿色
            data[i + 2] = Math.min(255, data[i + 2] * factor); // 蓝色
          }
          
          ctx.putImageData(imageData, 0, 0);
        }
        
        try {
          // 将canvas转换为blob
          canvas.toBlob(async (blob) => {
            if (!blob) {
              logger.error('无法创建图片Blob');
              return;
            }
            
            try {
              // 创建ClipboardItem并复制到剪贴板
              const item = new ClipboardItem({ 'image/png': blob });
              await navigator.clipboard.write([item]);
              logger.info('图片已复制到剪贴板');
              
              // 显示复制成功提示
              const notification = document.createElement('div');
              notification.textContent = '图片已复制到剪贴板';
              notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-md shadow-lg';
              document.body.appendChild(notification);
              
              // 3秒后移除提示
              setTimeout(() => {
                document.body.removeChild(notification);
              }, 3000);
              
            } catch (error) {
              logger.error('复制到剪贴板失败', error);
              alert('复制图片失败，请手动右键保存图片');
            }
          }, 'image/png');
        } catch (error) {
          logger.error('创建Blob失败', error);
        }
      };
      
      img.onerror = () => {
        logger.error('加载图片失败');
        alert('无法加载图片，请手动右键保存');
      };
      
      img.src = processedImageUrl;
      
    } catch (error) {
      logger.error('复制图片过程中出错', error);
    }
  };
  
  // 保存图片到本地
  const saveImage = async () => {
    if (!processedImageUrl) return;
    
    try {
      // 创建一个临时的canvas来获取图片数据
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0);
        
        // 如果亮度不是100%，应用亮度滤镜
        if (brightness !== 100) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          const factor = brightness / 100;
          
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, data[i] * factor);     // 红色
            data[i + 1] = Math.min(255, data[i + 1] * factor); // 绿色
            data[i + 2] = Math.min(255, data[i + 2] * factor); // 蓝色
          }
          
          ctx.putImageData(imageData, 0, 0);
        }
        
        try {
          // 将canvas转换为blob URL
          canvas.toBlob((blob) => {
            if (!blob) {
              logger.error('无法创建图片Blob');
              return;
            }
            
            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `processed-image-${new Date().getTime()}.png`;
            document.body.appendChild(a);
            a.click();
            
            // 清理
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 100);
            
            logger.info('图片已保存');
            
            // 显示保存成功提示
            const notification = document.createElement('div');
            notification.textContent = '图片已保存';
            notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-md shadow-lg';
            document.body.appendChild(notification);
            
            // 3秒后移除提示
            setTimeout(() => {
              document.body.removeChild(notification);
            }, 3000);
            
          }, 'image/png');
        } catch (error) {
          logger.error('保存图片失败', error);
          alert('保存图片失败，请手动右键保存图片');
        }
      };
      
      img.onerror = () => {
        logger.error('加载图片失败');
        alert('无法加载图片，请手动右键保存');
      };
      
      img.src = processedImageUrl;
      
    } catch (error) {
      logger.error('保存图片过程中出错', error);
    }
  };
  
  // 打开放大预览
  const openPreview = () => {
    if (!processedImageUrl) return;
    setIsPreviewOpen(true);
  };
  
  // 关闭放大预览
  const closePreview = () => {
    setIsPreviewOpen(false);
  };
  
  // 切换亮度控制显示
  const toggleBrightnessControl = () => {
    setShowBrightnessControl(!showBrightnessControl);
  };

  // 检测移动设备
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full flex items-center justify-center p-3 relative"
      style={{ minHeight: isMobile ? '250px' : '300px' }}
    >
      {!processedImageUrl ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12 mb-3 text-gray-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
          <p className="text-sm">处理后的图像将显示在此处</p>
          <p className="text-xs mt-1 opacity-70">先上传并处理图像</p>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <img 
            ref={processedImageRef}
            src={processedImageUrl} 
            alt="处理后的图像" 
            className="max-w-full max-h-full object-contain rounded-sm shadow-sm"
            style={{ 
              maxHeight: isMobile ? '300px' : '70vh',
              filter: `brightness(${brightness}%)`
            }}
          />
          
          {/* 操作按钮 - 移动端优化 */}
          <div className={`absolute ${isMobile ? 'bottom-2 right-2 flex flex-col gap-2' : 'bottom-4 right-4 flex gap-2'}`}>
            <button
              onClick={toggleBrightnessControl}
              className={`p-1.5 ${isMobile ? 'w-9 h-9' : 'p-2'} ${showBrightnessControl ? 'bg-yellow-600' : 'bg-yellow-500'} text-white rounded-full shadow-md hover:bg-yellow-600 transition-colors`}
              title="调整亮度"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
            
            <button
              onClick={saveImage}
              className={`p-1.5 ${isMobile ? 'w-9 h-9' : 'p-2'} bg-purple-500 text-white rounded-full shadow-md hover:bg-purple-600 transition-colors`}
              title="保存图片"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            
            <button
              onClick={copyImageToClipboard}
              className={`p-1.5 ${isMobile ? 'w-9 h-9' : 'p-2'} bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors`}
              title="复制图片"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </button>
            
            <button
              onClick={openPreview}
              className={`p-1.5 ${isMobile ? 'w-9 h-9' : 'p-2'} bg-green-500 text-white rounded-full shadow-md hover:bg-green-600 transition-colors`}
              title="放大预览"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </button>
          </div>
          
          {/* 亮度控制滑块 - 移动端优化 */}
          {showBrightnessControl && (
            <div className={`absolute ${isMobile ? 'bottom-14 right-2' : 'bottom-16 right-4'} bg-white dark:bg-gray-800 p-3 rounded-md shadow-lg`}>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <input
                  type="range"
                  min="70"
                  max="130"
                  step="5"
                  value={brightness}
                  onChange={handleBrightnessChange}
                  className={`${isMobile ? 'w-24' : 'w-32'} h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer`}
                />
                <span className="text-xs text-gray-600 dark:text-gray-300 w-8">{brightness}%</span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* 放大预览模态框 */}
      {isPreviewOpen && processedImageUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img 
              src={processedImageUrl} 
              alt="放大预览" 
              className="max-w-full max-h-[90vh] object-contain"
              style={{ filter: `brightness(${brightness}%)` }}
            />
            
            {/* 关闭按钮 */}
            <button
              onClick={closePreview}
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-gray-200 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* 预览中的控制按钮 */}
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button
                onClick={saveImage}
                className="p-2 bg-purple-500 text-white rounded-full shadow-md hover:bg-purple-600 transition-colors"
                title="保存图片"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              
              <button
                onClick={copyImageToClipboard}
                className="p-2 bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors"
                title="复制图片"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
              </button>
            </div>
            
            {/* 预览中的亮度控制 */}
            <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-800 p-3 rounded-md shadow-lg">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <input
                  type="range"
                  min="70"
                  max="130"
                  step="5"
                  value={brightness}
                  onChange={handleBrightnessChange}
                  className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-xs text-gray-600 dark:text-gray-300 w-8">{brightness}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessedCanvas;
