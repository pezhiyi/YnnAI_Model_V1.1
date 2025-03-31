// 这需要部署在服务器端，例如使用Next.js API路由
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fetch from 'node-fetch';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持POST请求' });
  }

  const form = new formidable.IncomingForm();
  
  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: '解析表单失败' });
    }

    const uploadUrl = fields.uploadUrl as string;
    const fieldsData = JSON.parse(fields.fields as string);
    const file = files.file as formidable.File;

    const formData = new FormData();
    
    // 添加所有字段
    Object.entries(fieldsData).forEach(([key, value]) => {
      formData.append(key, value as string);
    });
    
    // 添加文件
    const fileStream = fs.createReadStream(file.filepath);
    formData.append('file', fileStream);
    
    try {
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        return res.status(uploadResponse.status).json({
          error: '上传到S3失败',
          status: uploadResponse.status,
        });
      }
      
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ 
        error: '上传过程中出错',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
} 