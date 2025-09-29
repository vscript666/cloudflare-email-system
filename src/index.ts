import { Env } from './types';
import { ApiHandler } from './api';
import { EmailReceiver } from './email-receiver';
import { QueueHandler } from './queue-handler';
import { handleCORS } from './auth';

export default {
  // HTTP 请求处理
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // CORS 预检请求
      const corsResponse = handleCORS(request);
      if (corsResponse) {
        return corsResponse;
      }

      // 创建 API 处理器
      const apiHandler = new ApiHandler(env);
      
      // 处理请求
      return await apiHandler.handleRequest(request);
      
    } catch (error) {
      console.error('处理请求时发生未捕获的错误:', error);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: '服务器内部错误',
          code: 'INTERNAL_ERROR'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  },

  // 邮件接收处理
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log('收到新邮件:', {
        from: message.from,
        to: message.to,
        size: message.rawSize
      });

      // 创建邮件接收器
      const emailReceiver = new EmailReceiver(env);
      
      // 处理邮件
      await emailReceiver.handleIncomingEmail(message);
      
      console.log('邮件处理完成');
      
    } catch (error) {
      console.error('处理邮件时发生错误:', error);
      
      // 邮件处理失败，可以选择：
      // 1. 丢弃邮件
      // 2. 转发到管理员邮箱
      // 3. 发送到死信队列
      
      throw error; // 重新抛出错误，让 Cloudflare 知道处理失败
    }
  },

  // 队列处理（付费计划功能）
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
    // 只有付费计划才有队列功能
    if (!env.EMAIL_QUEUE) {
      console.log('免费计划不支持队列功能');
      return;
    }

    try {
      console.log(`处理队列批次，包含 ${batch.messages.length} 条消息`);
      
      // 创建队列处理器
      const queueHandler = new QueueHandler(env);
      
      // 处理批次
      await queueHandler.handleQueueMessage(batch);
      
      console.log('队列批次处理完成');
      
    } catch (error) {
      console.error('处理队列批次时发生错误:', error);
      throw error;
    }
  },

  // 定时触发器（可选）
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log('执行定时任务:', event.cron);
      
      // 根据 cron 表达式执行不同的任务
      switch (event.cron) {
        case '0 0 * * *': // 每天午夜
          // 清理过期数据
          if (env.EMAIL_QUEUE) {
            // 付费计划：使用队列
            await env.EMAIL_QUEUE.send({
              type: 'cleanup_attachments'
            });
          } else {
            // 免费计划：直接执行清理
            const queueHandler = new QueueHandler(env);
            await queueHandler.handleCleanupAttachments();
          }
          break;
          
        case '0 */6 * * *': // 每6小时
          // 处理待发送邮件
          const emailSender = new EmailSender(env);
          await emailSender.processSendQueue(); // 直接处理待发送邮件
          break;
          
        default:
          console.log('未知的定时任务:', event.cron);
      }
      
    } catch (error) {
      console.error('执行定时任务时发生错误:', error);
    }
  }
};

// Durable Objects（可选，用于会话管理）
export class UserSession {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      
      if (url.pathname === '/session/get') {
        const sessionData = await this.state.storage.get('session');
        return new Response(JSON.stringify(sessionData || {}), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (url.pathname === '/session/set' && request.method === 'POST') {
        const data = await request.json();
        await this.state.storage.put('session', data);
        return new Response('OK');
      }
      
      if (url.pathname === '/session/delete' && request.method === 'DELETE') {
        await this.state.storage.deleteAll();
        return new Response('OK');
      }
      
      return new Response('Not Found', { status: 404 });
      
    } catch (error) {
      console.error('Durable Object 错误:', error);
      return new Response('Internal Error', { status: 500 });
    }
  }
}

// 类型声明
declare global {
  interface ForwardableEmailMessage {
    from: string;
    to: string;
    headers: Headers;
    raw: ReadableStream;
    rawSize: number;
  }

  interface ScheduledEvent {
    cron: string;
    scheduledTime: number;
  }

  interface MessageBatch<T = any> {
    messages: Array<{
      body: T;
      ack(): void;
      retry(): void;
    }>;
  }
}
