import { ApiResponse, RateLimitConfig } from './types';

// 生成唯一邮件ID
export function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${timestamp}-${random}`;
}

// 生成API令牌
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// 解析邮件头部
export function parseEmailHeaders(rawContent: string): Map<string, string> {
  const headers = new Map<string, string>();
  const lines = rawContent.split('\n');
  let headerSection = true;
  let currentHeader = '';
  let currentValue = '';

  for (const line of lines) {
    if (!headerSection) break;
    
    if (line.trim() === '') {
      // 空行表示头部结束
      if (currentHeader) {
        headers.set(currentHeader, currentValue.trim());
      }
      headerSection = false;
      break;
    }

    if (line.startsWith(' ') || line.startsWith('\t')) {
      // 续行
      currentValue += ' ' + line.trim();
    } else {
      // 新的头部字段
      if (currentHeader) {
        headers.set(currentHeader, currentValue.trim());
      }
      
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentHeader = line.substring(0, colonIndex).trim();
        currentValue = line.substring(colonIndex + 1).trim();
      }
    }
  }

  // 处理最后一个头部
  if (currentHeader) {
    headers.set(currentHeader, currentValue.trim());
  }

  return headers;
}

// 提取邮件附件（简化版本）
export async function extractAttachments(rawContent: string): Promise<AttachmentData[]> {
  const attachments: AttachmentData[] = [];
  
  // 这里应该实现完整的 MIME 解析
  // 由于篇幅限制，这里只是一个简化的示例
  // 生产环境建议使用专门的邮件解析库
  
  const lines = rawContent.split('\n');
  let inAttachment = false;
  let currentAttachment: Partial<AttachmentData> = {};
  let attachmentContent = '';

  for (const line of lines) {
    if (line.includes('Content-Disposition: attachment')) {
      inAttachment = true;
      const filenameMatch = line.match(/filename[*]?=['"]?([^'";\n]+)['"]?/i);
      if (filenameMatch) {
        currentAttachment.filename = filenameMatch[1];
      }
    } else if (line.includes('Content-Type:') && inAttachment) {
      const typeMatch = line.match(/Content-Type:\s*([^;\n]+)/i);
      if (typeMatch) {
        currentAttachment.contentType = typeMatch[1].trim();
      }
    } else if (line.includes('Content-Transfer-Encoding: base64') && inAttachment) {
      // 开始读取 base64 内容
      continue;
    } else if (line.startsWith('--') && inAttachment) {
      // 附件结束
      if (currentAttachment.filename && attachmentContent) {
        try {
          const decodedContent = base64ToArrayBuffer(attachmentContent.trim());
          attachments.push({
            filename: currentAttachment.filename,
            contentType: currentAttachment.contentType || 'application/octet-stream',
            content: decodedContent,
            size: decodedContent.byteLength,
            checksum: await calculateChecksum(decodedContent)
          });
        } catch (error) {
          console.warn('解析附件失败:', error);
        }
      }
      
      inAttachment = false;
      currentAttachment = {};
      attachmentContent = '';
    } else if (inAttachment && line.trim()) {
      attachmentContent += line.trim();
    }
  }

  return attachments;
}

// Base64 转 ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// 计算文件校验和
async function calculateChecksum(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 创建统一的API响应
export function createApiResponse<T>(
  success: boolean,
  data?: T,
  error?: string,
  code?: string,
  pagination?: any
): ApiResponse<T> {
  return {
    success,
    ...(data !== undefined && { data }),
    ...(error && { error }),
    ...(code && { code }),
    ...(pagination && { pagination })
  };
}

// 错误响应
export function createErrorResponse(
  error: string,
  code?: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify(createApiResponse(false, undefined, error, code)),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    }
  );
}

// 成功响应
export function createSuccessResponse<T>(
  data?: T,
  pagination?: any,
  status: number = 200
): Response {
  return new Response(
    JSON.stringify(createApiResponse(true, data, undefined, undefined, pagination)),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    }
  );
}

// 速率限制检查
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const resetTime = windowStart + config.windowMs;
  
  const rateLimitKey = `rate_limit:${key}:${windowStart}`;
  const currentCount = await kv.get(rateLimitKey);
  const count = currentCount ? parseInt(currentCount) : 0;
  
  if (count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime
    };
  }
  
  // 增加计数
  await kv.put(rateLimitKey, (count + 1).toString(), {
    expirationTtl: Math.ceil(config.windowMs / 1000) + 10 // 额外10秒缓冲
  });
  
  return {
    allowed: true,
    remaining: config.maxRequests - count - 1,
    resetTime
  };
}

// 验证邮箱地址
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// 清理HTML内容（防止XSS）
export function sanitizeHtml(html: string): string {
  // 简单的HTML清理，生产环境建议使用专门的库
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

// 分页计算
export function calculatePagination(
  page: number,
  limit: number,
  total: number
): {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  totalPages: number;
} {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    hasMore: page < totalPages,
    totalPages
  };
}

// 解析查询参数
export function parseQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

// 验证文件类型
export function isAllowedFileType(contentType: string): boolean {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  return allowedTypes.includes(contentType.toLowerCase());
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// 附件数据接口
interface AttachmentData {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
  size: number;
  checksum?: string;
}
