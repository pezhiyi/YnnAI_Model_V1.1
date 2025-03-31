// leonardoService.ts - 封装 Leonardo.ai API 调用逻辑
import { createLogger } from './logger';

// 创建Leonardo服务的专用日志记录器
const logger = createLogger('LeonardoService');

interface LeonardoProcessingOption {
  id: string;
  name: string;
  description: string;
  modelId?: string;  // 添加可选的模型ID
  supportsControlNet?: boolean;  // 是否支持ControlNet
  supportsPhotoReal?: boolean;   // 是否支持PhotoReal
  supportedControlNets?: number[]; // 支持的ControlNet预处理器ID
}

export interface LeonardoResponse {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

export interface ControlNetConfig {
  initImageId: string;
  initImageType: 'GENERATED' | 'UPLOADED';
  preprocessorId: number;
  strengthType?: string;
  weight?: string;
  influence?: number;
}

// Leonardo.ai API密钥和基础URL
const LEONARDO_API_KEY = process.env.NEXT_PUBLIC_LEONARDO_API_KEY;
const LEONARDO_API_BASE_URL = process.env.NEXT_PUBLIC_LEONARDO_API_BASE_URL || 'https://cloud.leonardo.ai/api/rest/v1';

// 修改模型ID的硬编码
const MODEL_IDS = {
  ALBEDO_BASE_XL: process.env.NEXT_PUBLIC_LEONARDO_MODEL_ALBEDO_XL || '2067ae52-33fd-4a82-bb92-c2c55e7d2786',
  ANIME_XL: process.env.NEXT_PUBLIC_LEONARDO_MODEL_ANIME_XL || 'e71a1c2f-4f80-4800-934f-2c68979d8cc8',
  KINO_XL: process.env.NEXT_PUBLIC_LEONARDO_MODEL_KINO_XL || 'aa77f04e-3eec-4034-9c07-d0f619684628'
};

// 添加日志输出以便调试
logger.debug('Leonardo API配置:', {
  API_KEY: LEONARDO_API_KEY ? '已设置' : '未设置',
  BASE_URL: LEONARDO_API_BASE_URL,
  环境: process.env.NODE_ENV
});

/**
 * 获取可用的Leonardo.ai处理选项
 * @returns 可用处理选项列表
 */
export function getProcessingOptions(): LeonardoProcessingOption[] {
  // 检查API密钥是否存在
  if (!LEONARDO_API_KEY) {
    logger.error('Leonardo API密钥未设置，请在环境变量中配置LEONARDO_API_KEY');
  }
  
  logger.debug('获取处理选项列表');
  
  return [
    {
      id: 'albedo',
      name: 'AlbedoBase XL - 卡通风格',
      description: '使用AlbedoBase XL模型创建卡通风格的图像',
      modelId: MODEL_IDS.ALBEDO_BASE_XL,
      supportsControlNet: true,
      supportedControlNets: [
        Number(process.env.NEXT_PUBLIC_LEONARDO_CONTROLNET_STYLE_REFERENCE) || 67,
        Number(process.env.NEXT_PUBLIC_LEONARDO_CONTROLNET_CHARACTER_REFERENCE) || 133
      ]
    }
  ];
}

/**
 * 带重试机制的API请求函数
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1000
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      logger.debug(`尝试请求 (${i + 1}/${retries}):`, { url });
      const response = await fetch(url, options);
      
      if (response.ok) {
        return response;
      }
      
      // 记录错误响应
      const errorText = await response.text();
      logger.error('请求失败:', {
        状态码: response.status,
        响应: errorText,
        尝试次数: i + 1
      });
      
      // 如果是认证错误，立即失败
      if (response.status === 401 || response.status === 403) {
        throw new Error(`认证失败: ${response.status}`);
      }
      
      // 如果是速率限制错误，等待更长时间
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, delay * 2));
        continue;
      }
      
      throw new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
      logger.error('请求出错:', error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Maximum retries reached');
}

/**
 * 优化的等待生成完成函数
 */
async function waitForGenerationCompletion(
  generationId: string,
  options = { maxPolls: 40, initialDelay: 3000, maxDelay: 10000 }
): Promise<string | null> {
  let pollCount = 0;
  let currentDelay = options.initialDelay;
  
  while (pollCount < options.maxPolls) {
    try {
      const response = await fetchWithRetry(
        `${LEONARDO_API_BASE_URL}/generations/${generationId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${LEONARDO_API_KEY}`
          }
        }
      );
      
      const data = await response.json();
      
      if (data.generations_by_pk) {
        const status = data.generations_by_pk.status;
        logger.debug('生成状态', { status, pollCount });
        
        switch (status) {
          case 'COMPLETE':
            const imageId = data.generations_by_pk.generated_images?.[0]?.id;
            if (imageId) {
              logger.info('生成完成', { imageId });
              return imageId;
            }
            return null;
            
          case 'FAILED':
            logger.error('生成失败', data.generations_by_pk);
            return null;
            
          case 'PENDING':
            // 使用指数退避增加延迟
            currentDelay = Math.min(currentDelay * 1.5, options.maxDelay);
            break;
            
          default:
            logger.warn('未知状态', { status });
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      pollCount++;
      
    } catch (error) {
      logger.error('轮询过程出错', error);
      // 发生错误时增加延迟
      currentDelay = Math.min(currentDelay * 2, options.maxDelay);
      pollCount++;
    }
  }
  
  logger.error('等待生成超时');
  return null;
}

/**
 * 使用Leonardo.ai处理图像
 * @param imageBase64 Base64格式的图片数据
 * @param processingOptionId 处理选项ID
 * @returns 包含处理结果的Promise对象
 */
export async function processImageWithLeonardo(
  imageBase64: string,
  processingOptionId: string
): Promise<LeonardoResponse> {
  try {
    // 确保API密钥存在
    if (!LEONARDO_API_KEY) {
      logger.error('API密钥缺失');
      return { 
        success: false, 
        error: "Leonardo.ai API密钥缺失" 
      };
    }

    // 从DataURL中提取纯base64数据
    const base64Data = imageBase64.startsWith('data:') 
      ? extractBase64FromDataUrl(imageBase64)
      : imageBase64;
    
    logger.info('开始处理图像', { 选项: processingOptionId, 图像大小: Math.round(base64Data.length / 1024) + 'KB' });

    // 获取当前处理选项的模型ID
    const modelId = getModelIdForOption(processingOptionId);
    logger.debug('使用模型', { modelId, 处理选项: processingOptionId });

    // 第一步：创建第一个生成请求（初始图像）
    logger.info('创建初始图像生成请求');
    
    const initialGenerationPayload = {
      prompt: "[Chinese]高质量宠物照片，展示宠物的自然特征[English]High quality pet photo showing the natural characteristics of the pet",
      modelId,
      width: 512,
      height: 512,
      num_images: 1,  // 确保只生成1张图片
      public: false
    };
    
    logger.debug('初始生成请求配置', { 
      url: `${LEONARDO_API_BASE_URL}/generations`,
      bodySize: JSON.stringify(initialGenerationPayload).length
    });

    const initialGenerationResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/generations`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify(initialGenerationPayload)
      }
    );

    // 解析响应JSON
    const initialGenData = await initialGenerationResponse.json();
    
    // 检查响应状态
    if (!initialGenerationResponse.ok) {
      logger.error('初始图像生成请求失败', initialGenData);
      return { 
        success: false, 
        error: initialGenData.error || "初始图像生成请求失败" 
      };
    }

    // 获取生成任务ID
    const initialGenerationId = initialGenData.sdGenerationJob?.generationId;
    
    if (!initialGenerationId) {
      logger.error('未获取到初始生成任务ID', initialGenData);
      return {
        success: false,
        error: "未能获取初始生成任务ID"
      };
    }

    logger.info('获取到初始生成任务ID', { generationId: initialGenerationId });

    // 等待初始图像生成完成
    logger.info('等待初始图像生成完成...');
    let initialImageId = await waitForGenerationCompletion(initialGenerationId);
    
    if (!initialImageId) {
      return {
        success: false,
        error: "初始图像生成失败或超时"
      };
    }
    
    logger.info('初始图像生成完成，获取到图像ID', { imageId: initialImageId });
    
    // 第二步：使用初始图像作为引导创建新的生成请求
    logger.info('创建引导式图像生成请求');
    
    const guidedGenerationPayload = {
      prompt: "[Chinese]宠物照片的精美增强版，保持原始特征但提升质量。这只宠物有着大而圆的富有表现力的眼睛，呈现快乐的微笑状态，嘴部微张并伸出舌头。姿势自然，毛发纹理清晰，颜色鲜明，特别是面部区域的毛发细节。[English]Enhanced version of the pet photo while maintaining original features but improving quality. This pet has large, round expressive eyes, appears happy with a smiling expression, slightly open mouth with tongue visible. Natural posture, clear fur texture with vibrant colors, especially detailed fur patterns in the facial area.",
      modelId,
      width: 512,
      height: 512,
      init_generation_image_id: initialImageId,
      init_strength: 0.5,
      num_images: 1,
      guidance_scale: 7,
      public: false,
      promptMagic: true
    };
    
    logger.debug('引导式生成请求配置', { 
      url: `${LEONARDO_API_BASE_URL}/generations`,
      bodySize: JSON.stringify(guidedGenerationPayload).length
    });

    const guidedGenerationResponse = await fetch(`${LEONARDO_API_BASE_URL}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify(guidedGenerationPayload)
    });

