# 轻量邮箱系统

基于 Cloudflare Workers 架构的轻量级邮箱系统，支持邮件收发、附件管理、Web界面等功能。

## 功能特性

- ✅ **邮件接收**: 通过 Cloudflare Email Routing + Email Workers 接收邮件
- ✅ **邮件发送**: 支持 MailChannels、Resend、SendGrid 等发送服务
- ✅ **附件管理**: 使用 R2 存储附件，支持上传下载
- ✅ **RESTful API**: 完整的邮件管理 API
- ✅ **Web 界面**: 响应式前端界面
- ✅ **鉴权系统**: Bearer Token 认证
- ✅ **速率限制**: 防止滥用的速率控制
- ✅ **免费层友好**: 优化资源使用，适合免费层部署

## 架构组件

### 运行时
- **Cloudflare Workers**: 主要计算平台
- **TypeScript**: 开发语言
- **Wrangler v3**: 部署工具

### 存储
- **D1**: 邮件元数据和正文存储
- **R2**: 附件二进制文件存储
- **KV**: 会话、缓存和速率限制数据
- **Queues**: 异步邮件处理

### 邮件服务
- **接收**: Cloudflare Email Routing + Email Workers
- **发送**: MailChannels/Resend/SendGrid HTTP API

## 快速开始

### 1. 环境准备

```bash
# 安装依赖
npm install

# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 2. 创建 Cloudflare 资源

```bash
# 创建 D1 数据库
wrangler d1 create email-db

# 创建 R2 存储桶
wrangler r2 bucket create email-attachments

# 创建 KV 命名空间
wrangler kv:namespace create "KV"

# 创建队列
wrangler queues create email-processing
```

### 3. 配置 wrangler.toml

更新 `wrangler.toml` 中的资源 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "email-db"
database_id = "your-database-id"  # 从创建命令的输出中获取

[[kv_namespaces]]
binding = "KV"
id = "your-kv-id"  # 从创建命令的输出中获取
```

### 4. 数据库迁移

```bash
# 本地开发环境
wrangler d1 migrations apply email-db --local

# 生产环境
wrangler d1 migrations apply email-db
```

### 5. 配置邮件发送服务

选择一个邮件发送服务并配置 API 密钥：

```bash
# MailChannels (推荐，Cloudflare Workers 专用)
wrangler secret put MAILCHANNELS_API_KEY

# 或者 Resend
wrangler secret put RESEND_API_KEY

# 或者 SendGrid
wrangler secret put SENDGRID_API_KEY
```

### 6. 部署

```bash
# 开发环境
npm run dev

# 生产部署
npm run deploy
```

## 邮件路由配置

### 1. 域名 DNS 设置

在你的域名 DNS 中添加 MX 记录：

```
MX  @  route1.mx.cloudflare.net  (优先级 10)
MX  @  route2.mx.cloudflare.net  (优先级 20)
MX  @  route3.mx.cloudflare.net  (优先级 30)
```

### 2. Cloudflare Email Routing

1. 登录 Cloudflare Dashboard
2. 选择你的域名
3. 进入 "Email Routing" 部分
4. 启用 Email Routing
5. 添加路由规则，将邮件转发到你的 Worker

### 3. SPF/DKIM/DMARC 配置

在 DNS 中添加以下记录：

```
TXT  @  "v=spf1 include:_spf.mx.cloudflare.net ~all"
TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:admin@yourdomain.com"
```

## API 文档

### 认证

所有 API 请求需要包含 Bearer Token：

```
Authorization: Bearer <your-token>
```

### 端点

#### 用户认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

#### 邮件管理
- `GET /api/messages` - 获取邮件列表
- `GET /api/messages/:id` - 获取单个邮件
- `PUT /api/messages/:id/read` - 标记为已读
- `PUT /api/messages/:id/star` - 切换星标
- `DELETE /api/messages/:id` - 删除邮件

#### 邮件发送
- `POST /api/send` - 发送邮件

#### 附件管理
- `GET /api/attachments/:id` - 下载附件

#### 用户信息
- `GET /api/user/profile` - 获取用户资料

## 免费层限制

### Cloudflare Workers 免费层
- 每天 100,000 次请求
- 每次执行最多 10ms CPU 时间
- 每次执行最多 128MB 内存

### D1 免费层
- 5GB 存储空间
- 每天 100,000 次读取操作
- 每天 50,000 次写入操作

### R2 免费层
- 10GB 存储空间
- 每月 1,000,000 次 Class A 操作
- 每月 10,000,000 次 Class B 操作

### 优化建议

1. **分页查询**: 限制每页邮件数量（默认20条）
2. **附件大小**: 限制单个附件最大10MB
3. **缓存策略**: 使用 KV 缓存常用数据
4. **异步处理**: 使用队列处理耗时操作
5. **速率限制**: 防止滥用和超出免费额度

## 本地开发

```bash
# 启动本地开发服务器
npm run dev

# 本地数据库操作
npm run d1:local

# 查看日志
wrangler tail
```

## 生产部署

### 1. 环境变量

```bash
# 设置生产环境密钥
wrangler secret put MAILCHANNELS_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put SENDGRID_API_KEY
```

### 2. 自定义域名

```bash
# 添加自定义域名
wrangler publish --routes "yourdomain.com/*,api.yourdomain.com/*"
```

### 3. 监控

- 使用 Cloudflare Analytics 监控请求量
- 配置 Logpush 导出日志
- 设置告警规则

## 安全注意事项

1. **令牌安全**: 定期轮换 API 令牌
2. **速率限制**: 启用严格的速率限制
3. **输入验证**: 对所有用户输入进行验证
4. **HTML清理**: 清理邮件内容防止 XSS
5. **CORS**: 适当配置跨域访问

## 故障排除

### 常见问题

1. **邮件接收失败**
   - 检查 DNS MX 记录配置
   - 验证 Email Routing 设置
   - 查看 Worker 日志

2. **邮件发送失败**
   - 检查发送服务 API 密钥
   - 验证发送域名配置
   - 检查速率限制

3. **附件上传失败**
   - 检查 R2 存储桶权限
   - 验证文件大小限制
   - 查看错误日志

### 日志查看

```bash
# 实时查看日志
wrangler tail

# 查看特定时间段的日志
wrangler tail --since "2023-01-01 00:00:00"
```

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License

## 支持

如有问题请创建 Issue 或联系维护者。
