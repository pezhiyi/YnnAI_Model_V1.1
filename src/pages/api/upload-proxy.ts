import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { Readable } from 'stream';
import FormData from 'form-data';

export default async function handler(
  req: NextApiRequest & { body: FormData },
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 获取FormData
    const formData = req.body;
    
    // 获取上传URL和字段
    const uploadUrl = formData.get('uploadUrl') as string;
    const fields = JSON.parse(formData.get('fields') as string);
    
    // 创建新的FormData用于上传
    const uploadFormData = new FormData();
    
    // 添加所有字段
    for (const [key, value] of Object.entries(fields)) {
      uploadFormData.append(key, value);
    }
    
    // 添加文件
    const file = formData.get('file');
    if (file instanceof Readable) {
      const blob = await new Promise<Blob>((resolve) => {
        const chunks: Buffer[] = [];
        file.on('data', (chunk) => chunks.push(chunk));
        file.on('end', () => resolve(new Blob(chunks)));
      });
      uploadFormData.append('file', blob, 'image.jpg');
    }
    
    // 使用axios上传文件
    const response = await axios.post(uploadUrl, uploadFormData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('上传失败:', error);
    return res.status(500).json({ error: '上传失败' });
  }
}