    // 解析响应JSON
    const guidedGenData = await guidedGenerationResponse.json();
    
    // 检查响应状态
    if (!guidedGenerationResponse.ok) {
      logger.error('引导式图像生成请求失败', guidedGenData);
      return { 
        success: false, 
        error: guidedGenData.error || "引导式图像生成请求失败" 
      };
    }

    // 获取生成任务ID
    const guidedGenerationId = guidedGenData.sdGenerationJob?.generationId;
    
    if (!guidedGenerationId) {
      logger.error('未获取到引导式生成任务ID', guidedGenData);
      return {
        success: false,
        error: "未能获取引导式生成任务ID"
      };
    }

    logger.info('获取到引导式生成任务ID', { generationId: guidedGenerationId });

    // 等待引导式图像生成并获取结果URL
    logger.info('等待引导式图像生成完成...');
    const result = await waitForGenerationResultUrl(guidedGenerationId);
    
    if (!result.success) {
      return result;
    }
    
    logger.info('引导式图像生成成功', { url: result.imageUrl?.substring(0, 50) + '...' });
    return result;
    
  } catch (error) {
    logger.error("Leonardo.ai图像处理出错", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "图像处理过程中发生未知错误" 
    };
  }
}

/**
 * 等待生成任务完成并返回图像URL
 * @param generationId 生成任务ID
 * @returns 包含成功状态和图像URL的对象
 */
async function waitForGenerationResultUrl(generationId: string): Promise<LeonardoResponse> {
  try {
    // 轮询间隔（毫秒）
    const POLL_INTERVAL = 3000;
    // 最大轮询次数
    const MAX_POLLS = 40; // 2分钟后超时
    
    let pollCount = 0;
    
    while (pollCount < MAX_POLLS) {
      pollCount++;
      
      // 获取生成状态
      const response = await fetch(`${LEONARDO_API_BASE_URL}/generations/${generationId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${LEONARDO_API_KEY}`
        }
      });
      
      if (!response.ok) {
        logger.error('获取生成状态失败', { status: response.status });
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }
      
      const data = await response.json();
      
      // 检查生成状态
      if (data.generations_by_pk) {
        const status = data.generations_by_pk.status;
        logger.debug('生成状态', { status, pollCount });
        
        if (status === 'COMPLETE') {
          // 获取生成的图像URL
          const generatedImageUrl = data.generations_by_pk.generated_images?.[0]?.url;
          
          if (generatedImageUrl) {
            logger.info('生成完成，获取到图像URL', { generatedImageUrl });
            return {
              success: true,
              imageUrl: generatedImageUrl
            };
          } else {
            logger.error('生成完成但未找到图像URL');
            return {
              success: false,
              error: "生成完成但未找到图像URL"
            };
          }
        } else if (status === 'FAILED') {
          logger.error('生成失败', data.generations_by_pk);
          return {
            success: false,
            error: "生成失败"
          };
        }
      }
      
      // 等待下一次轮询
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    
    logger.error('等待生成超时');
    return {
      success: false,
      error: "等待生成超时"
    };
    
  } catch (error) {
    logger.error('等待生成过程中出错', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "等待生成过程中发生未知错误"
    };
  }
}

/**
 * 根据处理选项ID获取对应的模型ID
 */
export function getModelIdForOption(processingOptionId: string): string {
  // 映射处理选项到实际的Leonardo模型ID
  const modelMapping: Record<string, string> = {
    'albedo': MODEL_IDS.ALBEDO_BASE_XL,
    'anime': MODEL_IDS.ANIME_XL
  };
  
  return modelMapping[processingOptionId] || MODEL_IDS.ANIME_XL; // 默认返回 Leonardo Anime XL 模型
}

/**
 * 从DataURL中提取Base64数据
 * @param dataUrl 图片的DataURL
 * @returns 仅包含Base64数据的字符串
 */
export function extractBase64FromDataUrl(dataUrl: string): string {
  if (!dataUrl) return "";
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : dataUrl;
}

/**
 * 使用高级功能处理图像（包括ControlNet和样式参考）
 * @param initialImageId 已有图像的ID或base64数据
 * @param processingOptionId 处理选项ID
 * @param advancedOptions 高级选项配置
 * @returns 包含处理结果的Promise对象
 */
