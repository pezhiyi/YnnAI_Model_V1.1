import { createLogger } from './logger';

const logger = createLogger('ImageUtils');

/**
 * 压缩图像并返回压缩后的DataURL
 * @param file 原始图像文件
 * @param maxWidth 最大宽度（默认1280像素）
 * @param maxHeight 最大高度（默认1280像素）
 * @param quality JPEG压缩质量（0-1之间，默认0.85）
 * @param preserveAspectRatio 是否保持宽高比（默认为true）
 * @returns Promise<string> 压缩后的图像DataURL
 */
export async function compressImage(
  file: File, 
  maxWidth = 1280, 
  maxHeight = 1280, 
  quality = 0.85,
  preserveAspectRatio = true
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // 1. 创建文件读取器
      const reader = new FileReader();
      
      reader.onload = (e) => {
        // 2. 创建图像对象
        const img = new Image();
        
        img.onload = () => {
          // 检查是否需要压缩
          if (img.width <= maxWidth && img.height <= maxHeight && file.size <= 1024 * 1024) {
            logger.info('图像尺寸已经符合要求，无需压缩', {
              原始尺寸: `${img.width}x${img.height}`,
              文件大小: `${Math.round(file.size / 1024)}KB`
            });
            resolve(e.target?.result as string);
            return;
          }
          
          // 3. 计算新尺寸，保持纵横比
          let width = img.width;
          let height = img.height;
          
          // 记录原始尺寸
          const originalSize = { width, height };
          
          // 获取Leonardo常用输出比例参考
          const leonardoRatio = 16/9; // 1024/576 ≈ 16/9
          const currentRatio = width / height;
          
          // 如果图像超过最大尺寸，按比例缩小
          if (preserveAspectRatio) {
            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = Math.floor(width * ratio);
              height = Math.floor(height * ratio);
            }
          } else {
            // 可选：调整为Leonardo常用比例
            if (Math.abs(currentRatio - leonardoRatio) > 0.2) {
              logger.info('图像比例与Leonardo最佳输出比例差异较大', {
                当前比例: currentRatio.toFixed(2),
                Leonardo推荐比例: leonardoRatio.toFixed(2)
              });
            }
            width = Math.min(width, maxWidth);
            height = Math.min(height, maxHeight);
          }
          
          // 4. 创建canvas并绘制缩小后的图像
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('无法创建Canvas上下文'));
            return;
          }
          
          // 绘制图像
          ctx.drawImage(img, 0, 0, width, height);
          
          // 5. 将canvas转换为DataURL
          const format = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(format, quality);
          
          // 记录压缩信息
          const originalKB = Math.round((e.target?.result as string).length / 1024);
          const compressedKB = Math.round(dataUrl.length / 1024);
          const compressionRatio = Math.round((compressedKB / originalKB) * 100);
          
          logger.info('图像压缩完成', {
            原始尺寸: `${originalSize.width}x${originalSize.height}`,
            压缩后尺寸: `${width}x${height}`,
            原始大小: `${originalKB}KB`,
            压缩后大小: `${compressedKB}KB`,
            压缩率: `${compressionRatio}%`,
            比例调整: `${currentRatio.toFixed(2)} => ${(width/height).toFixed(2)}`,
            Leonardo比例参考: leonardoRatio.toFixed(2),
            质量设置: quality
          });
          
          // 添加压缩结果评估
          if (compressionRatio < 50) {
            logger.info('压缩效果显著 (>50%减小)');
          } else if (compressionRatio > 90) {
            logger.info('压缩效果有限 (<10%减小)');
          }
          
          resolve(dataUrl);
        };
        
        img.onerror = () => {
          reject(new Error('加载图像失败'));
        };
        
        // 设置图像源
        img.src = e.target?.result as string;
      };
      
      reader.onerror = () => {
        reject(new Error('读取文件失败'));
      };
      
      // 开始读取文件
      reader.readAsDataURL(file);
      
    } catch (error) {
      logger.error('压缩图像过程中出错', error);
      reject(error);
    }
  });
}

/**
 * 获取图像实际尺寸
 * @param dataUrl 图像的DataURL
 * @returns Promise包含宽度和高度
 */
export function getImageDimensions(dataUrl: string): Promise<{width: number, height: number}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height
      });
    };
    img.onerror = () => {
      reject(new Error('获取图像尺寸失败'));
    };
    img.src = dataUrl;
  });
} 