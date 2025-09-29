import { Env, User, RateLimitConfig } from './types';
import { DatabaseService } from './database';
import { checkRateLimit, createErrorResponse } from './utils';

export class AuthService {
  private db: DatabaseService;

  constructor(private env: Env) {
    this.db = new DatabaseService(env);
  }

  // 验证Bearer令牌
  async authenticateRequest(request: Request): Promise<User | null> {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7); // 移除 "Bearer " 前缀
    
    if (!token) {
      return null;
    }

    // 从数据库验证令牌
    const user = await this.db.getUserByToken(token);
    
    if (user) {
      // 更新最后登录时间
      await this.db.updateUserLastLogin(user.id);
    }

    return user;
  }

  // 鉴权中间件
  async requireAuth(request: Request): Promise<{ user: User } | Response> {
    const user = await this.authenticateRequest(request);
    
    if (!user) {
      return createErrorResponse('未授权访问', 'UNAUTHORIZED', 401);
    }

    return { user };
  }

  // 速率限制中间件
  async rateLimitMiddleware(
    request: Request,
    config: RateLimitConfig
  ): Promise<Response | null> {
    const key = config.keyGenerator(request);
    const result = await checkRateLimit(this.env.KV, key, config);

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: '请求过于频繁，请稍后再试',
          code: 'RATE_LIMIT_EXCEEDED'
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
          }
        }
      );
    }

    return null; // 继续处理请求
  }

  // 创建新用户和令牌
  async createUser(email: string): Promise<User> {
    const existingUser = await this.db.getUserByEmail(email);
    if (existingUser) {
      throw new Error('用户已存在');
    }

    // 生成安全令牌
    const token = await this.generateSecureToken();
    
    return await this.db.createUser(email, token);
  }

  // 生成安全令牌
  private async generateSecureToken(): Promise<string> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    
    // 使用 SHA-256 哈希增加安全性
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// 常用的速率限制配置
export const RATE_LIMITS = {
  // API调用限制：每分钟60次
  API_CALLS: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    keyGenerator: (request: Request) => {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.substring(7) || 'anonymous';
      return `api_calls:${token}`;
    }
  } as RateLimitConfig,

  // 邮件发送限制：每小时10封
  EMAIL_SENDING: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
    keyGenerator: (request: Request) => {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.substring(7) || 'anonymous';
      return `email_send:${token}`;
    }
  } as RateLimitConfig,

  // 登录尝试限制：每15分钟5次
  LOGIN_ATTEMPTS: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    keyGenerator: (request: Request) => {
      const ip = request.headers.get('CF-Connecting-IP') || 
                 request.headers.get('X-Forwarded-For') || 
                 'unknown';
      return `login_attempts:${ip}`;
    }
  } as RateLimitConfig,

  // 附件下载限制：每分钟20次
  ATTACHMENT_DOWNLOAD: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyGenerator: (request: Request) => {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.substring(7) || 'anonymous';
      return `attachment_download:${token}`;
    }
  } as RateLimitConfig
};

// 权限检查装饰器函数
export function requirePermission(permission: string) {
  return function(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      // 这里可以实现更复杂的权限检查逻辑
      // 目前简化为基本的用户验证
      return method.apply(this, args);
    };
  };
}

// CORS 处理
export function handleCORS(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }
  return null;
}
