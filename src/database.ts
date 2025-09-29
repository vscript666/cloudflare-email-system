import { Env, User, Message, Attachment, SendQueueItem, MessageQueryParams } from './types';

export class DatabaseService {
  constructor(private env: Env) {}

  // 用户操作
  async createUser(email: string, token: string): Promise<User> {
    const result = await this.env.DB.prepare(
      'INSERT INTO users (email, token) VALUES (?, ?) RETURNING *'
    ).bind(email, token).first<User>();
    
    if (!result) {
      throw new Error('创建用户失败');
    }
    return result;
  }

  async getUserByToken(token: string): Promise<User | null> {
    return await this.env.DB.prepare(
      'SELECT * FROM users WHERE token = ? AND status = "active"'
    ).bind(token).first<User>();
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return await this.env.DB.prepare(
      'SELECT * FROM users WHERE email = ? AND status = "active"'
    ).bind(email).first<User>();
  }

  async updateUserLastLogin(userId: number): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(userId).run();
  }

  // 邮件操作
  async createMessage(message: Omit<Message, 'id'>): Promise<Message> {
    const result = await this.env.DB.prepare(`
      INSERT INTO messages (
        message_id, user_id, subject, sender, recipient, cc, bcc, reply_to,
        content_text, content_html, raw_headers, folder, size_bytes, received_at, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      message.message_id,
      message.user_id,
      message.subject,
      message.sender,
      message.recipient,
      message.cc || '',
      message.bcc || '',
      message.reply_to || '',
      message.content_text || '',
      message.content_html || '',
      message.raw_headers || '',
      message.folder,
      message.size_bytes,
      message.received_at,
      message.sent_at || null
    ).first<Message>();

    if (!result) {
      throw new Error('创建邮件失败');
    }
    return result;
  }

  async getMessages(userId: number, params: MessageQueryParams = {}): Promise<{ messages: Message[], total: number }> {
    const {
      page = 1,
      limit = parseInt(this.env.DEFAULT_PAGE_SIZE),
      folder,
      is_read,
      is_starred,
      search,
      sender,
      since,
      until
    } = params;

    const offset = (page - 1) * limit;
    
    // 构建查询条件
    const conditions = ['user_id = ?', 'is_deleted = FALSE'];
    const bindings: any[] = [userId];

    if (folder) {
      conditions.push('folder = ?');
      bindings.push(folder);
    }

    if (is_read !== undefined) {
      conditions.push('is_read = ?');
      bindings.push(is_read);
    }

    if (is_starred !== undefined) {
      conditions.push('is_starred = ?');
      bindings.push(is_starred);
    }

    if (search) {
      conditions.push('(subject LIKE ? OR sender LIKE ? OR content_text LIKE ?)');
      bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (sender) {
      conditions.push('sender LIKE ?');
      bindings.push(`%${sender}%`);
    }

    if (since) {
      conditions.push('received_at >= ?');
      bindings.push(since);
    }

    if (until) {
      conditions.push('received_at <= ?');
      bindings.push(until);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 获取总数
    const countResult = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM messages ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    const total = countResult?.count || 0;

    // 获取邮件列表
    const messages = await this.env.DB.prepare(`
      SELECT * FROM messages ${whereClause}
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all<Message>();

    return {
      messages: messages.results || [],
      total
    };
  }

  async getMessageById(userId: number, messageId: number): Promise<Message | null> {
    return await this.env.DB.prepare(`
      SELECT * FROM messages 
      WHERE id = ? AND user_id = ? AND is_deleted = FALSE
    `).bind(messageId, userId).first<Message>();
  }

  async updateMessage(messageId: number, updates: Partial<Message>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await this.env.DB.prepare(
      `UPDATE messages SET ${fields} WHERE id = ?`
    ).bind(...values, messageId).run();
  }

  async markMessageAsRead(messageId: number): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE messages SET is_read = TRUE WHERE id = ?'
    ).bind(messageId).run();
  }

  async toggleMessageStar(messageId: number): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE messages SET is_starred = NOT is_starred WHERE id = ?'
    ).bind(messageId).run();
  }

  async deleteMessage(messageId: number, permanent: boolean = false): Promise<void> {
    if (permanent) {
      await this.env.DB.prepare(
        'DELETE FROM messages WHERE id = ?'
      ).bind(messageId).run();
    } else {
      await this.env.DB.prepare(
        'UPDATE messages SET is_deleted = TRUE, folder = "trash" WHERE id = ?'
      ).bind(messageId).run();
    }
  }

  // 附件操作
  async createAttachment(attachment: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment> {
    const result = await this.env.DB.prepare(`
      INSERT INTO attachments (message_id, filename, content_type, size_bytes, r2_key, checksum)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      attachment.message_id,
      attachment.filename,
      attachment.content_type,
      attachment.size_bytes,
      attachment.r2_key,
      attachment.checksum || null
    ).first<Attachment>();

    if (!result) {
      throw new Error('创建附件失败');
    }
    return result;
  }

  async getAttachmentsByMessageId(messageId: number): Promise<Attachment[]> {
    const result = await this.env.DB.prepare(
      'SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at'
    ).bind(messageId).all<Attachment>();
    
    return result.results || [];
  }

  async getAttachmentById(attachmentId: number): Promise<Attachment | null> {
    return await this.env.DB.prepare(
      'SELECT * FROM attachments WHERE id = ?'
    ).bind(attachmentId).first<Attachment>();
  }

  // 发送队列操作
  async addToSendQueue(item: Omit<SendQueueItem, 'id' | 'created_at' | 'processed_at'>): Promise<SendQueueItem> {
    const result = await this.env.DB.prepare(`
      INSERT INTO send_queue (
        user_id, to_email, cc_email, bcc_email, subject, 
        content_text, content_html, attachments, status, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      item.user_id,
      item.to_email,
      item.cc_email || '',
      item.bcc_email || '',
      item.subject,
      item.content_text || '',
      item.content_html || '',
      item.attachments || '',
      item.status,
      item.retry_count
    ).first<SendQueueItem>();

    if (!result) {
      throw new Error('添加到发送队列失败');
    }
    return result;
  }

  async getPendingSendItems(limit: number = 10): Promise<SendQueueItem[]> {
    const result = await this.env.DB.prepare(`
      SELECT * FROM send_queue 
      WHERE status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT ?
    `).bind(limit).all<SendQueueItem>();
    
    return result.results || [];
  }

  async updateSendQueueStatus(
    id: number, 
    status: SendQueueItem['status'], 
    errorMessage?: string
  ): Promise<void> {
    await this.env.DB.prepare(`
      UPDATE send_queue 
      SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, errorMessage || '', id).run();
  }

  async incrementRetryCount(id: number): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE send_queue SET retry_count = retry_count + 1 WHERE id = ?'
    ).bind(id).run();
  }
}
