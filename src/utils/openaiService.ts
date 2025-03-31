// openaiService.ts - 封装 OpenAI API 调用逻辑

interface OpenAIResponse {
  text: string;
  chineseText?: string;
  englishText?: string;
  error?: string;
}

/**
 * 使用OpenAI API分析图片并返回描述
 * @param imageBase64 Base64格式的图片数据（不包含mime前缀）
 * @param prompt 额外的提示词
 * @param systemPrompt 系统提示词（可选）
 * @returns 包含描述文本的Promise对象
 */
export async function analyzeImageWithOpenAI(
  imageBase64: string, 
  prompt: string = "", 
  systemPrompt: string = process.env.NEXT_PUBLIC_OPENAI_SYSTEM_PROMPT || `You are a pet recognition AI prompt generator. Never say "unclear" or "unable to recognize". Focus on highly detailed, professional pet descriptions. For each pet: identify species and breed (guess if mixed); describe ears (shape, position, fur volume), eyes (size, expression, brightness), nose (color, texture, position), mouth (open/closed, shape, tongue detail). Emphasize fur edge transitions—ensure natural, soft, layered flow instead of hard outlines. Describe fur direction, volume, density, and color transitions across body parts. Include detailed body pose, limb and tail position, and interaction with objects (e.g., sitting on a chair, paws resting on cushion). If wearing clothes, accessories, or holding props, describe material, style, pattern, and position. Support multiple pets with clear separation. Background description must be clearly separated from pet description. Do not blend background elements into the pet. For background, only describe visible patterns and text (e.g., wall prints, signage, fabric motifs). If no pet is present, describe the image content instead. Output two descriptions: one starting with [Chinese]中文描述，one starting with [English]English description. The English description must be rich in detail but stay under 1500 characters. Do not add extra commentary.`
): Promise<OpenAIResponse> {
  try {
    // 为Base64数据添加正确的前缀
    const base64WithPrefix = imageBase64.startsWith('data:') 
      ? imageBase64 
      : `data:image/jpeg;base64,${imageBase64}`;

    // 构建OpenAI API请求
    const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.NEXT_PUBLIC_OPENAI_MODEL || "gpt-4o";
    const OPENAI_MAX_TOKENS = Number(process.env.NEXT_PUBLIC_OPENAI_MAX_TOKENS) || 1000;

    console.log('Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      OPENAI_API_KEY: OPENAI_API_KEY ? '已设置' : '未设置',
      OPENAI_MODEL: OPENAI_MODEL,
      OPENAI_MAX_TOKENS: OPENAI_MAX_TOKENS
    });

    if (!OPENAI_API_KEY) {
      console.error('环境变量 NEXT_PUBLIC_OPENAI_API_KEY 未设置');
      return { 
        text: "", 
        error: "请在环境变量中设置OPENAI_API_KEY" 
      };
    }

    const payload = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请分析这张图片"
            },
            {
              type: "image_url",
              image_url: {
                url: base64WithPrefix
              }
            }
          ]
        }
      ],
      max_tokens: OPENAI_MAX_TOKENS
    };

    // 发送请求到OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return { 
        text: "", 
        error: data.error?.message || "OpenAI API调用失败" 
      };
    }

    const fullText = data.choices[0]?.message?.content || "";
    
    // 分离中英文内容
    const { chineseText, englishText } = separateChineseAndEnglishText(fullText);

    return { 
      text: fullText,
      chineseText,
      englishText
    };
  } catch (error) {
    console.error("Error analyzing image:", error);
    return { 
      text: "", 
      error: error instanceof Error ? error.message : "图像分析过程中发生未知错误" 
    };
  }
}

/**
 * 将图片URL转换为Base64格式
 * @param dataUrl 图片的DataURL
 * @returns 仅包含Base64数据的字符串（移除了MIME前缀）
 */
export function extractBase64FromDataUrl(dataUrl: string): string {
  if (!dataUrl) return "";
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : dataUrl;
}

/**
 * 分离中英文内容
 * @param text 包含中英文的完整文本
 * @returns 分离的中英文文本对象
 */
export function separateChineseAndEnglishText(text: string): { chineseText: string, englishText: string } {
  let chineseText = "";
  let englishText = "";

  // 查找中文部分 [Chinese] 开头
  const chineseMatch = text.match(/\[Chinese\]([\s\S]*?)(?=\[English\]|$)/i);
  if (chineseMatch && chineseMatch[1]) {
    chineseText = chineseMatch[1].trim();
    // 压缩多余的空格和换行
    chineseText = chineseText.replace(/\n\s*\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  // 查找英文部分 [English] 开头
  const englishMatch = text.match(/\[English\]([\s\S]*?)$/i);
  if (englishMatch && englishMatch[1]) {
    englishText = englishMatch[1].trim();
    // 压缩多余的空格和换行
    englishText = englishText.replace(/\n\s*\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  // 如果找不到特定标记，则尝试智能分割
  if (!chineseText && !englishText) {
    // 检测是否有明显的中英文分界
    const lines = text.split('\n');
    let foundEnglish = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 简单检测一行是否主要是英文
      const isEnglishLine = /^[a-zA-Z\s\d.,;:()\-'"!?]+$/.test(line.trim());
      
      if (!foundEnglish && isEnglishLine && line.trim().length > 10) {
        foundEnglish = true;
        englishText = lines.slice(i).join('\n').trim();
        chineseText = lines.slice(0, i).join('\n').trim();
        break;
      }
    }
    
    // 如果没有找到明显的分界，则将整个文本视为混合
    if (!foundEnglish) {
      chineseText = text;
      englishText = text;
    }
    
    // 压缩多余的空格和换行
    chineseText = chineseText.replace(/\n\s*\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    englishText = englishText.replace(/\n\s*\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  return { chineseText, englishText };
}
