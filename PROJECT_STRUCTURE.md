# 项目结构说明

## 目录结构

```
cloudflare-email-system/
├── src/                    # 源代码目录
│   ├── index.ts           # 主入口文件，处理 HTTP、邮件、队列请求
│   ├── types.ts           # TypeScript 类型定义
│   ├── database.ts        # 数据库操作类
│   ├── email-receiver.ts  # 邮件接收处理
│   ├── email-sender.ts    # 邮件发送处理
│   ├── api.ts             # RESTful API 路由处理
│   ├── auth.ts            # 认证和速率限制
│   ├── utils.ts           # 工具函数
│   └── queue-handler.ts   # 队列消息处理
├── migrations/             # 数据库迁移文件
│   └── 0001_initial.sql   # 初始数据库结构
├── public/                 # 前端静态文件
│   └── index.html         # Web 界面
├── scripts/                # 部署和工具脚本
│   └── deploy.sh          # 自动化部署脚本
├── docs/                   # 文档目录
│   └── API.md             # API 文档
├── package.json            # 项目依赖配置
├── tsconfig.json          # TypeScript 配置
├── wrangler.toml          # Cloudflare Workers 配置
├── env.example            # 环境变量示例
├── README.md              # 项目说明
└── PROJECT_STRUCTURE.md   # 本文件
```

## 核心模块说明

### 1. 主入口 (src/index.ts)
- 处理 HTTP 请求路由
- 邮件接收事件处理
- 队列消息处理
- 定时任务处理
- 全局错误处理

### 2. 数据库层 (src/database.ts)
- 用户管理操作
- 邮件CRUD操作
- 附件管理操作
- 发送队列管理
- 数据库查询封装

### 3. 邮件处理
#### 接收 (src/email-receiver.ts)
- 解析邮件内容和附件
- 存储到 D1 和 R2
- 触发后续处理队列

#### 发送 (src/email-sender.ts)
- 支持多个发送服务商
- 队列化发送处理
- 重试机制
- 发送记录管理

### 4. API 层 (src/api.ts)
- RESTful 路由处理
- 请求验证和鉴权
- 响应格式化
- 错误处理

### 5. 认证系统 (src/auth.ts)
- Bearer Token 认证
- 速率限制实现
- CORS 处理
- 权限验证

### 6. 工具函数 (src/utils.ts)
- 邮件解析工具
- 响应格式化
- 文件处理
- 验证函数

### 7. 队列处理 (src/queue-handler.ts)
- 异步任务处理
- 邮件发送队列
- 数据清理任务
- 错误重试

## Cloudflare 服务集成

### D1 数据库
- 存储用户信息
- 邮件元数据和内容
- 附件元信息
- 发送队列

### R2 对象存储
- 邮件附件存储
- 文件访问控制
- 自动清理机制

### KV 存储
- 会话数据
- 速率限制计数
- 缓存数据
- 临时状态

### Workers 队列
- 异步邮件发送
- 后台任务处理
- 错误重试机制

### Email Workers
- 接收邮件事件
- 解析邮件内容
- 触发处理流程

## 数据模型

### 用户表 (users)
```sql
id, email, token, created_at, last_login, status
```

### 邮件表 (messages)
```sql
id, message_id, user_id, subject, sender, recipient,
cc, bcc, reply_to, content_text, content_html,
raw_headers, is_read, is_starred, is_deleted,
folder, size_bytes, received_at, sent_at
```

### 附件表 (attachments)
```sql
id, message_id, filename, content_type,
size_bytes, r2_key, checksum, created_at
```

### 发送队列表 (send_queue)
```sql
id, user_id, to_email, cc_email, bcc_email,
subject, content_text, content_html, attachments,
status, error_message, retry_count,
created_at, processed_at
```

## API 端点概览

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 邮件管理
- `GET /api/messages` - 获取邮件列表
- `GET /api/messages/:id` - 获取单个邮件
- `PUT /api/messages/:id/read` - 标记已读
- `PUT /api/messages/:id/star` - 切换星标
- `DELETE /api/messages/:id` - 删除邮件

### 邮件发送
- `POST /api/send` - 发送邮件

### 附件管理
- `GET /api/attachments/:id` - 下载附件

### 用户信息
- `GET /api/user/profile` - 获取用户资料

### 系统
- `GET /health` - 健康检查

## 安全特性

### 认证机制
- Bearer Token 认证
- 令牌自动生成和验证
- 会话管理

### 速率限制
- API 调用限制
- 邮件发送限制
- 登录尝试限制
- 附件下载限制

### 数据保护
- HTML 内容清理
- 输入验证
- SQL 注入防护
- XSS 防护

### 文件安全
- 附件类型限制
- 文件大小限制
- 安全存储隔离

## 性能优化

### 免费层友好
- 分页查询减少数据传输
- 附件大小限制
- 缓存策略
- 异步处理

### 数据库优化
- 索引设计
- 查询优化
- 分页实现
- 软删除机制

### 存储优化
- R2 分层存储
- 自动清理机制
- 压缩传输
- CDN 加速

## 部署流程

### 自动化部署
1. 资源创建和配置
2. 数据库迁移
3. 环境变量设置
4. Worker 部署
5. 前端部署（可选）
6. 验证和测试

### 手动配置
1. DNS 设置
2. Email Routing 配置
3. 域名验证
4. SPF/DKIM/DMARC 配置

## 监控和维护

### 日志记录
- 请求日志
- 错误日志
- 性能指标
- 业务指标

### 告警设置
- 错误率监控
- 性能监控
- 容量监控
- 安全监控

### 定期维护
- 数据清理
- 性能优化
- 安全更新
- 功能扩展

## 扩展性设计

### 模块化架构
- 松耦合设计
- 接口抽象
- 插件机制
- 服务分离

### 功能扩展点
- 邮件发送服务商
- 认证方式
- 存储后端
- 通知机制

### 未来规划
- 多用户域名支持
- 邮件规则引擎
- 高级搜索
- 移动应用 API
