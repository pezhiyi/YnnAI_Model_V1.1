"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { analyzeImageWithOpenAI, extractBase64FromDataUrl } from "@/utils/openaiService";
import { processWithImageToImageAndStyle, fetchLeonardoElements, LeonardoElement } from "@/utils/leonardoService";
import ProcessedCanvas from "@/components/ProcessedCanvas";
import { createLogger } from "@/utils/logger";
import ProcessingStatusOverlay from '../components/ProcessingStatusOverlay';
import { useProcessingStatus } from '../hooks/useProcessingStatus';
import ProcessingMask from '@/components/ProcessingMask';
import dynamic from 'next/dynamic';

// 创建主页面的日志记录器
const logger = createLogger('HomePage');

// 最简单的方式确保组件仅在客户端渲染
function ClientOnly({ children }: { children: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);
  
  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  if (!hasMounted) {
    return null; // 在客户端初始加载前不渲染任何内容
  }
  
  return <>{children}</>;
}

// 确保组件只在客户端渲染，避免hydration错误
const ClientOnlyHome = () => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [chineseText, setChineseText] = useState(""); // 中文输入
  const [englishText, setEnglishText] = useState(""); // 英文提示
  
  // ChatGPT相关状态
  const [extraPrompt, setExtraPrompt] = useState(""); // 额外提示词
  const [gptResponse, setGptResponse] = useState(""); // GPT返回的分析结果
  const [isAnalyzing, setIsAnalyzing] = useState(false); // 是否正在分析图片
  const [analysisError, setAnalysisError] = useState(""); // 分析错误信息
  const [autoAnalyze, setAutoAnalyze] = useState(true); // 是否在上传后自动分析
  const [showEnglish, setShowEnglish] = useState(false); // 是否显示英文描述
  
  // 处理后的图像URL
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); // 是否正在处理图片
  const [processingError, setProcessingError] = useState(""); // 处理错误信息
  
  // 检测是否是移动设备
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appContainerRef = useRef<HTMLDivElement>(null);
  const chineseTextRef = useRef<HTMLTextAreaElement>(null); // 中文文本框引用
  const englishTextRef = useRef<HTMLTextAreaElement>(null); // 英文文本框引用

  // 添加元素相关状态
  const [availableElements, setAvailableElements] = useState<LeonardoElement[]>([]);
  const [selectedElements, setSelectedElements] = useState<Array<{elementId: string, weight: number}>>([]);
  const [isLoadingElements, setIsLoadingElements] = useState(false);
  const [showElementSelector, setShowElementSelector] = useState(false);
  
  // 添加快速模式状态
  const [useFastMode, setUseFastMode] = useState(true);
  
  // 添加处理状态管理
  const { 
    status, 
    message, 
    error, 
    startAnalyzing, 
    startGenerating, 
    setError, 
    reset 
  } = useProcessingStatus();
  
  // 创建一个引用来获取处理按钮
  const processButtonRef = useRef<HTMLButtonElement>(null);
  
  // 添加日志状态
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [showProcessingMask, setShowProcessingMask] = useState(false);
  
  // 添加拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  
  // 添加日志函数
  const addLog = useCallback((message: string) => {
    setProcessingLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);
  
  // 在组件加载时检测屏幕尺寸和设置视口高度
  useEffect(() => {
    // 设置初始视口高度
    setViewportHeight(window.innerHeight);
    
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      // 更新视口高度
      setViewportHeight(window.innerHeight);
    };
    
    // 初始检测
    checkMobile();
    
    // 使用节流函数优化resize事件处理
    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(checkMobile, 100);
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, []);

  // 添加图片压缩函数
  const compressImage = (file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.8): Promise<File> => {
    return new Promise((resolve, reject) => {
      // 创建一个FileReader来读取文件
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // 检查图片是否需要压缩
          if (img.width <= maxWidth && img.height <= maxHeight && file.size < 1024 * 1024) {
            // 如果图片尺寸已经足够小，直接返回原文件
            resolve(file);
            return;
          }

          // 创建canvas进行压缩
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // 计算缩放比例
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round(height * maxWidth / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round(width * maxHeight / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          
          // 在canvas上绘制调整后的图片
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('无法创建canvas上下文'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);

          // 转换为Blob
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('转换为Blob失败'));
              return;
            }
            
            // 创建一个新文件
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            
            resolve(compressedFile);
          }, 'image/jpeg', quality);
        };
        
        img.onerror = () => {
          reject(new Error('图片加载失败'));
        };
        
        // 设置图片源
        img.src = event.target?.result as string;
      };
      
      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };
      
      reader.readAsDataURL(file);
    });
  };

  // 修改processImageFile函数，加入压缩逻辑
  const processImageFile = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) {
      logger.warn('无效的文件类型', { 类型: file?.type || '未知' });
      return;
    }
    
    logger.info('开始处理图片文件', { 
      文件名: file.name,
      文件大小: Math.round(file.size / 1024) + 'KB', 
      文件类型: file.type 
    });
    
    setIsLoading(true);
    
    try {
      // 压缩图片
      const compressedFile = await compressImage(file);
      logger.info('图片压缩完成', {
        原始大小: Math.round(file.size / 1024) + 'KB',
        压缩后大小: Math.round(compressedFile.size / 1024) + 'KB'
      });
      
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setImageUrl(result);
        setIsLoading(false);
        
        // 清除之前的分析结果
        setGptResponse("");
        setAnalysisError("");
        
        // 如果启用了自动分析，上传完成后自动分析图片
        if (autoAnalyze) {
          logger.info('启用了自动分析，开始分析图片');
          analyzeImage(result, extraPrompt);
        }
      };
      
      reader.onerror = (e) => {
        logger.error('文件读取错误', reader.error);
        setIsLoading(false);
      };
      
      reader.readAsDataURL(compressedFile);
    } catch (error) {
      logger.error('图片压缩失败', error);
      // 如果压缩失败，尝试使用原始文件
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setImageUrl(result);
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // 处理图片上传（文件选择）
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processImageFile(file);
  };

  // 触发文件选择对话框
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // 处理全局拖拽上传
  useEffect(() => {
    const appContainer = appContainerRef.current;
    if (!appContainer) return;

    // 添加拖拽指示变量
    const [isDragging, setIsDragging] = useState(false);

    const preventDefault = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragEnter = (e: DragEvent) => {
      preventDefault(e);
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      preventDefault(e);
      // 仅当拖离元素是应用容器本身或其子元素时才设置为false
      if (e.currentTarget === e.target) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      preventDefault(e);
      if (e.dataTransfer) {
        // 明确指示这是一个复制操作
        e.dataTransfer.dropEffect = 'copy';
      }
      // 保持拖拽状态
      setIsDragging(true);
    };

    const handleDrop = (e: DragEvent) => {
      preventDefault(e);
      setIsDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        processImageFile(e.dataTransfer.files[0]);
      }
    };

    appContainer.addEventListener("dragenter", handleDragEnter as EventListener);
    appContainer.addEventListener("dragleave", handleDragLeave as EventListener);
    appContainer.addEventListener("dragover", handleDragOver as EventListener);
    appContainer.addEventListener("drop", handleDrop as EventListener);

    return () => {
      appContainer.removeEventListener("dragenter", handleDragEnter as EventListener);
      appContainer.removeEventListener("dragleave", handleDragLeave as EventListener);
      appContainer.removeEventListener("dragover", handleDragOver as EventListener);
      appContainer.removeEventListener("drop", handleDrop as EventListener);
    };
  }, []);

  // 添加拖拽指示器UI
  {isDragging && (
    <div className="fixed inset-0 bg-blue-500/10 backdrop-blur-sm z-50 pointer-events-none flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg shadow-lg text-center">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto text-blue-500 mb-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-lg font-medium text-gray-700">释放鼠标上传图片</p>
      </div>
    </div>
  )}

  // 处理粘贴上传
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData) {
        const items = e.clipboardData.items;
        
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              processImageFile(file);
              break;
            }
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  // 分析图片的函数
  const analyzeImage = async (imageUrl: string, additionalPrompt: string = "") => {
    if (isAnalyzing) return;
    
    // 清空之前的日志并显示遮罩
    setProcessingLogs(["开始分析图像..."]);
    setShowProcessingMask(true);
    
    setIsAnalyzing(true);
    setAnalysisError("");
    
    try {
      addLog("调用AI分析图像...");
      logger.info('开始分析图片', { 提示词: additionalPrompt || '无' });
      
      const base64Data = extractBase64FromDataUrl(imageUrl);
      const response = await analyzeImageWithOpenAI(base64Data, additionalPrompt);
      
      if (response.error) {
        addLog(`分析失败: ${response.error}`);
        setAnalysisError(response.error);
        logger.error('图片分析失败', { 错误: response.error });
        return;
      }
      
      // 设置分析结果
      addLog("分析完成，获取到描述");
      setGptResponse(response.text);
      setChineseText(response.chineseText || "");
      setEnglishText(response.englishText || "");
      
      logger.info('图片分析完成', { 
        结果长度: response.text.length,
        中文长度: (response.chineseText || "").length,
        英文长度: (response.englishText || "").length
      });
      
      // 确保分析完成后状态重置
      setIsAnalyzing(false);
      
      // 使用setTimeout确保状态更新后再模拟点击处理按钮
      setTimeout(() => {
        if (processButtonRef.current && imageUrl) {
          addLog("准备处理图像...");
          logger.info('分析完成，模拟点击处理按钮');
          processButtonRef.current.click(); // 模拟点击处理按钮
        }
      }, 100);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      addLog(`错误: ${errorMessage}`);
      setAnalysisError(errorMessage);
      logger.error('图片分析过程中出错', { 错误: errorMessage });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 加载元素列表
  const loadElements = async () => {
    try {
      setIsLoadingElements(true);
      const elements = await fetchLeonardoElements();
      setAvailableElements(elements);
    } catch (error) {
      logger.error('加载元素失败', error);
    } finally {
      setIsLoadingElements(false);
    }
  };
  
  // 在组件挂载时加载元素
  useEffect(() => {
    loadElements();
  }, []);
  
  // 添加或移除元素
  const toggleElement = (elementId: string, initialWeight: number = 0.5) => {
    setSelectedElements(prev => {
      const existing = prev.find(e => e.elementId === elementId);
      
      if (existing) {
        // 如果元素已存在，则移除它
        return prev.filter(e => e.elementId !== elementId);
      } else {
        // 否则添加元素
        return [...prev, { elementId, weight: initialWeight }];
      }
    });
  };
  
  // 更新元素权重
  const updateElementWeight = (elementId: string, weight: number) => {
    setSelectedElements(prev =>
      prev.map(e => e.elementId === elementId ? { ...e, weight } : e)
    );
  };

  // 修改处理图片的函数
  const processImage = async () => {
    // 添加调试日志
    logger.debug('processImage函数被调用', {
      imageUrl: !!imageUrl,
      isProcessing,
      已有英文描述: !!englishText
    });
    
    if (!imageUrl || isProcessing) {
      logger.warn('处理图像条件不满足', { 
        有图像: !!imageUrl, 
        正在处理: isProcessing 
      });
      return;
    }
    
    // 清空之前的日志并显示遮罩
    setProcessingLogs([]);
    setShowProcessingMask(true);
    addLog("开始处理图像...");
    
    setIsProcessing(true);
    setProcessingError("");
    setProcessedImageUrl(null);
    
    try {
      // 检查是否已有英文描述，如果没有才进行分析
      if (!englishText) {
        addLog("分析图像中...");
        
        // 从DataURL中提取Base64数据
        const base64Data = extractBase64FromDataUrl(imageUrl);
        
        // 调用OpenAI分析图像
        addLog("调用AI分析图像...");
        const openaiResponse = await analyzeImageWithOpenAI(base64Data, extraPrompt);
        
        if (openaiResponse.error) {
          addLog(`分析失败: ${openaiResponse.error}`);
          setProcessingError(openaiResponse.error);
          return;
        }
        
        addLog("分析完成，获取到描述");
        
        // 设置描述文本
        setGptResponse(openaiResponse.text);
        setChineseText(openaiResponse.chineseText || "");
        setEnglishText(openaiResponse.englishText || "");
      } else {
        addLog("使用已有的图像分析结果");
      }
      
      // 调用Leonardo.ai处理图像
      addLog("开始生成艺术图像...");
      const leonardoResponse = await processWithImageToImageAndStyle(
        imageUrl,
        "/refer-to.png",
        englishText || "", // 使用已有的英文描述
        { width: imageDimensions.width, height: imageDimensions.height },
        selectedElements,
        useFastMode
      );
      
      if (!leonardoResponse.success) {
        addLog(`生成失败: ${leonardoResponse.error}`);
        setProcessingError(leonardoResponse.error || "图像处理失败");
        return;
      }
      
      addLog("图像生成成功!");
      setProcessedImageUrl(leonardoResponse.imageUrl || null);
      
      // 处理成功后3秒关闭遮罩
      setTimeout(() => {
        setShowProcessingMask(false);
      }, 3000);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "处理过程中出错";
      addLog(`错误: ${errorMessage}`);
      setProcessingError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  // 使用useMemo优化计算画布尺寸的逻辑
  const calculateCanvasDimensions = useMemo(() => {
    return (originalWidth: number, originalHeight: number) => {
      if (originalWidth === 0 || originalHeight === 0) {
        return { width: 0, height: 0 };
      }
      
      // 获取容器尺寸（考虑窗口大小和布局）
      let containerWidth, containerHeight;
      if (window.innerWidth >= 1024) { // lg断点
        // 大屏左侧布局
        containerWidth = (window.innerWidth / 2) * 0.4; // 左侧区域的40%
        containerHeight = (window.innerHeight - 120) * 0.38; // 考虑顶部空间和边距
      } else {
        // 小屏或中屏
        containerWidth = window.innerWidth - 32;
        containerHeight = (window.innerHeight - 120) * 0.3;
      }
      
      // 确保有最小的显示区域
      containerWidth = Math.max(containerWidth, 200);
      containerHeight = Math.max(containerHeight, 150);
      
      // 计算适合容器的缩放尺寸，保持原始比例
      const widthRatio = containerWidth / originalWidth;
      const heightRatio = containerHeight / originalHeight;
      
      // 选择较小的比例确保图片完全适应容器
      const ratio = Math.min(widthRatio, heightRatio);
      
      return { 
        width: Math.floor(originalWidth * ratio),
        height: Math.floor(originalHeight * ratio)
      };
    };
  }, []);

  // 当图片URL改变时，在画布上绘制图片
  useEffect(() => {
    if (!imageUrl || !sourceCanvasRef.current) return;
    
    const canvas = sourceCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    const image = new Image();
    image.src = imageUrl;
    
    image.onload = () => {
      // 记录原始尺寸
      setImageDimensions({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      
      // 设置canvas尺寸为图像的原始尺寸
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      
      // 清除并绘制图像
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      
      logger.debug('图像已加载到画布', { 
        宽: image.naturalWidth, 
        高: image.naturalHeight
      });
    };
    
    image.onerror = () => {
      logger.error('加载图像到画布失败');
    };
  }, [imageUrl]);

  // 屏幕大小变化时重新调整画布 - 使用防抖优化
  useEffect(() => {
    if (imageUrl && sourceCanvasRef.current && imageDimensions.width > 0) {
      let resizeTimeout: NodeJS.Timeout;
      
      const resizeCanvas = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          // 重新加载图片并调整画布大小
          const img = new Image();
          img.onload = () => {
            const { width: displayWidth, height: displayHeight } = 
              calculateCanvasDimensions(imageDimensions.width, imageDimensions.height);
            
            const sourceCanvas = sourceCanvasRef.current;
            if (!sourceCanvas) return;
            
            sourceCanvas.width = displayWidth;
            sourceCanvas.height = displayHeight;
            
            const ctx = sourceCanvas.getContext('2d', { alpha: true });
            if (ctx) {
              ctx.clearRect(0, 0, displayWidth, displayHeight);
              ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
            }
            
            // 同步设置结果画布尺寸
            if (resultCanvasRef.current) {
              const resultCanvas = resultCanvasRef.current;
              resultCanvas.width = displayWidth;
              resultCanvas.height = displayHeight;
              
              const resultCtx = resultCanvas.getContext('2d', { alpha: true });
              if (resultCtx) {
                resultCtx.clearRect(0, 0, displayWidth, displayHeight);
              }
            }
          };
          img.src = imageUrl;
        }, 150); // 防抖延迟
      };
      
      resizeCanvas();
      
      return () => {
        clearTimeout(resizeTimeout);
      };
    }
  }, [isMobile, imageUrl, imageDimensions, calculateCanvasDimensions]);

  // 实现拖拽处理函数
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有当离开的元素是容器本身时才重置状态
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        processImageFile(file);
      } else {
        // 提示用户只能上传图片
        logger.warn('不支持的文件类型', { type: file.type });
        // 这里可以添加一个提示
      }
    }
  }, [processImageFile]);

  // 这部分可以删除或替换为下面的React方式
  useEffect(() => {
    // 如果需要额外的事件处理，可以保留这部分代码
    // 但一般情况下，React的事件处理已经足够
    
    // 可能的移动设备兼容性处理
    const preventDefaultForMobile = (e: TouchEvent) => {
      // 防止移动设备上的默认滚动行为
      if (e.touches.length === 1) {
        e.preventDefault();
      }
    };
    
    // 只在移动设备上添加触摸事件处理
    if (isMobile && appContainerRef.current) {
      appContainerRef.current.addEventListener('touchmove', preventDefaultForMobile, { passive: false });
      
      return () => {
        if (appContainerRef.current) {
          appContainerRef.current.removeEventListener('touchmove', preventDefaultForMobile);
        }
      };
    }
  }, [isMobile]);

  return (
    <ClientOnly>
      <div 
        ref={appContainerRef}
        className={`flex flex-col bg-gray-50 min-h-screen ${isDragging ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 添加拖拽指示器覆盖层 */}
        {isDragging && (
          <div className="fixed inset-0 bg-blue-500/10 backdrop-blur-sm z-50 pointer-events-none flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg shadow-lg text-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto text-blue-500 mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-lg font-medium text-gray-700">释放鼠标上传图片</p>
            </div>
          </div>
        )}
        
        {/* 隐藏的文件输入框 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
        
        {/* 容器 - 修复移动端滚动问题 */}
        <div className="max-w-7xl mx-auto w-full p-2 md:p-4 flex flex-col min-h-screen overflow-auto">
          {/* 顶部标识栏 */}
          <div className="w-full mb-2 flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <img src="/logo.png" alt="YnnAI" className="w-5 h-5 rounded-sm object-contain" />
              <span className="text-sm font-medium text-gray-700">YnnAI_画像Model_V1.1</span>
            </div>
            {/* 自动分析选项 */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAnalyze}
                onChange={(e) => setAutoAnalyze(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500 focus:ring-blue-400 focus:ring-1"
              />
              <span className="text-xs text-gray-500">上传后自动分析</span>
            </label>
          </div>
          
          {/* 错误消息区域 */}
          {(analysisError || processingError) && (
            <div className="w-full mx-auto mb-2 px-3 py-2 bg-red-50 backdrop-blur-sm border border-red-100 text-red-500 text-xs rounded-md shadow-sm">
              {analysisError && <div>分析错误: {analysisError}</div>}
              {processingError && <div>处理错误: {processingError}</div>}
            </div>
          )}
          
          {/* 主内容区域 - 修复移动端显示问题 */}
          <div className="w-full grow flex flex-col lg:flex-row gap-3 md:gap-4">
            {/* 左侧区域 */}
            <div className="lg:w-1/2 flex flex-col gap-3">
              {/* 图片上传区域 - 更现代的设计 */}
              <div 
                className="flex-none md:flex-[1.2] overflow-hidden bg-white backdrop-blur-sm shadow-md flex flex-col rounded-md"
                onClick={triggerFileInput}
                style={{ minHeight: isMobile ? '150px' : '200px' }}
              >
                <div className="py-2 px-3 flex justify-between items-center border-b border-gray-100">
                  <h2 className="text-xs font-medium text-gray-600">原始图片</h2>
                  {imageDimensions.width > 0 && (
                    <div className="text-xs text-gray-400">
                      {imageDimensions.width} × {imageDimensions.height}
                    </div>
                  )}
                </div>
                
                <div className="flex-grow flex items-center justify-center relative">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-12">
                      <div className="animate-pulse w-6 h-6 rounded-full bg-blue-100"></div>
                    </div>
                  ) : !imageUrl ? (
                    <div className="border-2 border-dashed border-gray-200 rounded-md m-3 flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-gray-50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={0.8} stroke="currentColor" className="w-10 h-10 text-gray-300 mb-2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                      </svg>
                      <p className="text-gray-400 text-sm">点击或拖拽上传图片</p>
                      <p className="text-gray-300 text-xs mt-1">支持粘贴上传</p>
                    </div>
                  ) : (
                    <div ref={canvasContainerRef} className="relative flex items-center justify-center w-full h-full p-3 group">
                      <canvas 
                        ref={sourceCanvasRef} 
                        className="max-w-full max-h-full object-contain cursor-pointer rounded-sm shadow-sm"
                        style={{ objectFit: 'contain' }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <div className="bg-white/90 backdrop-blur-sm py-2 px-3 rounded-md shadow-md flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-blue-500">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                          </svg>
                          <span className="text-sm text-gray-700">点击或拖拽更换图片</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 额外提示词输入框与分析按钮 - 进一步优化移动端 */}
              <div className="bg-white backdrop-blur-sm shadow-md rounded-md py-2 px-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-1.5">ChatGPT 额外提示词</div>
                  <input
                    type="text"
                    value={extraPrompt}
                    onChange={(e) => setExtraPrompt(e.target.value)}
                    placeholder={isMobile ? "输入提示词..." : "输入额外的提示词，例如：分析图中的宠物特征..."}
                    className="w-full p-2 border border-gray-100 bg-gray-50/80 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 transition-all"
                  />
                </div>
                <button
                  onClick={() => analyzeImage(imageUrl || "", extraPrompt)}
                  disabled={isAnalyzing || !imageUrl}
                  className={`px-3 py-1.5 md:px-4 md:py-2 rounded-md shadow-sm text-white text-xs md:text-sm transition-all whitespace-nowrap mt-1 md:mt-6 flex items-center justify-center gap-1.5 ${
                    isAnalyzing 
                      ? 'bg-blue-400 cursor-not-allowed' 
                      : imageUrl 
                        ? 'bg-blue-500 hover:bg-blue-600' 
                        : 'bg-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isAnalyzing ? (
                    <span className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                      {isMobile ? "分析中" : "分析中..."}
                    </span>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                      分析图片
                    </>
                  )}
                </button>
              </div>
              
              {/* 中英文文本区域 - 优化移动端显示 */}
              <div className="flex-1 flex flex-col gap-3" style={{ minHeight: isMobile ? '120px' : '180px' }}>
                {/* 中文描述区域 */}
                <div className={`flex-1 flex flex-col overflow-hidden bg-white backdrop-blur-sm shadow-md rounded-md ${showEnglish ? 'h-1/2' : 'h-full'}`}>
                  <div className="py-2 px-3 flex justify-between items-center border-b border-gray-100">
                    <h2 className="text-xs font-medium text-gray-600">中文描述</h2>
                    <div className="flex items-center gap-2">
                      {gptResponse && (
                        <span className="text-xs text-blue-500">
                          AI 生成内容
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-3">
                    <textarea
                      ref={chineseTextRef}
                      value={chineseText}
                      onChange={(e) => setChineseText(e.target.value)}
                      placeholder="AI分析结果将显示在此处..."
                      className="w-full h-full p-0 border-0 bg-transparent resize-none text-sm focus:outline-none focus:ring-0 transition-all cursor-default"
                      readOnly
                    />
                  </div>
                </div>
                
                {/* 英文描述区域 - 默认隐藏 */}
                {showEnglish && (
                  <div className="flex-1 flex flex-col overflow-hidden bg-white backdrop-blur-sm shadow-md rounded-md h-1/2">
                    <div className="py-2 px-3 flex justify-between items-center border-b border-gray-100">
                      <h2 className="text-xs font-medium text-gray-600">English Description</h2>
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                      <textarea
                        ref={englishTextRef}
                        value={englishText}
                        onChange={(e) => setEnglishText(e.target.value)}
                        placeholder="AI analysis will be displayed here..."
                        className="w-full h-full p-0 border-0 bg-transparent resize-none text-sm focus:outline-none focus:ring-0 transition-all cursor-default"
                        readOnly
                      />
                    </div>
                  </div>
                )}
              </div>
              
              {/* 显示/隐藏英文按钮 - 更好的视觉区分 */}
              <div className="flex justify-end">
                <button 
                  onClick={() => setShowEnglish(!showEnglish)} 
                  className="py-1 px-2.5 md:py-1.5 md:px-3 text-xs text-gray-500 hover:text-blue-500 bg-white hover:bg-white backdrop-blur-sm rounded-md shadow-sm transition-colors"
                >
                  {showEnglish ? '隐藏英文描述' : '显示英文描述'}
                </button>
              </div>
            </div>
            
            {/* 右侧区域 - 修复高度问题 */}
            <div className="lg:w-1/2 flex flex-col mb-4">
              <div className="flex-1 flex flex-col overflow-visible bg-white backdrop-blur-sm shadow-md rounded-md">
                <div className="py-2 px-3 flex justify-between items-center border-b border-gray-100">
                  <h2 className="text-xs font-medium text-gray-600">AI 处理图像</h2>
                  <div className="text-xs text-blue-500 font-medium">
                    {processedImageUrl ? "处理完成" : ""}
                  </div>
                </div>
                
                {/* 处理选项选择器 - 移动端优化 */}
                <div className="p-2 md:p-3 border-b border-gray-100 bg-gray-50/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs text-gray-500 min-w-[60px] md:min-w-[80px]">处理风格:</div>
                    <div className="flex-1 p-1.5 md:p-2 text-xs md:text-sm border-0 rounded-md bg-white shadow-sm overflow-hidden whitespace-nowrap text-ellipsis">
                      YnnAI_宠物画像_Model_V1
                    </div>
                    
                    {/* 快速/质量模式选择器 - 移动端优化 */}
                    <div className="flex rounded-md overflow-hidden shadow-sm mt-2 w-full md:mt-0 md:w-auto">
                      <button
                        onClick={() => setUseFastMode(true)}
                        className={`flex-1 md:flex-none px-2 md:px-3.5 py-1.5 text-xs transition-colors flex items-center justify-center gap-1.5 ${
                          useFastMode 
                            ? 'bg-purple-500 text-white font-medium' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {useFastMode && (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                          </svg>
                        )}
                        Fast
                      </button>
                      <button
                        onClick={() => setUseFastMode(false)}
                        className={`flex-1 md:flex-none px-2 md:px-3.5 py-1.5 text-xs transition-colors flex items-center justify-center gap-1.5 ${
                          !useFastMode 
                            ? 'bg-purple-500 text-white font-medium' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {!useFastMode && (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                          </svg>
                        )}
                        Quality
                      </button>
                    </div>
                    
                    {/* 优化移动端按钮排列 */}
                    <div className="flex flex-wrap gap-2 mt-2 w-full">
                      <button
                        onClick={() => setShowElementSelector(!showElementSelector)}
                        className="flex-1 px-2 md:px-3.5 py-1.5 rounded-md text-xs font-medium text-gray-600 bg-white shadow-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 text-gray-500">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
                        </svg>
                        {selectedElements.length > 0 ? 
                          (isMobile ? `${selectedElements.length}个元素` : `已选${selectedElements.length}个元素`) : 
                          "选择元素"}
                      </button>
                      
                      <button
                        ref={processButtonRef}
                        onClick={processImage}
                        disabled={isProcessing || !imageUrl}
                        className={`flex-1 px-2 md:px-3.5 py-1.5 rounded-md shadow-sm text-white text-xs font-medium transition-all whitespace-nowrap flex items-center justify-center gap-1.5 ${
                          isProcessing 
                            ? 'bg-blue-400 cursor-not-allowed' 
                            : imageUrl 
                              ? 'bg-blue-500 hover:bg-blue-600' 
                              : 'bg-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {isProcessing ? (
                          <span className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                            {isMobile ? "处理中" : "处理中..."}
                          </span>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                            </svg>
                            {isMobile ? "处理" : "处理图像"}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  
                  {/* 元素选择器面板 - 优化移动端显示 */}
                  {showElementSelector && (
                    <div className="mt-3 p-2 md:p-3 bg-white rounded-md shadow-sm max-h-60 overflow-auto">
                      <div className="text-xs font-medium text-gray-500 mb-2">选择元素 (LoRA)</div>
                      
                      {isLoadingElements ? (
                        <div className="text-center py-2 text-xs text-gray-400">加载元素中...</div>
                      ) : availableElements.length === 0 ? (
                        <div className="text-center py-2 text-xs text-gray-400">暂无可用元素</div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {availableElements.map(element => {
                            const isSelected = selectedElements.some(e => e.elementId === element.akUUID);
                            const selectedElement = selectedElements.find(e => e.elementId === element.akUUID);
                            
                            return (
                              <div 
                                key={element.akUUID}
                                className={`p-2.5 rounded-md cursor-pointer transition-all ${
                                  isSelected ? 'bg-blue-50 border border-blue-200 shadow-sm' : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                                }`}
                                onClick={() => toggleElement(element.akUUID, element.weight)}
                              >
                                <div className="flex justify-between items-center">
                                  <div className="font-medium text-sm">{element.name}</div>
                                  <div className="text-xs text-gray-500">{element.weight.toFixed(1)}</div>
                                </div>
                                
                                {element.description && (
                                  <div className="text-xs text-gray-500 mt-1.5">{element.description}</div>
                                )}
                                
                                {isSelected && (
                                  <div className="mt-2.5">
                                    <input 
                                      type="range"
                                      min={element.minWeight || 0.1}
                                      max={element.maxWeight || 2.0}
                                      step={0.1}
                                      value={selectedElement?.weight || element.weight}
                                      onChange={(e) => updateElementWeight(element.akUUID, parseFloat(e.target.value))}
                                      className="w-full h-1.5 bg-blue-100 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                                      <span>{element.minWeight || 0.1}</span>
                                      <span>{selectedElement?.weight.toFixed(1) || element.weight.toFixed(1)}</span>
                                      <span>{element.maxWeight || 2.0}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* 处理后的图像画布 - 修复显示问题 */}
                <div className="min-h-[300px] relative">
                  <ProcessedCanvas 
                    originalImageUrl={imageUrl} 
                    processedImageUrl={processedImageUrl}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* 处理遮罩 */}
        <ProcessingMask 
          isVisible={showProcessingMask}
          logs={processingLogs}
          onClose={() => setShowProcessingMask(false)}
        />
      </div>
    </ClientOnly>
  );
}

// 使用动态导入避免服务器端渲染问题
const Home = dynamic(() => Promise.resolve(ClientOnlyHome), { ssr: false });
export default Home;
