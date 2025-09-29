# API 文档

## 概述

轻量邮箱系统提供完整的 RESTful API，支持邮件收发、附件管理、用户认证等功能。

## 基础信息

- **Base URL**: `https://your-worker.your-subdomain.workers.dev`
- **认证方式**: Bearer Token
- **数据格式**: JSON
- **字符编码**: UTF-8

## 通用响应格式

### 成功响应
```json
{
  "success": true,
  "data": {
    // 响应数据
  },
  "pagination": {  // 分页信息（可选）
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}
```

### 错误响应
```json
{
  "success": false,
  "error": "错误描述",
  "code": "ERROR_CODE"
}
```

## 认证

### 用户注册

**POST** `/api/auth/register`

创建新用户账户。

#### 请求体
```json
{
  "email": "user@example.com"
}
```

#### 响应
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "token": "abcd1234...",
      "created_at": "2023-12-01T10:00:00Z"
    }
  }
}
```

#### 错误码
- `INVALID_EMAIL`: 邮箱格式无效
- `USER_EXISTS`: 用户已存在

### 用户登录

**POST** `/api/auth/login`

通过邮箱获取访问令牌。

#### 请求体
```json
{
  "email": "user@example.com"
}
```

#### 响应
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "token": "abcd1234...",
      "last_login": "2023-12-01T10:00:00Z"
    }
  }
}
```

#### 错误码
- `INVALID_EMAIL`: 邮箱格式无效
- `USER_NOT_FOUND`: 用户不存在
- `RATE_LIMIT_EXCEEDED`: 登录尝试过于频繁

## 邮件管理

### 获取邮件列表

**GET** `/api/messages`

获取用户的邮件列表。

#### 查询参数
| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| page | number | 页码 | 1 |
| limit | number | 每页数量 (最大100) | 20 |
| folder | string | 文件夹 (inbox/sent/draft/trash/spam) | inbox |
| is_read | boolean | 是否已读 | - |
| is_starred | boolean | 是否星标 | - |
| search | string | 搜索关键词 | - |
| sender | string | 发件人筛选 | - |
| since | string | 开始时间 (ISO 8601) | - |
| until | string | 结束时间 (ISO 8601) | - |

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "message_id": "msg-123",
      "subject": "邮件主题",
      "sender": "sender@example.com",
      "recipient": "user@example.com",
      "cc": "",
      "bcc": "",
      "reply_to": "",
      "content_text": "邮件正文",
      "content_html": "<p>邮件正文</p>",
      "is_read": false,
      "is_starred": false,
      "is_deleted": false,
      "folder": "inbox",
      "size_bytes": 1024,
      "received_at": "2023-12-01T10:00:00Z",
      "sent_at": "2023-12-01T09:58:00Z",
      "attachments": [
        {
          "id": 1,
          "filename": "document.pdf",
          "content_type": "application/pdf",
          "size_bytes": 2048
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}
```

### 获取单个邮件

**GET** `/api/messages/{id}`

获取指定邮件的详细信息。

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "id": 1,
    "message_id": "msg-123",
    "subject": "邮件主题",
    "sender": "sender@example.com",
    "recipient": "user@example.com",
    "content_text": "邮件正文",
    "content_html": "<p>邮件正文</p>",
    "raw_headers": "From: sender@example.com\nTo: user@example.com\n...",
    "is_read": true,
    "is_starred": false,
    "folder": "inbox",
    "received_at": "2023-12-01T10:00:00Z",
    "attachments": [...]
  }
}
```

#### 错误码
- `MESSAGE_NOT_FOUND`: 邮件不存在
- `ACCESS_DENIED`: 无权限访问

### 标记为已读

**PUT** `/api/messages/{id}/read`

将指定邮件标记为已读。

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### 切换星标

**PUT** `/api/messages/{id}/star`

切换邮件的星标状态。

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### 删除邮件

**DELETE** `/api/messages/{id}`

删除指定邮件。

#### 查询参数
| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| permanent | boolean | 是否永久删除 | false |

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

## 邮件发送

### 发送邮件

**POST** `/api/send`

发送新邮件。

#### 请求体
```json
{
  "to": "recipient@example.com",
  "cc": "cc@example.com",  // 可选
  "bcc": "bcc@example.com",  // 可选
  "subject": "邮件主题",
  "text": "纯文本内容",  // text 和 html 至少提供一个
  "html": "<p>HTML内容</p>",  // 可选
  "attachments": [  // 可选
    {
      "filename": "document.pdf",
      "content": "base64_encoded_content",
      "contentType": "application/pdf"
    }
  ]
}
```

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "邮件已加入发送队列"
  }
}
```

#### 错误码
- `INVALID_RECIPIENT`: 收件人邮箱无效
- `EMPTY_SUBJECT`: 主题不能为空
- `EMPTY_CONTENT`: 邮件内容不能为空
- `SEND_FAILED`: 发送失败
- `RATE_LIMIT_EXCEEDED`: 发送频率超限

## 附件管理

### 下载附件

**GET** `/api/attachments/{id}`

下载指定附件。

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
二进制文件内容，包含以下响应头：
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="document.pdf"
Content-Length: 2048
```