export async function processImageWithAdvancedFeatures(
  initialImageId: string,
  processingOptionId: string,
  advancedOptions?: {
    prompt?: string;
    controlNets?: ControlNetConfig[];
    presetStyle?: 'CINEMATIC' | 'DYNAMIC' | 'RAW';
    photoReal?: boolean;
    photoRealVersion?: 'v1' | 'v2';
    alchemy?: boolean;
    width?: number;
    height?: number;
    initStrength?: number;
  }
): Promise<LeonardoResponse> {
  try {
    // 确保API密钥存在
    if (!LEONARDO_API_KEY) {
      logger.error('API密钥缺失');
      return { 
        success: false, 
        error: "Leonardo.ai API密钥缺失" 
      };
    }

    // 获取处理选项配置
    const option = getProcessingOptions().find(opt => opt.id === processingOptionId);
    
    if (!option) {
      logger.error('无效的处理选项ID', { processingOptionId });
      return {
        success: false,
        error: "无效的处理选项ID"
      };
    }
    
    // 使用选项中的modelId或通过映射函数获取
    const modelId = option.modelId || getModelIdForOption(processingOptionId);
    logger.debug('使用模型', { modelId, 处理选项: processingOptionId });
    
    // 计算适当的输出尺寸，保持原始比例
    let outputWidth = 512;  // 默认尺寸改为512
    let outputHeight = 512;  // 默认尺寸改为512

    // 设置最小尺寸限制
    const minDimension = 512;  // 最小边长设为512
    // 设置最大尺寸限制
    const maxDimension = 768;  // 最大边长保持为768

    // 添加初始日志
    logger.debug('开始计算输出尺寸', { 
      默认尺寸: `${outputWidth}x${outputHeight}`, 
      最小限制: minDimension,
      最大限制: maxDimension
    });

    if (advancedOptions?.width && advancedOptions.height) {
      // 记录原始尺寸
      logger.debug('原始图像尺寸', { 
        宽度: advancedOptions.width, 
        高度: advancedOptions.height 
      });
      
      // 使用用户指定的尺寸，但确保符合Leonardo.ai的要求
      const aspectRatio = advancedOptions.width / advancedOptions.height;
      logger.debug('计算宽高比', { 
        宽高比: aspectRatio, 
        是否宽图: aspectRatio >= 1 
      });
      
      // Leonardo.ai要求分辨率是8的倍数
      if (aspectRatio >= 1) {
        // 宽图 - 确保高度至少为minDimension
        outputHeight = Math.max(minDimension, Math.floor(minDimension / 8) * 8);
        // 根据宽高比计算宽度
        outputWidth = Math.floor(outputHeight * aspectRatio / 8) * 8;
        // 如果宽度超过最大限制，则缩小
        if (outputWidth > maxDimension) {
          outputWidth = Math.floor(maxDimension / 8) * 8;
          // 重新计算高度以保持宽高比
          outputHeight = Math.floor(outputWidth / aspectRatio / 8) * 8;
          // 确保高度不低于最小限制
          if (outputHeight < minDimension) {
            outputHeight = Math.floor(minDimension / 8) * 8;
            // 此时宽高比可能会有轻微变化
          }
        }
        
        logger.debug('宽图尺寸计算', { 
          原始宽高比: aspectRatio,
          计算后宽度: outputWidth,
          计算后高度: outputHeight,
          计算后宽高比: (outputWidth / outputHeight).toFixed(2)
        });
      } else {
        // 高图 - 确保宽度至少为minDimension
        outputWidth = Math.max(minDimension, Math.floor(minDimension / 8) * 8);
        // 根据宽高比计算高度
        outputHeight = Math.floor(outputWidth / aspectRatio / 8) * 8;
        // 如果高度超过最大限制，则缩小
        if (outputHeight > maxDimension) {
          outputHeight = Math.floor(maxDimension / 8) * 8;
          // 重新计算宽度以保持宽高比
          outputWidth = Math.floor(outputHeight * aspectRatio / 8) * 8;
          // 确保宽度不低于最小限制
          if (outputWidth < minDimension) {
            outputWidth = Math.floor(minDimension / 8) * 8;
            // 此时宽高比可能会有轻微变化
          }
        }
        
        logger.debug('高图尺寸计算', { 
          原始宽高比: aspectRatio,
          计算后宽度: outputWidth,
          计算后高度: outputHeight,
          计算后宽高比: (outputWidth / outputHeight).toFixed(2)
        });
      }
      
      // 确保总像素不超过限制
      const pixelCount = outputWidth * outputHeight;
      const pixelLimit = 589824; // 768×768
      
      logger.debug('检查像素总数', { 
        当前像素数: pixelCount, 
        像素限制: pixelLimit, 
        是否超出: pixelCount > pixelLimit 
      });
      
      if (pixelCount > pixelLimit) {
        // 记录调整前的尺寸
        logger.debug('像素数超出限制，开始缩小', { 
          调整前: `${outputWidth}x${outputHeight}` 
        });
        
        // 计算缩放因子
        const scaleFactor = Math.sqrt(pixelLimit / pixelCount);
        
        // 按比例缩小两个维度
        outputWidth = Math.floor(outputWidth * scaleFactor / 8) * 8;
        outputHeight = Math.floor(outputHeight * scaleFactor / 8) * 8;
        
        // 确保最小边长仍然是minDimension
        if (outputWidth < minDimension) {
          outputWidth = Math.floor(minDimension / 8) * 8;
        }
        if (outputHeight < minDimension) {
          outputHeight = Math.floor(minDimension / 8) * 8;
        }
        
        logger.debug('按比例缩小后', { 
          缩放因子: scaleFactor.toFixed(2),
          调整后: `${outputWidth}x${outputHeight}`,
          像素数: outputWidth * outputHeight
        });
      }
      
      // 最终尺寸日志
      logger.info('最终计算的输出尺寸', { 
        原始: `${advancedOptions.width}x${advancedOptions.height}`, 
        调整后: `${outputWidth}x${outputHeight}`,
        原始宽高比: aspectRatio.toFixed(2),
        调整后宽高比: (outputWidth / outputHeight).toFixed(2)
      });
    }
    
    // 获取Cute Emotes元素
    const cuteEmotesElement = getElementById(process.env.NEXT_PUBLIC_LEONARDO_ELEMENT_CUTE_EMOTES || "01b6184e-3905-4dc7-9ec6-4f09982536d5");
    
    // 生成请求配置
    const generationPayload: any = {
      height: outputHeight,
      width: outputWidth,
      modelId,
      prompt: advancedOptions?.prompt || 
        "[Chinese]宠物照片的精美增强版，保持原始特征但提升质量。这只宠物有着大而圆的富有表现力的眼睛，呈现快乐的微笑状态，嘴部微张并伸出舌头。姿势自然，毛发纹理清晰，颜色鲜明，特别是面部区域的毛发细节。[English]Enhanced version of the pet photo while maintaining original features but improving quality. This pet has large, round expressive eyes, appears happy with a smiling expression, slightly open mouth with tongue visible. Natural posture, clear fur texture with vibrant colors, especially detailed fur patterns in the facial area.",
      presetStyle: advancedOptions?.presetStyle || "ANIME",
      alchemy: advancedOptions?.alchemy ?? true,
      photoReal: advancedOptions?.photoReal ?? false,
      photoRealVersion: advancedOptions?.photoRealVersion || null,
      highResolution: false,  // 明确关闭高分辨率功能
      // 图像到图像参数
      init_image_id: initialImageId,
      init_strength: advancedOptions?.initStrength || 0.9,
      num_images: 1,
      promptMagic: false  // 确保这里也设置为false
    };
    
    // 记录最终使用的尺寸
    logger.info('生成请求使用的尺寸', { 
      宽度: generationPayload.width, 
      高度: generationPayload.height 
    });
    
    // 添加ControlNet配置（如果支持且提供）
    if (option.supportsControlNet && advancedOptions?.controlNets?.length) {
      generationPayload.controlnets = advancedOptions.controlNets;
    }
    
    logger.debug('高级生成请求配置', { 
      url: `${LEONARDO_API_BASE_URL}/generations`,
      bodySize: JSON.stringify(generationPayload).length
    });

    // 发送生成请求
    const generationResponse = await fetch(`${LEONARDO_API_BASE_URL}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify(generationPayload)
    });

    // 解析响应JSON
    const generationData = await generationResponse.json();
    
    // 检查响应状态
    if (!generationResponse.ok) {
      logger.error('高级图像生成请求失败', generationData);
      return { 
        success: false, 
        error: generationData.error || "高级图像生成请求失败" 
      };
    }

    // 获取生成任务ID
    const generationId = generationData.sdGenerationJob?.generationId;
    
    if (!generationId) {
      logger.error('未获取到生成任务ID', generationData);
      return {
        success: false,
        error: "未能获取生成任务ID"
      };
    }

    logger.info('获取到生成任务ID', { generationId });

    // 等待图像生成并获取结果URL
    logger.info('等待图像生成完成...');
    const result = await waitForGenerationResultUrl(generationId);
    
    return result;
    
  } catch (error) {
    logger.error("高级图像处理出错", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "图像处理过程中发生未知错误" 
    };
  }
}

/**
 * 从base64图像数据创建初始图像生成
 * @param imageBase64 Base64格式的图片数据
 * @param processingOptionId 处理选项ID
 * @returns 生成的图像ID
 */
async function createInitialImageFromBase64(
  imageBase64: string,
  processingOptionId: string
): Promise<string | null> {
  try {
    // 从DataURL中提取纯base64数据
    const base64Data = imageBase64.startsWith('data:') 
      ? extractBase64FromDataUrl(imageBase64)
      : imageBase64;
    
    // 获取当前处理选项的模型ID
    const modelId = getModelIdForOption(processingOptionId);
    
    // 创建初始图像生成请求
    const initialGenerationPayload = {
      prompt: "[Chinese]高质量宠物照片，展示宠物的自然特征[English]High quality pet photo showing the natural characteristics of the pet",
      modelId,
      width: 512,
      height: 512,
      num_images: 1,  // 确保只生成1张图片
      public: false
    };
    
    // 发送初始生成请求
    const initialGenResponse = await fetch(`${LEONARDO_API_BASE_URL}/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
      body: JSON.stringify(initialGenerationPayload)
    });
    
    // 解析响应
    const initialGenData = await initialGenResponse.json();
    
    if (!initialGenResponse.ok) {
      logger.error('初始图像生成请求失败', initialGenData);
      return null;
    }
    
    // 获取生成任务ID
    const initialGenId = initialGenData.sdGenerationJob?.generationId;
    
    if (!initialGenId) {
      logger.error('未获取到初始生成任务ID', initialGenData);
      return null;
    }
    
    // 等待初始图像生成完成并获取ID
    return await waitForGenerationCompletion(initialGenId);
    
  } catch (error) {
    logger.error('创建初始图像生成失败', error);
    return null;
  }
}

