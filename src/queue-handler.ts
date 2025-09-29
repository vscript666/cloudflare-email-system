import { Env } from './types';
import { EmailSender } from './email-sender';
import { DatabaseService } from './database';

export class QueueHandler {
  private emailSender: EmailSender;
  private db: DatabaseService;

  constructor(private env: Env) {
    this.emailSender = new EmailSender(env);
    this.db = new DatabaseService(env);
  }

  // 处理队列消息
  async handleQueueMessage(batch: MessageBatch): Promise<void> {
    for (const message of batch.messages) {
      try {
        await this.processMessage(message);
        message.ack();
      } catch (error) {
        console.error('处理队列消息失败:', error);
        message.retry();
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const data = message.body;

    switch (data.type) {
      case 'send_email':
        await this.handleSendEmailQueue(data.queueItemId);
        break;
      
      case 'email_received':
        await this.handleEmailReceivedQueue(data.messageId, data.userId);
        break;
      
      case 'cleanup_attachments':
        await this.handleCleanupAttachments();
        break;
      
      default:
        console.warn('未知的队列消息类型:', data.type);
    }
  }

  // 处理发送邮件队列
  private async handleSendEmailQueue(queueItemId: number): Promise<void> {
    const queueItems = await this.db.getPendingSendItems(1);
    const queueItem = queueItems.find(item => item.id === queueItemId);
    
    if (!queueItem) {
      console.warn('发送队列项不存在:', queueItemId);
      return;
    }

    await this.emailSender.processSendQueue([queueItem]);
  }

  // 处理邮件接收后的队列任务
  private async handleEmailReceivedQueue(messageId: number, userId: number): Promise<void> {
    // 这里可以添加邮件接收后的后续处理
    // 例如：垃圾邮件检测、病毒扫描、推送通知等
    
    console.log(`处理接收邮件的后续任务: messageId=${messageId}, userId=${userId}`);
    
    // 示例：检查是否为垃圾邮件
    await this.checkSpam(messageId);
    
    // 示例：发送推送通知（如果配置了）
    await this.sendNotification(userId, messageId);
  }

  // 简单的垃圾邮件检测
  private async checkSpam(messageId: number): Promise<void> {
    try {
      // 这里可以实现垃圾邮件检测逻辑
      // 例如：检查发件人域名、内容关键词等
      
      // 示例实现：检查常见垃圾邮件关键词
      const spamKeywords = [
        'free money', 'lottery winner', 'click here now',
        '免费金钱', '中奖通知', '立即点击'
      ];
      
      // 这里应该从数据库获取邮件内容进行检查
      // 简化示例，实际应该查询数据库
      
      console.log(`垃圾邮件检测完成: messageId=${messageId}`);
    } catch (error) {
      console.error('垃圾邮件检测失败:', error);
    }
  }

  // 发送推送通知
  private async sendNotification(userId: number, messageId: number): Promise<void> {
    try {
      // 这里可以实现推送通知逻辑
      // 例如：WebPush、邮件通知、短信等
      
      console.log(`推送通知已发送: userId=${userId}, messageId=${messageId}`);
    } catch (error) {
      console.error('发送推送通知失败:', error);
    }
  }

  // 清理过期附件（公开方法，免费计划可直接调用）
  async handleCleanupAttachments(): Promise<void> {
    try {
      // 清理30天前已删除邮件的附件
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      // 查找需要清理的附件
      const attachmentsToDelete = await this.env.DB.prepare(`
        SELECT a.* FROM attachments a
        JOIN messages m ON a.message_id = m.id
        WHERE m.is_deleted = TRUE AND m.received_at < ?
      `).bind(cutoffDate).all();

      if (attachmentsToDelete.results && attachmentsToDelete.results.length > 0) {
        for (const attachment of attachmentsToDelete.results) {
          try {
            // 从 R2 删除文件
            await this.env.ATTACHMENTS.delete(attachment.r2_key);
            
            // 从数据库删除记录
            await this.env.DB.prepare(
              'DELETE FROM attachments WHERE id = ?'
            ).bind(attachment.id).run();
            
            console.log(`已清理附件: ${attachment.filename}`);
          } catch (error) {
            console.error(`清理附件失败: ${attachment.filename}`, error);
          }
        }
      }

      console.log(`附件清理完成，共清理 ${attachmentsToDelete.results?.length || 0} 个文件`);
    } catch (error) {
      console.error('清理附件失败:', error);
    }
  }
}

// 定时任务：清理过期数据
export async function scheduleCleanupTasks(env: Env): Promise<void> {
  if (env.EMAIL_QUEUE) {
    // 每天清理一次过期附件
    await env.EMAIL_QUEUE.send({
      type: 'cleanup_attachments'
    });
  }
}

// 队列消息接口
interface QueueMessage {
  type: 'send_email' | 'email_received' | 'cleanup_attachments';
  [key: string]: any;
}
