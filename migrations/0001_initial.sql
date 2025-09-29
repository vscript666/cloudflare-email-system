-- 初始数据库结构

-- 用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended'))
);

-- 邮件表
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE NOT NULL, -- 邮件唯一标识
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    cc TEXT DEFAULT '',
    bcc TEXT DEFAULT '',
    reply_to TEXT DEFAULT '',
    content_text TEXT DEFAULT '',
    content_html TEXT DEFAULT '',
    raw_headers TEXT DEFAULT '', -- 原始邮件头
    is_read BOOLEAN DEFAULT FALSE,
    is_starred BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    folder TEXT DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'draft', 'trash', 'spam')),
    size_bytes INTEGER DEFAULT 0,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 附件表
CREATE TABLE attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    r2_key TEXT NOT NULL, -- R2 存储的键名
    checksum TEXT, -- 文件校验和
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- 发送队列表（用于异步发送）
CREATE TABLE send_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    to_email TEXT NOT NULL,
    cc_email TEXT DEFAULT '',
    bcc_email TEXT DEFAULT '',
    subject TEXT NOT NULL,
    content_text TEXT DEFAULT '',
    content_html TEXT DEFAULT '',
    attachments TEXT DEFAULT '', -- JSON 格式的附件列表
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    error_message TEXT DEFAULT '',
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_folder ON messages(folder);
CREATE INDEX idx_messages_received_at ON messages(received_at);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_messages_recipient ON messages(recipient);
CREATE INDEX idx_attachments_message_id ON attachments(message_id);
CREATE INDEX idx_send_queue_status ON send_queue(status);
CREATE INDEX idx_send_queue_user_id ON send_queue(user_id);
