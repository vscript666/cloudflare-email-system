import { Env, SendEmailRequest, SendQueueItem } from './types';
import { DatabaseService } from './database';

export class EmailSender {
  private db: DatabaseService;

  constructor(private env: Env) {
    this.db = new DatabaseService(env);
  }

  // 发送邮件（支持多个提供商）
  async sendEmail(userId: number, emailRequest: SendEmailRequest): Promise<void> {
    // 添加到发送队列
    const queueItem = await this.db.addToSendQueue({
      user_id: userId,
      to_email: emailRequest.to,
      cc_email: emailRequest.cc || '',
      bcc_email: emailRequest.bcc || '',
      subject: emailRequest.subject,
      content_text: emailRequest.text || '',
      content_html: emailRequest.html || '',
      attachments: emailRequest.attachments ? JSON.stringify(emailRequest.attachments) : '',
      status: 'pending',
      retry_count: 0,
      error_message: ''
    });

    // 免费计划：直接发送，付费计划：可以使用队列
    if (this.env.EMAIL_QUEUE) {
      // 付费计划：使用队列异步发送
      await this.env.EMAIL_QUEUE.send({
        type: 'send_email',
        queueItemId: queueItem.id
      });
    } else {
      // 免费计划：立即同步发送
      console.log('免费计划模式：立即发送邮件');
      await this.processSendQueue([queueItem]);
    }
  }

  // 处理发送队列
  async processSendQueue(items?: SendQueueItem[]): Promise<void> {
    if (!items) {
      items = await this.db.getPendingSendItems(10);
    }

    for (const item of items) {
      try {
        await this.db.updateSendQueueStatus(item.id, 'processing');
        
        // 选择发送提供商并发送
        await this.sendViaProvider(item);
        
        // 标记为已发送
        await this.db.updateSendQueueStatus(item.id, 'sent');
        
        // 创建已发送邮件记录
        await this.createSentMessageRecord(item);
        
      } catch (error) {
        console.error(`发送邮件失败 (ID: ${item.id}):`, error);
        
        // 增加重试次数
        await this.db.incrementRetryCount(item.id);
        
        // 检查是否需要重试
        if (item.retry_count < 3) {
          await this.db.updateSendQueueStatus(item.id, 'pending');
        } else {
          await this.db.updateSendQueueStatus(
            item.id, 
            'failed', 
            error instanceof Error ? error.message : '未知错误'
          );
        }
      }
    }
  }

  private async sendViaProvider(item: SendQueueItem): Promise<void> {
    // 按优先级选择可用的提供商
    if (this.env.MAILCHANNELS_API_KEY) {
      await this.sendViaMailChannels(item);
    } else if (this.env.RESEND_API_KEY) {
      await this.sendViaResend(item);
    } else if (this.env.SENDGRID_API_KEY) {
      await this.sendViaSendGrid(item);
    } else {
      throw new Error('没有配置可用的邮件发送提供商');
    }
  }

  // MailChannels 发送（推荐用于 Cloudflare Workers）
  private async sendViaMailChannels(item: SendQueueItem): Promise<void> {
    const payload = {
      personalizations: [
        {
          to: [{ email: item.to_email }],
          ...(item.cc_email && { cc: item.cc_email.split(',').map(email => ({ email: email.trim() })) }),
          ...(item.bcc_email && { bcc: item.bcc_email.split(',').map(email => ({ email: email.trim() })) })
        }
      ],
      from: {
        email: 'noreply@yourdomain.com', // 配置你的发送域名
        name: '邮箱系统'
      },
      subject: item.subject,
      content: [
        ...(item.content_text ? [{ type: 'text/plain', value: item.content_text }] : []),
        ...(item.content_html ? [{ type: 'text/html', value: item.content_html }] : [])
      ]
    };

    // 处理附件
    if (item.attachments) {
      const attachments = JSON.parse(item.attachments);
      payload.attachments = attachments.map((att: any) => ({
        content: att.content,
        filename: att.filename,
        type: att.contentType,
        disposition: 'attachment'
      }));
    }

    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.MAILCHANNELS_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MailChannels 发送失败: ${error}`);
    }
  }

  // Resend 发送
  private async sendViaResend(item: SendQueueItem): Promise<void> {
    const payload = {
      from: 'noreply@yourdomain.com',
      to: [item.to_email],
      ...(item.cc_email && { cc: item.cc_email.split(',').map(email => email.trim()) }),
      ...(item.bcc_email && { bcc: item.bcc_email.split(',').map(email => email.trim()) }),
      subject: item.subject,
      ...(item.content_text && { text: item.content_text }),
      ...(item.content_html && { html: item.content_html })
    };

    // 处理附件
    if (item.attachments) {
      const attachments = JSON.parse(item.attachments);
      payload.attachments = attachments.map((att: any) => ({
        content: att.content,
        filename: att.filename,
        content_type: att.contentType
      }));
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.RESEND_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Resend 发送失败: ${error}`);
    }
  }

  // SendGrid 发送
  private async sendViaSendGrid(item: SendQueueItem): Promise<void> {
    const payload = {
      personalizations: [
        {
          to: [{ email: item.to_email }],
          ...(item.cc_email && { cc: item.cc_email.split(',').map(email => ({ email: email.trim() })) }),
          ...(item.bcc_email && { bcc: item.bcc_email.split(',').map(email => ({ email: email.trim() })) }),
          subject: item.subject
        }
      ],
      from: {
        email: 'noreply@yourdomain.com',
        name: '邮箱系统'
      },
      content: [
        ...(item.content_text ? [{ type: 'text/plain', value: item.content_text }] : []),
        ...(item.content_html ? [{ type: 'text/html', value: item.content_html }] : [])
      ]
    };

    // 处理附件
    if (item.attachments) {
      const attachments = JSON.parse(item.attachments);
      payload.attachments = attachments.map((att: any) => ({
        content: att.content,
        filename: att.filename,
        type: att.contentType,
        disposition: 'attachment'
      }));
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.SENDGRID_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SendGrid 发送失败: ${error}`);
    }
  }

  private async createSentMessageRecord(item: SendQueueItem): Promise<void> {
    // 创建已发送邮件的记录
    await this.db.createMessage({
      message_id: `sent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_id: item.user_id,
      subject: item.subject,
      sender: 'noreply@yourdomain.com', // 你的发送邮箱
      recipient: item.to_email,
      cc: item.cc_email,
      bcc: item.bcc_email,
      reply_to: '',
      content_text: item.content_text,
      content_html: item.content_html,
      raw_headers: '',
      is_read: true,
      is_starred: false,
      is_deleted: false,
      folder: 'sent',
      size_bytes: (item.content_text?.length || 0) + (item.content_html?.length || 0),
      received_at: new Date().toISOString(),
      sent_at: new Date().toISOString()
    });
  }
}
