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

    // 前端页面服务
    if (pathname === '/' || pathname === '/index.html') {
      return await this.serveFrontend();
    }

    // 静态资源（如果需要）
    if (pathname.startsWith('/assets/') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
      return new Response('Static file not found', { status: 404 });
    }

    // 404 - 其他路径重定向到首页（SPA 路由）
    if (!pathname.startsWith('/api/')) {
      return await this.serveFrontend();
    }

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

  // 服务前端页面
  private async serveFrontend(): Promise<Response> {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>轻量邮箱系统</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
</head>
<body class="bg-gray-50 min-h-screen">
    <div x-data="emailApp()" x-init="init()" class="h-screen flex flex-col">
        <!-- 顶部导航 -->
        <header class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center">
                        <h1 class="text-xl font-semibold text-gray-900">轻量邮箱系统</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <span x-show="user" class="text-sm text-gray-600" x-text="user?.email"></span>
                        <button 
                            x-show="!user" 
                            @click="showLogin = true"
                            class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
                            登录
                        </button>
                        <button 
                            x-show="user" 
                            @click="logout()"
                            class="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700">
                            退出
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <!-- 主内容区域 -->
        <div class="flex-1 flex">
            <!-- 侧边栏 -->
            <aside x-show="user" class="w-64 bg-white shadow-sm border-r">
                <div class="p-4">
                    <button 
                        @click="showCompose = true"
                        class="w-full bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 mb-4">
                        写邮件
                    </button>
                    
                    <nav class="space-y-1">
                        <a @click="loadMessages('inbox')" 
                           :class="currentFolder === 'inbox' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'"
                           class="flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer">
                            <span class="mr-3">📥</span>
                            收件箱
                            <span x-show="unreadCount.inbox > 0" 
                                  x-text="unreadCount.inbox"
                                  class="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-1"></span>
                        </a>
                        <a @click="loadMessages('sent')" 
                           :class="currentFolder === 'sent' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'"
                           class="flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer">
                            <span class="mr-3">📤</span>
                            已发送
                        </a>
                        <a @click="loadMessages('draft')" 
                           :class="currentFolder === 'draft' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'"
                           class="flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer">
                            <span class="mr-3">📝</span>
                            草稿
                        </a>
                        <a @click="loadMessages('trash')" 
                           :class="currentFolder === 'trash' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'"
                           class="flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer">
                            <span class="mr-3">🗑️</span>
                            回收站
                        </a>
                    </nav>
                </div>
            </aside>

            <!-- 邮件列表和内容 -->
            <main class="flex-1 flex" x-show="user">
                <!-- 邮件列表 -->
                <div class="w-1/3 bg-white border-r">
                    <div class="p-4 border-b">
                        <div class="flex items-center space-x-2">
                            <input 
                                x-model="searchQuery"
                                @keyup.enter="searchMessages()"
                                type="text" 
                                placeholder="搜索邮件..."
                                class="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm">
                            <button 
                                @click="searchMessages()"
                                class="bg-gray-600 text-white px-3 py-2 rounded-md text-sm hover:bg-gray-700">
                                搜索
                            </button>
                        </div>
                    </div>
                    
                    <div class="overflow-y-auto h-full">
                        <div x-show="loading" class="p-4 text-center text-gray-500">
                            加载中...
                        </div>
                        
                        <div x-show="!loading && messages.length === 0" class="p-4 text-center text-gray-500">
                            没有邮件
                        </div>
                        
                        <template x-for="message in messages" :key="message.id">
                            <div 
                                @click="selectMessage(message)"
                                :class="selectedMessage?.id === message.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'"
                                class="border-b p-4 cursor-pointer">
                                <div class="flex items-start justify-between">
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center space-x-2">
                                            <span x-show="!message.is_read" class="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span x-show="message.is_starred" class="text-yellow-500">⭐</span>
                                            <p class="text-sm font-medium text-gray-900 truncate" 
                                               x-text="currentFolder === 'sent' ? message.recipient : message.sender"></p>
                                        </div>
                                        <p class="text-sm text-gray-600 truncate mt-1" x-text="message.subject"></p>
                                        <p class="text-xs text-gray-500 truncate mt-1" x-text="message.content_text"></p>
                                    </div>
                                    <div class="text-xs text-gray-500 ml-2">
                                        <span x-text="formatDate(message.received_at)"></span>
                                        <div x-show="message.attachments && message.attachments.length > 0" class="mt-1">
                                            📎
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- 邮件内容 -->
                <div class="flex-1 flex flex-col">
                    <div x-show="!selectedMessage" class="flex-1 flex items-center justify-center text-gray-500">
                        选择一封邮件查看内容
                    </div>
                    
                    <div x-show="selectedMessage" class="flex-1 flex flex-col">
                        <!-- 邮件头部 -->
                        <div class="p-6 border-b bg-white">
                            <div class="flex items-start justify-between">
                                <div class="flex-1">
                                    <h2 class="text-xl font-semibold text-gray-900 mb-2" x-text="selectedMessage?.subject"></h2>
                                    <div class="text-sm text-gray-600">
                                        <p><strong>发件人：</strong> <span x-text="selectedMessage?.sender"></span></p>
                                        <p><strong>收件人：</strong> <span x-text="selectedMessage?.recipient"></span></p>
                                        <p x-show="selectedMessage?.cc"><strong>抄送：</strong> <span x-text="selectedMessage?.cc"></span></p>
                                        <p><strong>时间：</strong> <span x-text="formatDateTime(selectedMessage?.received_at)"></span></p>
                                    </div>
                                </div>
                                <div class="flex items-center space-x-2">
                                    <button 
                                        @click="toggleStar(selectedMessage)"
                                        :class="selectedMessage?.is_starred ? 'text-yellow-500' : 'text-gray-400'"
                                        class="p-2 hover:bg-gray-100 rounded">
                                        ⭐
                                    </button>
                                    <button 
                                        @click="deleteMessage(selectedMessage)"
                                        class="p-2 text-red-600 hover:bg-red-50 rounded">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 邮件正文 -->
                        <div class="flex-1 p-6 overflow-y-auto bg-white">
                            <div x-show="selectedMessage?.content_html" 
                                 x-html="selectedMessage?.content_html"
                                 class="prose max-w-none"></div>
                            <div x-show="!selectedMessage?.content_html && selectedMessage?.content_text" 
                                 x-text="selectedMessage?.content_text"
                                 class="whitespace-pre-wrap"></div>
                        </div>

                        <!-- 附件 -->
                        <div x-show="selectedMessage?.attachments && selectedMessage.attachments.length > 0" 
                             class="p-4 border-t bg-gray-50">
                            <h4 class="text-sm font-medium text-gray-900 mb-2">附件</h4>
                            <div class="space-y-2">
                                <template x-for="attachment in selectedMessage?.attachments" :key="attachment.id">
                                    <div class="flex items-center justify-between p-2 bg-white rounded border">
                                        <div class="flex items-center space-x-2">
                                            <span class="text-gray-500">📎</span>
                                            <span class="text-sm" x-text="attachment.filename"></span>
                                            <span class="text-xs text-gray-500" x-text="formatFileSize(attachment.size_bytes)"></span>
                                        </div>
                                        <button 
                                            @click="downloadAttachment(attachment)"
                                            class="text-blue-600 hover:text-blue-800 text-sm">
                                            下载
                                        </button>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <!-- 未登录状态 -->
            <div x-show="!user" class="flex-1 flex items-center justify-center">
                <div class="text-center">
                    <h2 class="text-2xl font-bold text-gray-900 mb-4">欢迎使用轻量邮箱系统</h2>
                    <p class="text-gray-600 mb-8">请登录以查看您的邮件</p>
                    <button 
                        @click="showLogin = true"
                        class="bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700">
                        立即登录
                    </button>
                </div>
            </div>
        </div>

        <!-- 登录模态框 -->
        <div x-show="showLogin" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 w-96">
                <h3 class="text-lg font-semibold mb-4">登录</h3>
                <form @submit.prevent="login()">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">邮箱地址</label>
                        <input 
                            x-model="loginEmail"
                            type="email" 
                            required
                            class="w-full border border-gray-300 rounded-md px-3 py-2">
                    </div>
                    <div class="flex justify-end space-x-2">
                        <button 
                            type="button"
                            @click="showLogin = false"
                            class="px-4 py-2 text-gray-600 hover:text-gray-800">
                            取消
                        </button>
                        <button 
                            type="submit"
                            class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                            登录
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- 写邮件模态框 -->
        <div x-show="showCompose" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 w-2/3 max-w-4xl h-2/3">
                <h3 class="text-lg font-semibold mb-4">写邮件</h3>
                <form @submit.prevent="sendEmail()" class="h-full flex flex-col">
                    <div class="space-y-4 mb-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">收件人</label>
                            <input 
                                x-model="composeForm.to"
                                type="email" 
                                required
                                class="w-full border border-gray-300 rounded-md px-3 py-2">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">主题</label>
                            <input 
                                x-model="composeForm.subject"
                                type="text" 
                                required
                                class="w-full border border-gray-300 rounded-md px-3 py-2">
                        </div>
                    </div>
                    <div class="flex-1 mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">内容</label>
                        <textarea 
                            x-model="composeForm.text"
                            class="w-full h-full border border-gray-300 rounded-md px-3 py-2 resize-none"
                            placeholder="请输入邮件内容..."></textarea>
                    </div>
                    <div class="flex justify-end space-x-2">
                        <button 
                            type="button"
                            @click="showCompose = false; resetComposeForm()"
                            class="px-4 py-2 text-gray-600 hover:text-gray-800">
                            取消
                        </button>
                        <button 
                            type="submit"
                            :disabled="sending"
                            class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50">
                            <span x-show="!sending">发送</span>
                            <span x-show="sending">发送中...</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script>
        function emailApp() {
            return {
                user: null,
                showLogin: false,
                showCompose: false,
                loginEmail: '',
                currentFolder: 'inbox',
                messages: [],
                selectedMessage: null,
                searchQuery: '',
                loading: false,
                sending: false,
                unreadCount: { inbox: 0, sent: 0, draft: 0, trash: 0 },
                composeForm: {
                    to: '',
                    subject: '',
                    text: ''
                },

                async init() {
                    const token = localStorage.getItem('email_token');
                    if (token) {
                        try {
                            await this.loadProfile();
                            await this.loadMessages('inbox');
                        } catch (error) {
                            localStorage.removeItem('email_token');
                        }
                    }
                },

                async login() {
                    try {
                        const response = await this.apiCall('/api/auth/login', 'POST', { email: this.loginEmail });
                        if (response.success) {
                            localStorage.setItem('email_token', response.data.user.token);
                            this.user = response.data.user;
                            this.showLogin = false;
                            this.loginEmail = '';
                            await this.loadMessages('inbox');
                        } else {
                            alert(response.error || '登录失败');
                        }
                    } catch (error) {
                        alert('登录失败：' + error.message);
                    }
                },

                logout() {
                    localStorage.removeItem('email_token');
                    this.user = null;
                    this.messages = [];
                    this.selectedMessage = null;
                },

                async loadProfile() {
                    const response = await this.apiCall('/api/user/profile');
                    if (response.success) {
                        this.user = response.data;
                    }
                },

                async loadMessages(folder) {
                    this.loading = true;
                    this.currentFolder = folder;
                    this.selectedMessage = null;
                    
                    try {
                        const response = await this.apiCall(\`/api/messages?folder=\${folder}&limit=50\`);
                        if (response.success) {
                            this.messages = response.data;
                            this.updateUnreadCount();
                        }
                    } catch (error) {
                        console.error('加载邮件失败:', error);
                    } finally {
                        this.loading = false;
                    }
                },

                async selectMessage(message) {
                    this.selectedMessage = message;
                    
                    if (!message.is_read) {
                        try {
                            await this.apiCall(\`/api/messages/\${message.id}/read\`, 'PUT');
                            message.is_read = true;
                            this.updateUnreadCount();
                        } catch (error) {
                            console.error('标记已读失败:', error);
                        }
                    }
                },

                async toggleStar(message) {
                    try {
                        await this.apiCall(\`/api/messages/\${message.id}/star\`, 'PUT');
                        message.is_starred = !message.is_starred;
                    } catch (error) {
                        console.error('切换星标失败:', error);
                    }
                },

                async deleteMessage(message) {
                    if (confirm('确定要删除这封邮件吗？')) {
                        try {
                            await this.apiCall(\`/api/messages/\${message.id}\`, 'DELETE');
                            this.messages = this.messages.filter(m => m.id !== message.id);
                            if (this.selectedMessage?.id === message.id) {
                                this.selectedMessage = null;
                            }
                        } catch (error) {
                            console.error('删除邮件失败:', error);
                        }
                    }
                },

                async sendEmail() {
                    this.sending = true;
                    
                    try {
                        const response = await this.apiCall('/api/send', 'POST', this.composeForm);
                        if (response.success) {
                            alert('邮件发送成功！');
                            this.showCompose = false;
                            this.resetComposeForm();
                        } else {
                            alert(response.error || '发送失败');
                        }
                    } catch (error) {
                        alert('发送失败：' + error.message);
                    } finally {
                        this.sending = false;
                    }
                },

                async searchMessages() {
                    if (!this.searchQuery.trim()) {
                        await this.loadMessages(this.currentFolder);
                        return;
                    }

                    this.loading = true;
                    try {
                        const response = await this.apiCall(\`/api/messages?search=\${encodeURIComponent(this.searchQuery)}&limit=50\`);
                        if (response.success) {
                            this.messages = response.data;
                        }
                    } catch (error) {
                        console.error('搜索失败:', error);
                    } finally {
                        this.loading = false;
                    }
                },

                async downloadAttachment(attachment) {
                    try {
                        const response = await fetch(\`/api/attachments/\${attachment.id}\`, {
                            headers: {
                                'Authorization': \`Bearer \${localStorage.getItem('email_token')}\`
                            }
                        });

                        if (response.ok) {
                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = attachment.filename;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                        } else {
                            alert('下载失败');
                        }
                    } catch (error) {
                        alert('下载失败：' + error.message);
                    }
                },

                resetComposeForm() {
                    this.composeForm = { to: '', subject: '', text: '' };
                },

                updateUnreadCount() {
                    this.unreadCount.inbox = this.messages.filter(m => !m.is_read && m.folder === 'inbox').length;
                },

                async apiCall(url, method = 'GET', body = null) {
                    const options = {
                        method,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': \`Bearer \${localStorage.getItem('email_token')}\`
                        }
                    };

                    if (body) {
                        options.body = JSON.stringify(body);
                    }

                    const response = await fetch(url, options);
                    return await response.json();
                },

                formatDate(dateString) {
                    const date = new Date(dateString);
                    const now = new Date();
                    const diff = now - date;
                    
                    if (diff < 24 * 60 * 60 * 1000) {
                        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                    } else {
                        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
                    }
                },

                formatDateTime(dateString) {
                    return new Date(dateString).toLocaleString('zh-CN');
                },

                formatFileSize(bytes) {
                    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                    if (bytes === 0) return '0 Bytes';
                    const i = Math.floor(Math.log(bytes) / Math.log(1024));
                    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
                }
            }
        }
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
}