/**
 * 使用模拟Python示例的方式生成图像
 * @param imageBase64 初始图像的Base64数据
 * @param options 生成选项
 */
export async function generateImageWithPythonMethod(
  imageBase64: string,
  options: {
    prompt?: string;
    width?: number;
    height?: number;
    modelId?: string;
  } = {}
): Promise<LeonardoResponse> {
  try {
    logger.info('使用Python示例方法生成图像');
    
    // 1. 获取上传ID - 注意：我们只获取ID，不实际上传
    // 因为浏览器中的CORS限制，实际上传需要在服务器端完成
    const payload = { extension: "jpg" };
    
    const initResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/init-image`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
        body: JSON.stringify(payload)
      }
    );
    
    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      logger.error('获取上传ID失败', { status: initResponse.status, 响应: errorText });
      return { success: false, error: "获取上传ID失败" };
    }
    
    const initData = await initResponse.json();
    const uploadedImageId = initData.uploadInitImage?.id;
    
    if (!uploadedImageId) {
      logger.error('未获取到上传ID', initData);
      return { success: false, error: "未获取到上传ID" };
    }
    
    logger.info('成功获取上传ID', { uploadedImageId });
    
    // 2. 跳过真实上传步骤，直接生成图像
    // 在真实情况下，这里应该有服务器端代码处理上传
    
    // 3. 创建生成任务
    const genPayload = {
      height: options.height || 768,
      width: options.width || 1024,
      modelId: options.modelId || MODEL_IDS.KINO_XL, // Leonardo Kino XL
      prompt: options.prompt || "red light streak gradient",
      num_images: 1,
      alchemy: true
    };
    
    const genResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/generations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LEONARDO_API_KEY}`
        },
        body: JSON.stringify(genPayload)
      }
    );
    
    if (!genResponse.ok) {
      const errorText = await genResponse.text();
      logger.error('创建生成任务失败', { status: genResponse.status, 响应: errorText });
      return { success: false, error: "创建生成任务失败" };
    }
    
    const genData = await genResponse.json();
    const generationId = genData.sdGenerationJob?.generationId;
    
    if (!generationId) {
      logger.error('未获取到生成任务ID', genData);
      return { success: false, error: "未获取到生成任务ID" };
    }
    
    logger.info('成功创建生成任务', { generationId });
    
    // 4. 等待生成完成并获取结果URL
    return await waitForGenerationResultUrl(generationId);
  } catch (error) {
    logger.error('使用Python示例方法生成图像过程中出错', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "生成过程中发生未知错误"
    };
  }
}

/**
 * 预设配置接口
 */
export interface LeonardoPreset {
  id: string;
  name: string;
  description: string;
  modelId: string;
  modelName: string;
  style?: string;
  styleReference?: {
    imageId?: string;
    strength: 'Low' | 'Mid' | 'High' | 'Ultra' | 'Max';
  };
  initStrength: number;
  width: number;
  height: number;
  aspectRatio: '1:1' | '16:9' | '2:3' | 'custom';
  contrast?: 'Low' | 'Medium' | 'High';
  generationMode: 'Fast' | 'Quality';
  numImages: number;
  privateMode: boolean;
  promptTemplate?: string;
  presetStyle?: 'CINEMATIC' | 'DYNAMIC' | 'RAW';
  photoReal?: boolean;
  photoRealVersion?: 'v1' | 'v2';
  alchemy?: boolean;
}

/**
 * 获取可用预设列表
 */
export function getAvailablePresets(): LeonardoPreset[] {
  return [
    {
      id: 'cartoon-sketch',
      name: '卡通速涂',
      description: '将图片转换为卡通风格的速涂效果',
      modelId: MODEL_IDS.ALBEDO_BASE_XL,
      modelName: 'AlbedoBase XL',
      style: 'Anime General',
      contrast: 'Medium',
      generationMode: 'Quality',
      initStrength: 0.85,  // 统一使用 0.85
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      numImages: 4,
      privateMode: false,
      styleReference: {
        strength: 'Max'
      },
      alchemy: true
    }
  ];
}

