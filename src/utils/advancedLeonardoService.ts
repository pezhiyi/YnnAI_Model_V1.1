// advancedLeonardoService.ts - 提供高级Leonardo.ai API功能
import { createLogger } from './logger';
import { ControlNetConfig, ControlNetType, LeonardoResponse } from './leonardoService';

// 创建高级Leonardo服务的专用日志记录器
const logger = createLogger('AdvancedLeonardoService');

// Leonardo.ai API密钥和基础URL
const LEONARDO_API_KEY = 'cc1f1988-4fe5-47f7-851c-e63176b2fdd0';
const LEONARDO_API_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';

/**
 * 从DataURL中提取Base64数据
 * @param dataUrl 图片的DataURL
 * @returns 仅包含Base64数据的字符串
 */
function extractBase64FromDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:([A-Za-z-+/]+);base64,/, '');
}

/**
 * 获取上传图像的预签名URL
 * @param extension 文件扩展名 (jpg/png)
 * @returns 预签名URL和上传ID
 */
export async function getImageUploadUrl(extension: 'jpg' | 'png' = 'jpg'): Promise<{
  url: string;
  fields: Record<string, string>;
  id: string;
} | null> {
  try {
    logger.info('获取图像上传预签名URL');
    
    const response = await fetch(`${LEONARDO_API_BASE_URL}/init-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify({ extension })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('获取上传URL失败', errorData);
      return null;
    }
    
    const data = await response.json();
    
    return {
      url: data.uploadInitImage.url,
      fields: JSON.parse(data.uploadInitImage.fields),
      id: data.uploadInitImage.id
    };
  } catch (error) {
    logger.error('获取上传URL过程中出错', error);
    return null;
  }
}

/**
 * 上传图像到预签名URL
 * @param imageBase64 Base64格式的图像数据
 * @param uploadUrl 上传URL
 * @param fields 上传字段
 * @returns 上传成功返回true，否则返回false
 */
export async function uploadImageToPresignedUrl(
  imageBase64: string,
  uploadUrl: string,
  fields: Record<string, string>
): Promise<boolean> {
  try {
    logger.info('上传图像到预签名URL');
    
    // 将Base64转换为Blob
    const response = await fetch(imageBase64);
    const blob = await response.blob();
    
    // 创建FormData对象
    const formData = new FormData();
    
    // 添加上传URL和字段
    formData.append('uploadUrl', uploadUrl);
    formData.append('fields', JSON.stringify(fields));
    
    // 添加文件
    formData.append('file', blob, 'image.jpg');
    
    // 使用代理API上传图像
    const proxyResponse = await fetch('/api/upload-proxy', {
      method: 'POST',
      body: formData
    });
    
    if (!proxyResponse.ok) {
      const errorData = await proxyResponse.json();
      logger.error('通过代理上传图像失败', errorData);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('上传图像过程中出错', error);
    return false;
  }
}

/**
 * 创建图像生成任务
 * @param config 生成配置
 * @returns 生成任务ID
 */
export async function createGeneration(config: any): Promise<string | null> {
  try {
    logger.info('创建图像生成任务');
    
    const response = await fetch(`${LEONARDO_API_BASE_URL}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('创建生成任务失败', errorData);
      return null;
    }
    
    const data = await response.json();
    return data.sdGenerationJob?.generationId || null;
  } catch (error) {
    logger.error('创建生成任务过程中出错', error);
    return null;
  }
}

/**
 * 获取生成任务结果
 * @param generationId 生成任务ID
 * @returns 生成结果
 */
export async function getGenerationResult(generationId: string): Promise<{
  status: string;
  imageUrl?: string;
  imageId?: string;
}> {
  try {
    logger.info('获取生成任务结果', { generationId });
    
    const response = await fetch(`${LEONARDO_API_BASE_URL}/generations/${generationId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${LEONARDO_API_KEY}`
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('获取生成任务结果失败', errorData);
      return { status: 'error' };
    }
    
    const data = await response.json();
    
    // 检查生成状态
    const status = data.generations_by_pk?.status;
    
    if (status === 'COMPLETE') {
      // 获取第一张生成的图像
      const generatedImages = data.generations_by_pk?.generated_images || [];
      if (generatedImages.length > 0) {
        return {
          status: 'complete',
          imageUrl: generatedImages[0].url,
          imageId: generatedImages[0].id
        };
      }
      return { status: 'complete', imageUrl: undefined };
    } else if (status === 'FAILED') {
      return { status: 'failed' };
    } else {
      return { status: 'pending' };
    }
  } catch (error) {
    logger.error('获取生成任务结果过程中出错', error);
    return { status: 'error' };
  }
}

