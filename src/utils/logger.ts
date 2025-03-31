/**
 * logger.ts - 提供应用全局日志功能
 * 
 * 这个日志系统支持不同级别的日志，以及在不同环境下的行为控制
 */

// 日志级别枚举
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

// 日志颜色样式
const LOG_STYLES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'color: #6c757d; font-weight: bold',
  [LogLevel.INFO]: 'color: #0d6efd; font-weight: bold',
  [LogLevel.WARN]: 'color: #fd7e14; font-weight: bold',
  [LogLevel.ERROR]: 'color: #dc3545; font-weight: bold',
  [LogLevel.NONE]: '' // 为NONE级别添加空样式
}

// 日志前缀
const LOG_PREFIX: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '🔍 DEBUG',
  [LogLevel.INFO]: '📘 INFO',
  [LogLevel.WARN]: '⚠️ WARN',
  [LogLevel.ERROR]: '❌ ERROR',
  [LogLevel.NONE]: 'NONE' // 为NONE级别添加前缀
}

// 全局日志级别设置（可以根据环境变量或其他配置动态调整）
let currentLogLevel = process.env.NODE_ENV === 'production' 
  ? LogLevel.WARN  // 生产环境默认只显示警告和错误
  : LogLevel.DEBUG; // 开发环境显示所有日志

/**
 * 设置全局日志级别
 * @param level 日志级别
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
  log(LogLevel.INFO, 'Logger', `日志级别已设置为: ${LogLevel[level]}`);
}

/**
 * 获取当前日志级别
 * @returns 当前日志级别
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * 基础日志函数
 * @param level 日志级别
 * @param module 模块名称
 * @param message 日志消息
 * @param data 额外数据
 */
function log(level: LogLevel, module: string, message: string, data?: any): void {
  if (level < currentLogLevel) return;
  if (level === LogLevel.NONE) return; // 跳过 NONE 级别的日志记录

  const timestamp = new Date().toISOString();
  const prefix = LOG_PREFIX[level];
  const moduleFormatted = `[${module}]`;

  // 如果在浏览器环境中
  if (typeof window !== 'undefined' && window.console) {
    // 带样式的日志输出
    if (data !== undefined) {
      console.groupCollapsed(
        `%c${prefix}%c ${moduleFormatted} ${message}`,
        LOG_STYLES[level],
        'color: inherit'
      );
      console.log('时间:', timestamp);
      console.log('详情:', data);
      console.groupEnd();
    } else {
      console.log(
        `%c${prefix}%c ${moduleFormatted} ${message}`,
        LOG_STYLES[level],
        'color: inherit'
      );
    }
  } else {
    // 服务器端环境下的日志
    const logMessage = `${timestamp} ${prefix} ${moduleFormatted} ${message}`;
    switch (level) {
      case LogLevel.ERROR:
        console.error(logMessage, data || '');
        break;
      case LogLevel.WARN:
        console.warn(logMessage, data || '');
        break;
      case LogLevel.INFO:
        console.info(logMessage, data || '');
        break;
      default:
        console.log(logMessage, data || '');
    }
  }
}

/**
 * 创建特定模块的日志记录器
 * @param moduleName 模块名称
 */
export function createLogger(moduleName: string) {
  return {
    debug: (message: string, data?: any) => log(LogLevel.DEBUG, moduleName, message, data),
    info: (message: string, data?: any) => log(LogLevel.INFO, moduleName, message, data),
    warn: (message: string, data?: any) => log(LogLevel.WARN, moduleName, message, data),
    error: (message: string, data?: any) => log(LogLevel.ERROR, moduleName, message, data),
  };
}

// 默认导出日志记录器创建函数
export default createLogger;
