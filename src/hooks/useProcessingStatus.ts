import { useState, useCallback } from 'react';
import { ProcessingStatus } from '../components/ProcessingStatusOverlay';

interface ProcessingStatusState {
  status: ProcessingStatus;
  message?: string;
  error?: string;
}

export function useProcessingStatus() {
  const [state, setState] = useState<ProcessingStatusState>({
    status: 'idle'
  });
  
  // 设置为分析状态
  const startAnalyzing = useCallback((message?: string) => {
    setState({
      status: 'analyzing',
      message: message || '正在分析图像...',
      error: undefined
    });
  }, []);
  
  // 设置为生成状态
  const startGenerating = useCallback((message?: string) => {
    setState({
      status: 'generating',
      message: message || '正在生成艺术图像...',
      error: undefined
    });
  }, []);
  
  // 设置为错误状态
  const setError = useCallback((error: string) => {
    setState({
      status: 'error',
      error
    });
  }, []);
  
  // 重置为空闲状态
  const reset = useCallback(() => {
    setState({
      status: 'idle'
    });
  }, []);
  
  return {
    ...state,
    startAnalyzing,
    startGenerating,
    setError,
    reset
  };
} 