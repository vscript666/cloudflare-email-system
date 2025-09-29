import { Env, MessageQueryParams, SendEmailRequest } from './types';
import { DatabaseService } from './database';
import { AuthService, RATE_LIMITS } from './auth';
import { EmailSender } from './email-sender';
import { 
  createSuccessResponse, 
  createErrorResponse, 
  parseQueryParams, 
  calculatePagination,
  isValidEmail,
  sanitizeHtml
} from './utils';

export class ApiHandler {
  private db: DatabaseService;
  private auth: AuthService;
  private emailSender: EmailSender;

  constructor(private env: Env) {
    this.db = new DatabaseService(env);
    this.auth = new AuthService(env);
    this.emailSender = new EmailSender(env);
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 处理 CORS
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

    // API 路由
    if (pathname.startsWith('/api/')) {
      return await this.handleApiRequest(request, pathname, url);
    }

    // 健康检查
    if (pathname === '/health') {
      return createSuccessResponse({ status: 'healthy', timestamp: new Date().toISOString() });
    }

    // 404
    return createErrorResponse('未找到请求的资源', 'NOT_FOUND', 404);
  }

  private async handleApiRequest(request: Request, pathname: string, url: URL): Promise<Response> {
    try {
      // API 速率限制
      const rateLimitResponse = await this.auth.rateLimitMiddleware(request, RATE_LIMITS.API_CALLS);
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      // 路由分发
      if (pathname === '/api/auth/register' && request.method === 'POST') {
        return await this.handleRegister(request);
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await this.handleLogin(request);
      }

      if (pathname === '/api/messages' && request.method === 'GET') {
        return await this.handleGetMessages(request, url);
      }

      if (pathname.match(/^\/api\/messages\/\d+$/) && request.method === 'GET') {
        return await this.handleGetMessage(request, pathname);
      }

      if (pathname.match(/^\/api\/messages\/\d+\/read$/) && request.method === 'PUT') {
        return await this.handleMarkAsRead(request, pathname);
      }

      if (pathname.match(/^\/api\/messages\/\d+\/star$/) && request.method === 'PUT') {
        return await this.handleToggleStar(request, pathname);
      }

      if (pathname.match(/^\/api\/messages\/\d+$/) && request.method === 'DELETE') {
        return await this.handleDeleteMessage(request, pathname);
      }

      if (pathname === '/api/send' && request.method === 'POST') {
        return await this.handleSendEmail(request);
      }

      if (pathname.match(/^\/api\/attachments\/\d+$/) && request.method === 'GET') {
        return await this.handleDownloadAttachment(request, pathname);
      }

      if (pathname === '/api/user/profile' && request.method === 'GET') {
        return await this.handleGetProfile(request);
      }

      return createErrorResponse('未找到API端点', 'ENDPOINT_NOT_FOUND', 404);

    } catch (error) {
      console.error('API请求处理错误:', error);
      return createErrorResponse(
        '服务器内部错误', 
        'INTERNAL_ERROR', 
        500
      );
    }
  }

