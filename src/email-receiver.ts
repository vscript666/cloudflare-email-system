import { Env, EmailMessage, Message } from './types';
import { DatabaseService } from './database';
import { generateMessageId, parseEmailHeaders, extractAttachments } from './utils';

export class EmailReceiver {
  private db: DatabaseService;

  constructor(private env: Env) {
    this.db = new DatabaseService(env);
  }

  async handleIncomingEmail(message: EmailMessage): Promise<void> {
    try {
      console.log('处理收到的邮件:', { from: message.from, to: message.to });

      // 查找接收邮箱对应的用户
      const recipient = message.to;
      const user = await this.db.getUserByEmail(recipient);
      
      if (!user) {
        console.log('未找到接收用户:', recipient);
        return;
      }

      // 解析邮件内容
      const emailContent = await this.parseEmailContent(message);
      
      // 生成唯一邮件ID
      const messageId = generateMessageId();
      
      // 创建邮件记录
      const emailRecord: Omit<Message, 'id'> = {
        message_id: messageId,
        user_id: user.id,
        subject: emailContent.subject || '(无主题)',
        sender: message.from,
        recipient: message.to,
        cc: emailContent.cc || '',
        bcc: emailContent.bcc || '',
        reply_to: emailContent.replyTo || '',
        content_text: emailContent.textContent || '',
        content_html: emailContent.htmlContent || '',
        raw_headers: emailContent.rawHeaders || '',
        is_read: false,
        is_starred: false,
        is_deleted: false,
        folder: 'inbox',
        size_bytes: message.rawSize,
        received_at: new Date().toISOString(),
        sent_at: emailContent.date || new Date().toISOString()
      };

      // 保存邮件到数据库
      const savedMessage = await this.db.createMessage(emailRecord);
      console.log('邮件已保存到数据库:', savedMessage.id);

      // 处理附件
      if (emailContent.attachments && emailContent.attachments.length > 0) {
        await this.processAttachments(savedMessage.id, emailContent.attachments);
      }

      // 可选：发送到队列进行后续处理（付费计划功能）
      if (this.env.EMAIL_QUEUE) {
        await this.env.EMAIL_QUEUE.send({
          type: 'email_received',
          messageId: savedMessage.id,
          userId: user.id
        });
      } else {
        // 免费计划：直接执行后续处理
        console.log('免费计划模式：跳过队列处理，直接完成邮件接收');
      }

    } catch (error) {
      console.error('处理邮件时发生错误:', error);
      // 这里可以添加错误处理逻辑，比如发送到死信队列
      throw error;
    }
  }

  private async parseEmailContent(message: EmailMessage): Promise<ParsedEmailContent> {
    const rawContent = await this.streamToString(message.raw);
    
    // 解析邮件头部
    const headers = parseEmailHeaders(rawContent);
    
    // 提取邮件正文（文本和HTML）
    const { textContent, htmlContent } = this.extractEmailBody(rawContent);
    
    // 提取附件
    const attachments = await extractAttachments(rawContent);
    
    return {
      subject: headers.get('Subject') || '',
      cc: headers.get('Cc') || '',
      bcc: headers.get('Bcc') || '',
      replyTo: headers.get('Reply-To') || '',
      date: headers.get('Date') || '',
      textContent,
      htmlContent,
      rawHeaders: this.headersToString(headers),
      attachments
    };
  }

  private async streamToString(stream: ReadableStream): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode(); // 完成解码
      return result;
    } finally {
      reader.releaseLock();
    }
  }

  private extractEmailBody(rawContent: string): { textContent: string; htmlContent: string } {
    let textContent = '';
    let htmlContent = '';

    // 简单的 MIME 解析（生产环境建议使用专门的邮件解析库）
    const lines = rawContent.split('\n');
    let inTextPart = false;
    let inHtmlPart = false;
    let inBody = false;

    for (const line of lines) {
      // 检测邮件正文开始（空行后）
      if (!inBody && line.trim() === '') {
        inBody = true;
        continue;
      }

      if (!inBody) continue;

      // 检测 MIME 边界
      if (line.startsWith('--')) {
        inTextPart = false;
        inHtmlPart = false;
        continue;
      }

      // 检测内容类型
      if (line.toLowerCase().includes('content-type:')) {
        if (line.toLowerCase().includes('text/plain')) {
          inTextPart = true;
          inHtmlPart = false;
        } else if (line.toLowerCase().includes('text/html')) {
          inHtmlPart = true;
          inTextPart = false;
        }
        continue;
      }

      // 收集正文内容
      if (inTextPart) {
        textContent += line + '\n';
      } else if (inHtmlPart) {
        htmlContent += line + '\n';
      } else if (!textContent && !htmlContent) {
        // 如果没有明确的 MIME 类型，默认作为纯文本
        textContent += line + '\n';
      }
    }

    return {
      textContent: textContent.trim(),
      htmlContent: htmlContent.trim()
    };
  }

  private headersToString(headers: Map<string, string>): string {
    const headerArray: string[] = [];
    for (const [key, value] of headers.entries()) {
      headerArray.push(`${key}: ${value}`);
    }
    return headerArray.join('\n');
  }

  private async processAttachments(messageId: number, attachments: AttachmentData[]): Promise<void> {
    for (const attachment of attachments) {
      try {
        // 检查附件大小限制
        const maxSize = parseInt(this.env.MAX_ATTACHMENT_SIZE);
        if (attachment.size > maxSize) {
          console.warn(`附件 ${attachment.filename} 超过大小限制，跳过处理`);
          continue;
        }

        // 生成 R2 存储键名
        const r2Key = `attachments/${messageId}/${Date.now()}-${attachment.filename}`;
        
        // 上传到 R2
        await this.env.ATTACHMENTS.put(r2Key, attachment.content, {
          httpMetadata: {
            contentType: attachment.contentType,
            contentDisposition: `attachment; filename="${attachment.filename}"`
          }
        });

        // 保存附件记录到数据库
        await this.db.createAttachment({
          message_id: messageId,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size_bytes: attachment.size,
          r2_key: r2Key,
          checksum: attachment.checksum
        });

        console.log(`附件已保存: ${attachment.filename}`);
      } catch (error) {
        console.error(`处理附件 ${attachment.filename} 时出错:`, error);
      }
    }
  }
}

// 解析后的邮件内容接口
interface ParsedEmailContent {
  subject: string;
  cc: string;
  bcc: string;
  replyTo: string;
  date: string;
  textContent: string;
  htmlContent: string;
  rawHeaders: string;
  attachments?: AttachmentData[];
}

// 附件数据接口
interface AttachmentData {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
  size: number;
  checksum?: string;
}
