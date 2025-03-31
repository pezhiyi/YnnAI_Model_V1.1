import { defineConfig } from 'vite';

export default defineConfig({
  // ...其他配置
  define: {
    'process.env.OPENAI_API_KEY': JSON.stringify(process.env.OPENAI_API_KEY),
    'process.env.OPENAI_MODEL': JSON.stringify(process.env.OPENAI_MODEL),
    'process.env.OPENAI_MAX_TOKENS': JSON.stringify(process.env.OPENAI_MAX_TOKENS),
  }
}); 