/**
 * 根据预设ID获取预设配置
 * @param presetId 预设ID
 * @returns 预设配置或undefined
 */
export function getPresetById(presetId: string): LeonardoPreset | undefined {
  return getAvailablePresets().find(preset => preset.id === presetId);
}

/**
 * Leonardo 元素定义
 */
export interface LeonardoElement {
  akUUID: string;
  name: string;
  description: string;
  weight: number;
  minWeight?: number;
  maxWeight?: number;
  compatible?: {
    sdVersions: string[];
    models?: string[];
  };
}

/**
 * 可用的 Leonardo 元素列表
 */
export function getAvailableElements(): LeonardoElement[] {
  return [
    {
      akUUID: "01b6184e-3905-4dc7-9ec6-4f09982536d5",
      name: "Cute Emotes",
      description: "添加可爱的表情元素到图像中",
      weight: 0.5,
      minWeight: 0.1,
      maxWeight: 2.0,
      compatible: {
        sdVersions: ["v1_5", "SDXL"],
        models: [
          MODEL_IDS.ANIME_XL  // Leonardo Anime XL
        ]
      }
    }
  ];
}

/**
 * 根据元素ID获取元素
 */
export function getElementById(elementId: string): LeonardoElement | undefined {
  return getAvailableElements().find(element => element.akUUID === elementId);
}

/**
 * 使用图像到图像方式处理图像，同时添加风格ControlNet
 * @param imageBase64 用户图像的Base64数据
 * @param styleImagePath 固定风格参考图片的路径
 * @param prompt 自定义提示词
 * @param dimensions 可选的输出尺寸参数
 * @param selectedElements 选定的元素数组
 * @param useFastMode 是否使用快速模式
 * @returns 处理结果
 */