  // 用户注册
  private async handleRegister(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const { email } = body;

      if (!email || !isValidEmail(email)) {
        return createErrorResponse('无效的邮箱地址', 'INVALID_EMAIL');
      }

      const user = await this.auth.createUser(email);
      
      return createSuccessResponse({
        user: {
          id: user.id,
          email: user.email,
          token: user.token,
          created_at: user.created_at
        }
      });

    } catch (error) {
      if (error instanceof Error && error.message === '用户已存在') {
        return createErrorResponse('邮箱已被注册', 'USER_EXISTS', 409);
      }
      throw error;
    }
  }

  // 用户登录（通过邮箱获取令牌）
  private async handleLogin(request: Request): Promise<Response> {
    // 登录速率限制
    const rateLimitResponse = await this.auth.rateLimitMiddleware(request, RATE_LIMITS.LOGIN_ATTEMPTS);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    try {
      const body = await request.json();
      const { email } = body;

      if (!email || !isValidEmail(email)) {
        return createErrorResponse('无效的邮箱地址', 'INVALID_EMAIL');
      }

      const user = await this.db.getUserByEmail(email);
      if (!user) {
        return createErrorResponse('用户不存在', 'USER_NOT_FOUND', 404);
      }

      return createSuccessResponse({
        user: {
          id: user.id,
          email: user.email,
          token: user.token,
          last_login: user.last_login
        }
      });

    } catch (error) {
      throw error;
    }
  }

  // 获取邮件列表
  private async handleGetMessages(request: Request, url: URL): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    const params = parseQueryParams(url);
    const queryParams: MessageQueryParams = {
      page: parseInt(params.page) || 1,
      limit: Math.min(parseInt(params.limit) || parseInt(this.env.DEFAULT_PAGE_SIZE), 100),
      folder: params.folder,
      is_read: params.is_read === 'true' ? true : params.is_read === 'false' ? false : undefined,
      is_starred: params.is_starred === 'true' ? true : params.is_starred === 'false' ? false : undefined,
      search: params.search,
      sender: params.sender,
      since: params.since,
      until: params.until
    };

    const { messages, total } = await this.db.getMessages(user.id, queryParams);
    
    // 获取附件信息
    for (const message of messages) {
      message.attachments = await this.db.getAttachmentsByMessageId(message.id);
    }

    const pagination = calculatePagination(queryParams.page!, queryParams.limit!, total);

    return createSuccessResponse(messages, pagination);
  }

  // 获取单个邮件
  private async handleGetMessage(request: Request, pathname: string): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    const messageId = parseInt(pathname.split('/').pop()!);
    const message = await this.db.getMessageById(user.id, messageId);

    if (!message) {
      return createErrorResponse('邮件不存在', 'MESSAGE_NOT_FOUND', 404);
    }

    // 获取附件
    message.attachments = await this.db.getAttachmentsByMessageId(message.id);

    return createSuccessResponse(message);
  }

  // 标记为已读
  private async handleMarkAsRead(request: Request, pathname: string): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    const messageId = parseInt(pathname.split('/')[3]);
    const message = await this.db.getMessageById(user.id, messageId);

    if (!message) {
      return createErrorResponse('邮件不存在', 'MESSAGE_NOT_FOUND', 404);
    }

    await this.db.markMessageAsRead(messageId);
    return createSuccessResponse({ success: true });
  }

  // 切换星标
  private async handleToggleStar(request: Request, pathname: string): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    const messageId = parseInt(pathname.split('/')[3]);
    const message = await this.db.getMessageById(user.id, messageId);

    if (!message) {
      return createErrorResponse('邮件不存在', 'MESSAGE_NOT_FOUND', 404);
    }

    await this.db.toggleMessageStar(messageId);
    return createSuccessResponse({ success: true });
  }

  // 删除邮件
  private async handleDeleteMessage(request: Request, pathname: string): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    const messageId = parseInt(pathname.split('/').pop()!);
    const message = await this.db.getMessageById(user.id, messageId);

    if (!message) {
      return createErrorResponse('邮件不存在', 'MESSAGE_NOT_FOUND', 404);
    }

    const url = new URL(request.url);
    const permanent = url.searchParams.get('permanent') === 'true';

    await this.db.deleteMessage(messageId, permanent);
    return createSuccessResponse({ success: true });
  }

  // 发送邮件
  private async handleSendEmail(request: Request): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    // 发送速率限制
    const rateLimitResponse = await this.auth.rateLimitMiddleware(request, RATE_LIMITS.EMAIL_SENDING);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    try {
      const body: SendEmailRequest = await request.json();
      
      // 验证请求数据
      if (!body.to || !isValidEmail(body.to)) {
        return createErrorResponse('无效的收件人邮箱', 'INVALID_RECIPIENT');
      }

      if (!body.subject?.trim()) {
        return createErrorResponse('主题不能为空', 'EMPTY_SUBJECT');
      }

      if (!body.text?.trim() && !body.html?.trim()) {
        return createErrorResponse('邮件内容不能为空', 'EMPTY_CONTENT');
      }

      // 清理HTML内容
      if (body.html) {
        body.html = sanitizeHtml(body.html);
      }

      // 发送邮件
      await this.emailSender.sendEmail(user.id, body);

      return createSuccessResponse({ 
        success: true, 
        message: '邮件已加入发送队列' 
      });

    } catch (error) {
      console.error('发送邮件错误:', error);
      return createErrorResponse('发送邮件失败', 'SEND_FAILED');
    }
  }

  // 下载附件
  private async handleDownloadAttachment(request: Request, pathname: string): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    // 下载速率限制
    const rateLimitResponse = await this.auth.rateLimitMiddleware(request, RATE_LIMITS.ATTACHMENT_DOWNLOAD);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const attachmentId = parseInt(pathname.split('/').pop()!);
    const attachment = await this.db.getAttachmentById(attachmentId);

    if (!attachment) {
      return createErrorResponse('附件不存在', 'ATTACHMENT_NOT_FOUND', 404);
    }

    // 验证用户权限
    const message = await this.db.getMessageById(user.id, attachment.message_id);
    if (!message) {
      return createErrorResponse('无权限访问此附件', 'ACCESS_DENIED', 403);
    }

    try {
      // 从 R2 获取文件
      const file = await this.env.ATTACHMENTS.get(attachment.r2_key);
      if (!file) {
        return createErrorResponse('附件文件不存在', 'FILE_NOT_FOUND', 404);
      }

      return new Response(file.body, {
        headers: {
          'Content-Type': attachment.content_type,
          'Content-Disposition': `attachment; filename="${attachment.filename}"`,
          'Content-Length': attachment.size_bytes.toString(),
          'Cache-Control': 'private, max-age=3600'
        }
      });

    } catch (error) {
      console.error('下载附件错误:', error);
      return createErrorResponse('下载附件失败', 'DOWNLOAD_FAILED');
    }
  }

  // 获取用户资料
  private async handleGetProfile(request: Request): Promise<Response> {
    const authResult = await this.auth.requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { user } = authResult;

    return createSuccessResponse({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_login: user.last_login,
      status: user.status
    });
  }
}