/**
 * 等待生成任务完成
 * @param generationId 生成任务ID
 * @param maxAttempts 最大尝试次数
 * @param interval 检查间隔(毫秒)
 * @returns 生成结果
 */
export async function waitForGenerationCompletion(
  generationId: string,
  maxAttempts: number = 30,
  interval: number = 2000
): Promise<LeonardoResponse> {
  logger.info('等待生成任务完成', { generationId, maxAttempts, interval });
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 等待指定的间隔时间
    await new Promise(resolve => setTimeout(resolve, interval));
    
    // 获取生成结果
    const result = await getGenerationResult(generationId);
    
    if (result.status === 'complete' && result.imageUrl) {
      logger.info('生成任务完成', { generationId, imageUrl: result.imageUrl });
      return {
        success: true,
        imageUrl: result.imageUrl
      };
    } else if (result.status === 'failed' || result.status === 'error') {
      logger.error('生成任务失败', { generationId, status: result.status });
      return {
        success: false,
        error: `生成任务失败: ${result.status}`
      };
    }
    
    logger.debug(`等待生成任务完成，尝试 ${attempt + 1}/${maxAttempts}`);
  }
  
  logger.error('生成任务超时', { generationId });
  return {
    success: false,
    error: '生成任务超时'
  };
}

/**
 * 使用多个ControlNet处理图像
 * @param canvasImageBase64 画布图像的Base64数据
 * @param referenceImageBase64 参考图像的Base64数据（可选）
 * @param prompt 提示词
 * @returns 处理结果
 */
export async function processWithMultipleControlNets(
  canvasImageBase64: string,
  referenceImageBase64?: string,
  prompt?: string
): Promise<LeonardoResponse> {
  try {
    logger.info('使用多个ControlNet处理图像');
    
    // 步骤1: 上传画布图像
    const canvasUploadInfo = await getImageUploadUrl();
    if (!canvasUploadInfo) {
      return {
        success: false,
        error: '获取画布图像上传URL失败'
      };
    }
    
    const canvasUploadSuccess = await uploadImageToPresignedUrl(
      canvasImageBase64,
      canvasUploadInfo.url,
      canvasUploadInfo.fields
    );
    
    if (!canvasUploadSuccess) {
      return {
        success: false,
        error: '上传画布图像失败'
      };
    }
    
    const canvasImageId = canvasUploadInfo.id;
    logger.info('画布图像上传成功', { imageId: canvasImageId });
    
    // 步骤2: 创建初始生成（用于样式参考）
    const initialGenerationConfig = {
      height: 768,
      modelId: '2067ae52-33fd-4a82-bb92-c2c55e7d2786', // AlbedoBase XL
      prompt: "卡通风格参考图像",
      width: 1024,
      num_images: 1,
      alchemy: true
    };
    
    const initialGenerationId = await createGeneration(initialGenerationConfig);
    if (!initialGenerationId) {
      return {
        success: false,
        error: '创建初始生成任务失败'
      };
    }
    
    logger.info('等待初始生成任务完成...');
    
    // 等待初始生成完成
    await new Promise(resolve => setTimeout(resolve, 15000)); // 等待15秒
    
    // 获取生成结果
    const initialResult = await getGenerationResult(initialGenerationId);
    
    if (initialResult.status !== 'complete' || !initialResult.imageId) {
      return {
        success: false,
        error: '初始生成任务失败或超时'
      };
    }
    
    const generatedImageId = initialResult.imageId;
    logger.info('初始生成任务完成', { imageId: generatedImageId });
    
    // 步骤3: 使用多个ControlNet创建最终生成
    const finalGenerationConfig = {
      height: 1024,
      modelId: '2067ae52-33fd-4a82-bb92-c2c55e7d2786', // AlbedoBase XL
      prompt: prompt || "卡通风格的宠物形象，色彩鲜明，线条流畅，具有可爱的表情和姿态",
      width: 1024,
      alchemy: true,
      controlnets: [
        {
          initImageId: canvasImageId,
          initImageType: "UPLOADED",
          preprocessorId: ControlNetType.SDXL.CHARACTER_REFERENCE, // 角色参考
          strengthType: "Mid",
        },
        {
          initImageId: generatedImageId,
          initImageType: "GENERATED",
          preprocessorId: ControlNetType.SDXL.STYLE_REFERENCE, // 样式参考
          strengthType: "High",
        }
      ]
    };
    
    const finalGenerationId = await createGeneration(finalGenerationConfig);
    if (!finalGenerationId) {
      return {
        success: false,
        error: '创建最终生成任务失败'
      };
    }
    
    // 等待最终生成完成并返回结果
    return await waitForGenerationCompletion(finalGenerationId);
    
  } catch (error) {
    logger.error('多ControlNet处理过程中出错', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '多ControlNet处理过程中发生未知错误'
    };
  }
}