export async function processWithImageToImageAndStyle(
  userImageBase64: string,
  styleImagePath: string,
  prompt: string = "",
  dimensions: { width: number, height: number } | null = null,
  selectedElements?: Array<{elementId: string, weight: number}>,
  useFastMode: boolean = true  // 修改默认值为true，启用快速模式
): Promise<LeonardoResponse> {
  try {
    logger.info('开始图像到图像处理（带风格参考）', { 快速模式: useFastMode });
    
    // 上传用户图像
    const userImageId = await uploadImage(userImageBase64);
    if (!userImageId) {
      return {
        success: false,
        error: "上传用户图像失败"
      };
    }
    
    logger.info('用户图像上传成功', { userImageId });
    
    // 上传风格参考图片（从公共目录加载）
    let styleImageId = null;
    try {
      // 尝试加载风格参考图片
      const styleImageResponse = await fetch(styleImagePath);
      logger.info('风格图片加载状态', { 
        path: styleImagePath,
        status: styleImageResponse.status,
        success: styleImageResponse.ok
      });
      if (!styleImageResponse.ok) {
        logger.warn(`无法加载风格图片: ${styleImageResponse.status}，将继续处理没有风格参考的图像`);
        // 继续处理，不抛出错误
      } else {
        const styleImageBlob = await styleImageResponse.blob();
        const styleImageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(styleImageBlob);
        });
        
        // 上传风格图片
        styleImageId = await uploadImage(styleImageBase64);
        if (!styleImageId) {
          logger.warn('上传风格图片失败，将只使用图像到图像处理');
        } else {
          logger.info('风格图片上传成功', { styleImageId });
        }
      }
    } catch (styleError) {
      logger.warn('加载风格图片失败，将继续无风格参考处理', styleError);
      // 继续处理，不需要风格参考
    }
    
    // 计算适当的输出尺寸，保持原始比例
    let outputWidth = 512;  // 默认尺寸改为512
    let outputHeight = 512;  // 默认尺寸改为512

    // 设置最小尺寸限制
    const minDimension = 512;  // 最小边长设为512
    // 设置最大尺寸限制
    const maxDimension = 768;  // 最大边长保持为768

    // 添加初始日志
    logger.debug('开始计算输出尺寸', { 
      默认尺寸: `${outputWidth}x${outputHeight}`, 
      最小限制: minDimension,
      最大限制: maxDimension
    });

    if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
      // 记录原始尺寸
      logger.debug('原始图像尺寸', { 
        宽度: dimensions.width, 
        高度: dimensions.height 
      });
      
      // 使用用户指定的尺寸，但确保符合Leonardo.ai的要求
      const aspectRatio = dimensions.width / dimensions.height;
      logger.debug('计算宽高比', { 
        宽高比: aspectRatio, 
        是否宽图: aspectRatio >= 1 
      });
      
      // Leonardo.ai要求分辨率是8的倍数
      if (aspectRatio >= 1) {
        // 宽图 - 确保高度至少为minDimension
        outputHeight = Math.max(minDimension, Math.floor(minDimension / 8) * 8);
        // 根据宽高比计算宽度
        outputWidth = Math.floor(outputHeight * aspectRatio / 8) * 8;
        // 如果宽度超过最大限制，则缩小
        if (outputWidth > maxDimension) {
          outputWidth = Math.floor(maxDimension / 8) * 8;
          // 重新计算高度以保持宽高比
          outputHeight = Math.floor(outputWidth / aspectRatio / 8) * 8;
          // 确保高度不低于最小限制
          if (outputHeight < minDimension) {
            outputHeight = Math.floor(minDimension / 8) * 8;
            // 此时宽高比可能会有轻微变化
          }
        }
        
        logger.debug('宽图尺寸计算', { 
          原始宽高比: aspectRatio,
          计算后宽度: outputWidth,
          计算后高度: outputHeight,
          计算后宽高比: (outputWidth / outputHeight).toFixed(2)
        });
      } else {
        // 高图 - 确保宽度至少为minDimension
        outputWidth = Math.max(minDimension, Math.floor(minDimension / 8) * 8);
        // 根据宽高比计算高度
        outputHeight = Math.floor(outputWidth / aspectRatio / 8) * 8;
        // 如果高度超过最大限制，则缩小
        if (outputHeight > maxDimension) {
          outputHeight = Math.floor(maxDimension / 8) * 8;
          // 重新计算宽度以保持宽高比
          outputWidth = Math.floor(outputHeight * aspectRatio / 8) * 8;
          // 确保宽度不低于最小限制
          if (outputWidth < minDimension) {
            outputWidth = Math.floor(minDimension / 8) * 8;
            // 此时宽高比可能会有轻微变化
          }
        }
        
        logger.debug('高图尺寸计算', { 
          原始宽高比: aspectRatio,
          计算后宽度: outputWidth,
          计算后高度: outputHeight,
          计算后宽高比: (outputWidth / outputHeight).toFixed(2)
        });
      }
      
      // 确保总像素不超过限制
      const pixelCount = outputWidth * outputHeight;
      const pixelLimit = 589824; // 768×768
      
      logger.debug('检查像素总数', { 
        当前像素数: pixelCount, 
        像素限制: pixelLimit, 
        是否超出: pixelCount > pixelLimit 
      });
      
      if (pixelCount > pixelLimit) {
        // 记录调整前的尺寸
        logger.debug('像素数超出限制，开始缩小', { 
          调整前: `${outputWidth}x${outputHeight}` 
        });
        
        // 计算缩放因子
        const scaleFactor = Math.sqrt(pixelLimit / pixelCount);
        
        // 按比例缩小两个维度
        outputWidth = Math.floor(outputWidth * scaleFactor / 8) * 8;
        outputHeight = Math.floor(outputHeight * scaleFactor / 8) * 8;
        
        // 确保最小边长仍然是minDimension
        if (outputWidth < minDimension) {
          outputWidth = Math.floor(minDimension / 8) * 8;
        }
        if (outputHeight < minDimension) {
          outputHeight = Math.floor(minDimension / 8) * 8;
        }
        
        logger.debug('按比例缩小后', { 
          缩放因子: scaleFactor.toFixed(2),
          调整后: `${outputWidth}x${outputHeight}`,
          像素数: outputWidth * outputHeight
        });
      }
      
      // 最终尺寸日志
      logger.info('最终计算的输出尺寸', { 
        原始: `${dimensions.width}x${dimensions.height}`, 
        调整后: `${outputWidth}x${outputHeight}`,
        原始宽高比: aspectRatio.toFixed(2),
        调整后宽高比: (outputWidth / outputHeight).toFixed(2)
      });
    }
    
    // 获取Cute Emotes元素
    const cuteEmotesElement = getElementById(process.env.NEXT_PUBLIC_LEONARDO_ELEMENT_CUTE_EMOTES || "01b6184e-3905-4dc7-9ec6-4f09982536d5");
    
    // 在生成请求配置中
    const defaultStylePrompt = process.env.NEXT_PUBLIC_LEONARDO_DEFAULT_STYLE_PROMPT || "Transform the pet photo...";
    const defaultGenerationPrompt = process.env.NEXT_PUBLIC_LEONARDO_DEFAULT_GENERATION_PROMPT || "A mesmerizing pet portrait with artistic style";

    // 生成请求配置
    const genPayload: any = {
      height: outputHeight,
      width: outputWidth,
      modelId: MODEL_IDS.ALBEDO_BASE_XL,
      // 合并用户提供的提示词和默认风格提示词
      prompt: prompt 
        ? `${prompt}. ${defaultStylePrompt}` 
        : defaultStylePrompt,
      presetStyle: "ANIME",
      alchemy: true,
      photoReal: false,
      photoRealVersion: null,
      highResolution: false,
      init_image_id: userImageId,
      init_strength: 0.85,  // 统一使用 0.85
      num_images: 1,
      promptMagic: false
    };
    
    // 如果使用快速模式，调整参数
    if (useFastMode) {
      // 快速模式参数调整
      genPayload.num_inference_steps = 30;
      genPayload.guidance_scale = 18;
      genPayload.promptMagic = false;
      genPayload.init_strength = 0.88;  // 快速模式使用 0.88
      logger.info('启用快速模式，调整生成参数');
    } else {
      // 高质量模式参数
      genPayload.num_inference_steps = 50;
      genPayload.guidance_scale = 15;
      genPayload.promptMagic = false;
      genPayload.init_strength = 0.85;  // 高质量模式使用 0.85
      logger.info('使用高质量模式');
    }
    
    // 安全地添加选定的元素
    if (selectedElements && selectedElements.length > 0) {
      safelyAddElements(genPayload, selectedElements, genPayload.modelId, true);
    }
    
    // 如果成功上传了风格图片，添加ControlNet风格参考
    if (styleImageId) {
      genPayload.controlnets = [
        {
          initImageId: styleImageId,
          initImageType: "UPLOADED",
          preprocessorId: ControlNetType.SDXL.STYLE_REFERENCE,  // 风格参考ID
          strengthType: "Max"  // 从"High"改为"Max"，最大强度应用风格
        }
      ];
      logger.info('添加了风格参考ControlNet，强度设为最大');
    }
    
    // 发送生成请求
    const genResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/generations`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
        body: JSON.stringify(genPayload)
      }
    );
    
    if (!genResponse.ok) {
      const errorData = await genResponse.json();
      logger.error('创建生成任务失败', errorData);
      return {
        success: false,
        error: "创建生成任务失败"
      };
    }
    
    const genData = await genResponse.json();
    const generationId = genData.sdGenerationJob?.generationId;
    
    if (!generationId) {
      logger.error('未获取到生成ID', genData);
      return {
        success: false,
        error: "未获取到生成ID"
      };
    }
    
    logger.info('生成任务创建成功', { generationId });
    
    // 等待生成完成并获取URL
    return await waitForGenerationResultUrl(generationId);
    
  } catch (error) {
    logger.error('图像处理过程中出错', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "图像处理过程中发生未知错误"
    };
  }
}

/**
 * 获取内置的卡通风格参考图像
 * @returns Base64编码的图像数据
 */
function getBuiltInReferenceImage(): string {
  // 这是一个卡通风格的参考图像Base64编码
  // 实际应用中应该使用真实的卡通风格图像
  return 'data:image/jpeg;base64,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';
}

// ControlNet预处理器ID常量定义
export const ControlNetType = {
  SDXL: {
    STYLE_REFERENCE: Number(process.env.NEXT_PUBLIC_LEONARDO_CONTROLNET_STYLE_REFERENCE) || 67,
    CHARACTER_REFERENCE: Number(process.env.NEXT_PUBLIC_LEONARDO_CONTROLNET_CHARACTER_REFERENCE) || 133
  }
};

/**
 * 创建样式参考ControlNet配置
 * @param imageId 参考图像ID
 * @param imageType 图像类型 (GENERATED/UPLOADED)
 * @param strengthType 强度类型 (Low/Mid/High/Ultra/Max)
 * @param influence 影响力 (0-1范围内的数值)
 * @returns ControlNet配置对象
 */
export function createStyleReference(
  imageId: string,
  imageType: 'GENERATED' | 'UPLOADED',
  strengthType: 'Low' | 'Mid' | 'High' | 'Ultra' | 'Max' = 'High',
  influence?: number
): ControlNetConfig {
  return {
    initImageId: imageId,
    initImageType: imageType,
    preprocessorId: ControlNetType.SDXL.STYLE_REFERENCE,
    strengthType,
    ...(influence !== undefined && { influence })
  };
}

/**
 * 创建角色参考ControlNet配置
 * @param imageId 参考图像ID
 * @param imageType 图像类型 (GENERATED/UPLOADED)
 * @param strengthType 强度类型 (Low/Mid/High)
 * @returns ControlNet配置对象
 */
export function createCharacterReference(
  imageId: string,
  imageType: 'GENERATED' | 'UPLOADED',
  strengthType: 'Low' | 'Mid' | 'High' = 'Mid'
): ControlNetConfig {
  return {
    initImageId: imageId,
    initImageType: imageType,
    preprocessorId: ControlNetType.SDXL.CHARACTER_REFERENCE,
    strengthType
  };
}

/**
 * 使用多重 ControlNet 生成图像
 * @param uploadedImage 要上传的图片数据（Base64）
 * @param options 生成选项
 */
export async function generateWithMultipleControlNets(
  uploadedImage: string,
  options: {
    width?: number;
    height?: number;
    prompt?: string;
    modelId?: string;
    presetStyle?: 'CINEMATIC' | 'DYNAMIC' | 'RAW';
    photoReal?: boolean;
    photoRealVersion?: 'v1' | 'v2';
    alchemy?: boolean;
  } = {}
): Promise<LeonardoResponse> {
  try {
    logger.info('开始多重 ControlNet 图像生成');

    // 1. 上传初始图像
    const uploadedImageId = await uploadImage(uploadedImage);
    if (!uploadedImageId) {
      return {
        success: false,
        error: "上传图像失败"
      };
    }
    logger.info('图像上传成功', { uploadedImageId });

    // 2. 生成样式参考图像
    const styleGenPayload = {
      height: 768,
      width: 1024,
      modelId: options.modelId || MODEL_IDS.KINO_XL, // Leonardo Kino XL
      prompt: "red light streak gradient",
      num_images: 1,
      alchemy: true
    };

    const styleGenResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/generations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LEONARDO_API_KEY}`
        },
        body: JSON.stringify(styleGenPayload)
      }
    );

    const styleGenData = await styleGenResponse.json();
    if (!styleGenResponse.ok || !styleGenData.sdGenerationJob?.generationId) {
      logger.error('样式参考图像生成失败', styleGenData);
      return {
        success: false,
        error: "样式参考图像生成失败"
      };
    }

    // 等待样式参考图像生成完成
    const styleImageId = await waitForGenerationCompletion(
      styleGenData.sdGenerationJob.generationId
    );
    if (!styleImageId) {
      return {
        success: false,
        error: "样式参考图像生成失败或超时"
      };
    }
    logger.info('样式参考图像生成完成', { styleImageId });

    // 3. 使用多重 ControlNet 生成最终图像
    const finalGenPayload = {
      height: options.height || defaultConfig.height,
      width: options.width || defaultConfig.width,
      modelId: options.modelId || MODEL_IDS.KINO_XL,
      prompt: options.prompt || "A mesmerizing pet portrait with artistic style",
      presetStyle: options.presetStyle || "CINEMATIC",
      photoReal: options.photoReal ?? true,
      photoRealVersion: options.photoRealVersion || "v2",
      alchemy: options.alchemy ?? true,
      controlnets: [
        {
          initImageId: uploadedImageId,
          initImageType: "UPLOADED",
          preprocessorId: ControlNetType.SDXL.CHARACTER_REFERENCE,
          strengthType: "Mid"
        },
        {
          initImageId: styleImageId,
          initImageType: "GENERATED",
          preprocessorId: ControlNetType.SDXL.STYLE_REFERENCE,
          strengthType: "Max"
        }
      ],
      promptStrength: Number(process.env.NEXT_PUBLIC_LEONARDO_PROMPT_STRENGTH) || 0.85,
      guidanceScale: genConfig.guidanceScaleQuality
    };

    const finalGenResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/generations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LEONARDO_API_KEY}`
        },
        body: JSON.stringify(finalGenPayload)
      }
    );

    const finalGenData = await finalGenResponse.json();
    if (!finalGenResponse.ok || !finalGenData.sdGenerationJob?.generationId) {
      logger.error('最终图像生成失败', finalGenData);
    return {
      success: false,
        error: "最终图像生成失败"
      };
    }

    // 等待最终图像生成完成并获取URL
    logger.info('等待最终图像生成完成...');
    return await waitForGenerationResultUrl(finalGenData.sdGenerationJob.generationId);

  } catch (error) {
    logger.error('多重 ControlNet 图像生成过程出错', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "图像生成过程中发生未知错误"
    };
  }
}

/**
 * 上传图像到Leonardo.ai平台（使用预签名URL方法 - XMLHttpRequest版）
 * @param imageBase64 Base64格式的图像数据
 * @returns 上传后的图像ID
 */
export async function uploadImage(imageBase64: string): Promise<string | null> {
  try {
    if (!imageBase64) {
      logger.error('图像数据为空');
      return null;
    }
    
    // 从DataURL中提取纯base64数据和MIME类型
    let mimeType = 'image/png';
    let extension = 'png';
    let imageBlob;
    
    // 添加更多日志，帮助调试
    logger.debug('处理图像数据', { 
      isDataUrl: imageBase64.startsWith('data:'), 
      length: imageBase64.length 
    });
    
    if (imageBase64.startsWith('data:')) {
      try {
        // 更简单的方法：直接使用fetch API创建blob
        const res = await fetch(imageBase64);
        imageBlob = await res.blob();
        
        // 检查MIME类型并设置扩展名
        mimeType = imageBlob.type;
        if (mimeType === 'image/jpeg') {
          extension = 'jpg';
        } else if (mimeType === 'image/png') {
          extension = 'png';
        }
        
        logger.debug('成功从dataURL创建Blob', { 
          type: mimeType, 
          size: imageBlob.size 
        });
      } catch (blobError) {
        logger.error('从dataURL创建Blob失败', blobError);
        
        // 回退方法：尝试手动解析
        try {
          const parts = imageBase64.split(',');
          if (parts.length === 2) {
            const mime = parts[0].match(/:(.*?);/);
            if (mime && mime[1]) {
              mimeType = mime[1];
              if (mimeType === 'image/jpeg') extension = 'jpg';
            }
            
            const base64 = parts[1];
            const byteCharacters = atob(base64);
            
            // 创建一个Uint8Array
            const byteArray = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteArray[i] = byteCharacters.charCodeAt(i);
            }
            
            imageBlob = new Blob([byteArray], { type: mimeType });
            logger.debug('使用回退方法创建Blob成功', { size: imageBlob.size });
          }
        } catch (fallbackError) {
          logger.error('回退方法创建Blob也失败', fallbackError);
        }
      }
    } else {
      // 尝试处理纯base64字符串
      try {
        const byteCharacters = atob(imageBase64);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArray[i] = byteCharacters.charCodeAt(i);
        }
        imageBlob = new Blob([byteArray], { type: mimeType });
        logger.debug('从纯base64创建Blob成功', { size: imageBlob.size });
      } catch (pureBase64Error) {
        logger.error('从纯base64创建Blob失败', pureBase64Error);
      }
    }
    
    if (!imageBlob || imageBlob.size === 0) {
      logger.error('无法创建有效的Blob对象或Blob大小为0');
      return null;
    }
    
    logger.debug('准备上传画布图像', {
      大小: Math.round(imageBlob.size / 1024) + 'KB',
      类型: mimeType,
      扩展名: extension
    });
    
    // 1. 获取预签名URL
    const initResponse = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/init-image`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LEONARDO_API_KEY}`
      },
        body: JSON.stringify({
          extension: extension
        })
      }
    );
    
    if (!initResponse.ok) {
      logger.error('获取预签名URL失败', { status: initResponse.status });
      return null;
    }
    
    const initData = await initResponse.json();
    const uploadId = initData.uploadInitImage?.id;
    const uploadUrl = initData.uploadInitImage?.url;
    const fieldsString = initData.uploadInitImage?.fields;
    
    if (!uploadId || !uploadUrl || !fieldsString) {
      logger.error('未获取到完整的上传信息', initData);
      return null;
    }
    
    // 2. 使用预签名URL上传图像 - 使用XMLHttpRequest代替fetch
    try {
      // 解析字段
      const fields = JSON.parse(fieldsString);
      
      // 创建FormData对象
      const formData = new FormData();
      
      // 添加所有字段
      Object.entries({ ...fields, file: imageBlob }).forEach(([key, value]) => {
        formData.append(key, value as any);
      });
      
      // 使用XMLHttpRequest上传
      logger.debug('开始使用XMLHttpRequest上传到S3', { url: uploadUrl });
      
      // 创建一个Promise包装的XMLHttpRequest
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              logger.info('S3上传成功', { status: xhr.status });
              resolve();
            } else {
              logger.warn('S3上传响应状态码非200', { 
                status: xhr.status,
                statusText: xhr.statusText
              });
              // 即使上传可能有问题，我们也解析Promise以继续流程
              resolve();
            }
          }
        };
        
        xhr.onerror = function(e) {
          logger.error('S3上传XMLHttpRequest错误', { error: e });
          // 即使出错，也解析Promise以继续流程
          resolve();
        };
        
        // 打开连接并发送数据
        xhr.open('POST', uploadUrl, true);
        xhr.send(formData);
      });
      
      logger.info('S3上传流程完成');
      return uploadId;
    } catch (uploadError) {
      logger.error('S3上传过程出错', uploadError);
      // 尽管上传可能失败，我们仍然返回uploadId，让后续流程继续
      return uploadId;
    }
  } catch (error) {
    logger.error('上传画布图像过程中出错', error);
    return null;
  }
}

/**
 * 从Leonardo API获取所有可用元素
 * @returns 所有可用元素列表
 */
export async function fetchLeonardoElements(): Promise<LeonardoElement[]> {
  try {
    logger.info('开始获取Leonardo元素列表');
    
    const response = await fetchWithRetry(
      `${LEONARDO_API_BASE_URL}/elements`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${LEONARDO_API_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      logger.error('获取元素列表失败', { status: response.status });
      return getAvailableElements(); // 返回本地预定义元素作为后备
    }
    
    const data = await response.json();
    
    if (!data.elements || !Array.isArray(data.elements)) {
      logger.error('元素列表格式错误', data);
      return getAvailableElements();
    }
    
    // 将API返回的元素转换为我们的LeonardoElement格式
    const elements: LeonardoElement[] = data.elements.map((element: any) => ({
      akUUID: element.akUUID || element.id,
      name: element.name || '未命名元素',
      description: element.description || '',
      weight: element.defaultWeight || 0.5,
      minWeight: element.minWeight || 0.1,
      maxWeight: element.maxWeight || 2.0,
      compatible: {
        sdVersions: element.baseModels || ["v1_5", "SDXL"],
        models: element.compatibleModels || []
      }
    }));
    
    logger.info(`成功获取${elements.length}个Leonardo元素`);
    return elements;
  } catch (error) {
    logger.error('获取Leonardo元素列表出错', error);
    return getAvailableElements(); // 出错时返回本地元素列表
  }
}

/**
 * 安全地添加元素到生成请求中
 * @param payload 生成请求配置
 * @param elements 要添加的元素数组
 * @param modelId 当前使用的模型ID
 * @param isLeonardoProcess 是否是processImageWithLeonardo函数调用
 */
export function safelyAddElements(
  payload: any,
  elements: Array<{elementId: string, weight: number}>,
  modelId: string,
  isLeonardoProcess: boolean = false
): void {
  if (!elements || elements.length === 0) return;
  
  try {
    // 先获取元素详情
    const availableElements = getAvailableElements();
    const compatibleElements = [];
    
    for (const {elementId, weight} of elements) {
      const element = availableElements.find(e => e.akUUID === elementId);
      if (!element) continue;
      
      // 检查元素是否与当前模型兼容
      const isCompatible = !element.compatible?.models?.length || 
                         element.compatible.models.includes(modelId);
      
      if (isCompatible) {
        // 根据不同处理函数使用不同的权重范围
        const minWeight = isLeonardoProcess ? 0.75 : 0.5;
        const maxWeight = element.maxWeight || 1.5;
        
        // 计算每一步的大小（总范围除以50步）
        const stepSize = (maxWeight - minWeight) / 50;
        
        // 将权重值四舍五入到最接近的步进值
        const steps = Math.round((weight - minWeight) / stepSize);
        const normalizedWeight = Number((minWeight + (steps * stepSize)).toFixed(2));
        
        // 确保权重在有效范围内
        const safeWeight = Math.max(
          minWeight,
          Math.min(maxWeight, normalizedWeight)
        );
        
        compatibleElements.push({
          akUUID: element.akUUID,
          weight: safeWeight
        });
        
        logger.info(`添加元素: ${element.name}`, { 
          权重: safeWeight,
          步进值: stepSize.toFixed(4),
          步数: steps
        });
      } else {
        logger.warn(`元素不兼容当前模型: ${element.name}`);
      }
    }
    
    // 只有存在兼容元素时才添加到payload
    if (compatibleElements.length > 0) {
      payload.elements = compatibleElements;
    }
  } catch (error) {
    logger.error('添加元素时出错', error);
    // 出错时不添加元素，继续生成过程
  }
}

// 添加到环境变量中
const defaultConfig = {
  width: Number(process.env.NEXT_PUBLIC_LEONARDO_DEFAULT_WIDTH) || 1024,
  height: Number(process.env.NEXT_PUBLIC_LEONARDO_DEFAULT_HEIGHT) || 768,
  minDimension: Number(process.env.NEXT_PUBLIC_LEONARDO_MIN_DIMENSION) || 512,
  maxDimension: Number(process.env.NEXT_PUBLIC_LEONARDO_MAX_DIMENSION) || 768,
  pixelLimit: Number(process.env.NEXT_PUBLIC_LEONARDO_PIXEL_LIMIT) || 589824
};

const genConfig = {
  inferenceStepsFast: Number(process.env.NEXT_PUBLIC_LEONARDO_INFERENCE_STEPS_FAST) || 30,
  inferenceStepsQuality: Number(process.env.NEXT_PUBLIC_LEONARDO_INFERENCE_STEPS_QUALITY) || 50,
  guidanceScaleFast: Number(process.env.NEXT_PUBLIC_LEONARDO_GUIDANCE_SCALE_FAST) || 18,
  guidanceScaleQuality: Number(process.env.NEXT_PUBLIC_LEONARDO_GUIDANCE_SCALE_QUALITY) || 15,
  initStrengthFast: Number(process.env.NEXT_PUBLIC_LEONARDO_INIT_STRENGTH_FAST) || 0.88,
  initStrengthQuality: Number(process.env.NEXT_PUBLIC_LEONARDO_INIT_STRENGTH_QUALITY) || 0.85
};