#### 错误码
- `ATTACHMENT_NOT_FOUND`: 附件不存在
- `ACCESS_DENIED`: 无权限访问
- `FILE_NOT_FOUND`: 文件不存在
- `DOWNLOAD_FAILED`: 下载失败

## 用户信息

### 获取用户资料

**GET** `/api/user/profile`

获取当前用户的资料信息。

#### 请求头
```
Authorization: Bearer <token>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "created_at": "2023-12-01T10:00:00Z",
    "last_login": "2023-12-01T15:30:00Z",
    "status": "active"
  }
}
```

## 系统信息

### 健康检查

**GET** `/health`

检查系统健康状态。

#### 响应
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2023-12-01T15:30:00Z"
  }
}
```

## 错误处理

### 通用错误码

| 错误码 | HTTP状态码 | 说明 |
|--------|------------|------|
| UNAUTHORIZED | 401 | 未授权访问 |
| ACCESS_DENIED | 403 | 权限不足 |
| NOT_FOUND | 404 | 资源不存在 |
| RATE_LIMIT_EXCEEDED | 429 | 频率限制 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

### 速率限制

API 包含以下速率限制：

| 限制类型 | 限制 | 时间窗口 |
|----------|------|----------|
| API 调用 | 60次 | 每分钟 |
| 邮件发送 | 10封 | 每小时 |
| 登录尝试 | 5次 | 每15分钟 |
| 附件下载 | 20次 | 每分钟 |

超出限制时会返回 `429` 状态码和相关头部：
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2023-12-01T15:31:00Z
Retry-After: 60
```

## SDK 和示例

### JavaScript 示例

```javascript
class EmailClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers
      }
    });
    return await response.json();
  }

  async getMessages(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return await this.request(`/api/messages?${queryString}`);
  }

  async sendEmail(email) {
    return await this.request('/api/send', {
      method: 'POST',
      body: JSON.stringify(email)
    });
  }
}

// 使用示例
const client = new EmailClient('https://your-worker.workers.dev', 'your-token');

// 获取收件箱
const messages = await client.getMessages({ folder: 'inbox' });

// 发送邮件
const result = await client.sendEmail({
  to: 'recipient@example.com',
  subject: '测试邮件',
  text: '这是一封测试邮件'
});
```

### cURL 示例

```bash
# 登录获取令牌
curl -X POST https://your-worker.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'

# 获取邮件列表
curl -X GET https://your-worker.workers.dev/api/messages \
  -H "Authorization: Bearer your-token"

# 发送邮件
curl -X POST https://your-worker.workers.dev/api/send \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "测试邮件",
    "text": "这是一封测试邮件"
  }'
```

## 版本信息

当前 API 版本：v1

版本更新会在响应头中包含版本信息：
```
X-API-Version: v1
```
