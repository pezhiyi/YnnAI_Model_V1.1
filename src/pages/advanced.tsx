import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { processWithMultipleControlNets } from '@/utils/advancedLeonardoService';
import styles from '@/styles/Advanced.module.css';

// 高级处理页面 - 使用多ControlNet进行图像处理
export default function AdvancedPage() {
  // 状态管理
  const [canvasImage, setCanvasImage] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>('');
  const [chinesePrompt, setChinesePrompt] = useState<string>('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  
  // 简单的中英文映射表
  const translationMap: Record<string, string> = {
    '卡通': 'cartoon',
    '宠物': 'pet',
    '可爱': 'cute',
    '风格': 'style',
    '色彩': 'colors',
    '鲜明': 'vibrant',
    '线条': 'lines',
    '流畅': 'smooth',
    '表情': 'expression',
    '姿态': 'pose'
  };
  
  // 简单的翻译函数
  const translateToChinese = (text: string): string => {
    let result = text;
    Object.entries(translationMap).forEach(([cn, en]) => {
      result = result.replace(new RegExp(en, 'gi'), cn);
    });
    return result;
  };
  
  const translateToEnglish = (text: string): string => {
    let result = text;
    Object.entries(translationMap).forEach(([cn, en]) => {
      result = result.replace(new RegExp(cn, 'g'), en);
    });
    return result;
  };
  
  // 处理中文提示词变化
  const handleChinesePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const chineseText = e.target.value;
    setChinesePrompt(chineseText);
    setPrompt(translateToEnglish(chineseText));
  };
  
  // 处理英文提示词变化
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const englishText = e.target.value;
    setPrompt(englishText);
    setChinesePrompt(translateToChinese(englishText));
  };
  
  // 处理画布图片上传
  const handleCanvasImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            // 调整画布大小以适应图片
            canvas.width = img.width;
            canvas.height = img.height;
            
            // 绘制图片
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // 保存画布图片数据
            setCanvasImage(canvas.toDataURL('image/jpeg'));
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };
  
  // 处理参考图片上传
  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setReferenceImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  // 点击画布触发文件上传
  const handleCanvasClick = () => {
    canvasFileInputRef.current?.click();
  };
  
  // 点击参考图片区域触发文件上传
  const handleReferenceClick = () => {
    referenceFileInputRef.current?.click();
  };
  
  // 处理拖放事件
  const handleDrop = (e: React.DragEvent, target: 'canvas' | 'reference') => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (target === 'canvas') {
          const img = new Image();
          img.onload = () => {
            if (canvasRef.current) {
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');
              
              // 调整画布大小以适应图片
              canvas.width = img.width;
              canvas.height = img.height;
              
              // 绘制图片
              ctx?.clearRect(0, 0, canvas.width, canvas.height);
              ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              // 保存画布图片数据
              setCanvasImage(canvas.toDataURL('image/jpeg'));
            }
          };
          img.src = event.target?.result as string;
        } else {
          setReferenceImage(event.target?.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  // 处理拖放进入事件
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  // 处理粘贴事件
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                if (canvasRef.current) {
                  const canvas = canvasRef.current;
                  const ctx = canvas.getContext('2d');
                  
                  // 调整画布大小以适应图片
                  canvas.width = img.width;
                  canvas.height = img.height;
                  
                  // 绘制图片
                  ctx?.clearRect(0, 0, canvas.width, canvas.height);
                  ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                  
                  // 保存画布图片数据
                  setCanvasImage(canvas.toDataURL('image/jpeg'));
                }
              };
              img.src = event.target?.result as string;
            };
            reader.readAsDataURL(blob);
          }
          break;
        }
      }
    }
  };
  
  // 处理图像处理请求
  const handleProcess = async () => {
    if (!canvasImage) {
      setError('请先上传画布图片');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    setMessage('正在处理图像，这可能需要1-2分钟...');
    
    try {
      const combinedPrompt = `[Chinese]${chinesePrompt}[English]${prompt}`;
      
      const result = await processWithMultipleControlNets(
        canvasImage,
        referenceImage || undefined,
        combinedPrompt
      );
      
      if (result.success && result.imageUrl) {
        setResultImage(result.imageUrl);
        setMessage('处理完成！');
      } else {
        setError(result.error || '处理失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理过程中发生未知错误');
    } finally {
      setIsProcessing(false);
    }
  };
  
  // 添加粘贴事件监听
  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, []);
  
  return (
    <>
      <Head>
        <title>高级图像处理 - 多ControlNet</title>
        <meta name="description" content="使用多ControlNet进行高级图像处理" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>高级图像处理</h1>
          <p className={styles.description}>使用多ControlNet技术处理图像</p>
        </div>
        
        <div className={styles.container}>
          <div className={styles.inputSection}>
            <div className={styles.canvasContainer}>
              <h2>画布图片</h2>
              <p className={styles.hint}>点击上传或拖放图片到此处</p>
              <canvas
                ref={canvasRef}
                className={styles.canvas}
                onClick={handleCanvasClick}
                onDrop={(e) => handleDrop(e, 'canvas')}
                onDragOver={handleDragOver}
              />
              <input
                type="file"
                ref={canvasFileInputRef}
                className={styles.fileInput}
                accept="image/*"
                onChange={handleCanvasImageUpload}
              />
            </div>
            
            <div className={styles.referenceContainer}>
              <h2>参考图片 (可选)</h2>
              <p className={styles.hint}>点击上传或拖放图片到此处</p>
              <div
                className={styles.referencePreview}
                onClick={handleReferenceClick}
                onDrop={(e) => handleDrop(e, 'reference')}
                onDragOver={handleDragOver}
              >
                {referenceImage ? (
                  <img src={referenceImage} alt="参考图片" />
                ) : (
                  <div className={styles.placeholder}>
                    <span>+</span>
                  </div>
                )}
              </div>
              <input
                type="file"
                ref={referenceFileInputRef}
                className={styles.fileInput}
                accept="image/*"
                onChange={handleReferenceImageUpload}
              />
            </div>
            
            <div className={styles.promptContainer}>
              <h2>提示词</h2>
              <div className={styles.translationTextarea}>
                <div className={styles.textareaWrapper}>
                  <label>中文</label>
                  <textarea
                    value={chinesePrompt}
                    onChange={handleChinesePromptChange}
                    placeholder="输入中文提示词..."
                    rows={4}
                  />
                </div>
                <div className={styles.textareaWrapper}>
                  <label>English</label>
                  <textarea
                    value={prompt}
                    onChange={handlePromptChange}
                    placeholder="Enter English prompt..."
                    rows={4}
                  />
                </div>
              </div>
              
              <button
                className={styles.processButton}
                onClick={handleProcess}
                disabled={isProcessing || !canvasImage}
              >
                {isProcessing ? '处理中...' : '开始处理'}
              </button>
              
              {error && <div className={styles.error}>{error}</div>}
              {message && <div className={styles.message}>{message}</div>}
            </div>
          </div>
          
          <div className={styles.resultSection}>
            <h2>处理结果</h2>
            <div className={styles.resultContainer}>
              {resultImage ? (
                <img src={resultImage} alt="处理结果" className={styles.resultImage} />
              ) : (
                <div className={styles.placeholder}>
                  <span>处理结果将显示在这里</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
