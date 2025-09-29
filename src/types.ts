// Cloudflare Workers 环境绑定
export interface Env {
  // D1 数据库
  DB: D1Database;
  
  // R2 存储桶
  ATTACHMENTS: R2Bucket;
  
  // KV 存储
  KV: KVNamespace;
  
  // 队列（付费计划功能，免费版本可选）
  EMAIL_QUEUE?: Queue;
  
  // 环境变量
  ENVIRONMENT: string;
  MAX_ATTACHMENT_SIZE: string;
  DEFAULT_PAGE_SIZE: string;
  
  // 邮件发送服务配置（根据选择的服务设置）
  MAILCHANNELS_API_KEY?: string;
  RESEND_API_KEY?: string;
  SENDGRID_API_KEY?: string;
}

// 用户接口
export interface User {
  id: number;
  email: string;
  token: string;
  created_at: string;
  last_login?: string;
  status: 'active' | 'suspended';
}

// 邮件接口
export interface Message {
  id: number;
  message_id: string;
  user_id: number;
  subject: string;
  sender: string;
  recipient: string;
  cc?: string;
  bcc?: string;
  reply_to?: string;
  content_text?: string;
  content_html?: string;
  raw_headers?: string;
  is_read: boolean;
  is_starred: boolean;
  is_deleted: boolean;
  folder: 'inbox' | 'sent' | 'draft' | 'trash' | 'spam';
  size_bytes: number;
  received_at: string;
  sent_at?: string;
  attachments?: Attachment[];
}

// 附件接口
export interface Attachment {
  id: number;
  message_id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  r2_key: string;
  checksum?: string;
  created_at: string;
}

// 发送队列接口
export interface SendQueueItem {
  id: number;
  user_id: number;
  to_email: string;
  cc_email?: string;
  bcc_email?: string;
  subject: string;
  content_text?: string;
  content_html?: string;
  attachments?: string; // JSON 格式
  status: 'pending' | 'processing' | 'sent' | 'failed';
  error_message?: string;
  retry_count: number;
  created_at: string;
  processed_at?: string;
}

// API 响应格式
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// 邮件发送请求
export interface SendEmailRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64 编码
    contentType: string;
  }>;
}

// 分页参数
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

// 邮件查询参数
export interface MessageQueryParams extends PaginationParams {
  folder?: string;
  is_read?: boolean;
  is_starred?: boolean;
  search?: string;
  sender?: string;
  since?: string;
  until?: string;
}

// 速率限制配置
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (request: Request) => string;
}

// Email Worker 事件类型
export interface EmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
}

// 错误类型
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 400
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
