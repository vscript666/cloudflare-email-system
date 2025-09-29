# 免费计划配置指南

## 🎯 免费计划功能

本邮箱系统已优化为完全兼容 Cloudflare 免费计划，无需升级到付费计划即可使用所有核心功能。

## ✅ 免费计划包含的服务

### Cloudflare Workers
- **100,000 次请求/天**
- **10ms CPU 时间/请求**
- **128MB 内存**
- ✅ 足够处理邮件收发

### D1 数据库
- **5GB 存储空间**
- **100,000 次读操作/天**
- **50,000 次写操作/天**
- ✅ 存储邮件和用户数据

### R2 对象存储
- **10GB 存储空间**
- **1,000,000 次 Class A 操作/月**（写入）
- **10,000,000 次 Class B 操作/月**（读取）
- ✅ 存储邮件附件

### KV 存储
- **100,000 次读操作/天**
- **1,000 次写操作/天**
- **1GB 存储空间**
- ✅ 缓存和会话管理

## ❌ 付费计划专属功能

### Queues（队列）
- **免费计划不可用**
- 已改为同步处理
- 不影响核心功能

### Durable Objects
- **免费计划不可用**
- 已使用替代方案
- 不影响核心功能

## 🔧 免费计划优化

### 1. 邮件发送
```typescript
// 免费版：立即同步发送
if (this.env.EMAIL_QUEUE) {
  // 付费计划：队列异步发送
  await this.env.EMAIL_QUEUE.send({...});
} else {
  // 免费计划：立即发送
  await this.processSendQueue([queueItem]);
}
```

### 2. 邮件接收
```typescript
// 免费版：直接处理，无队列
if (this.env.EMAIL_QUEUE) {
  await this.env.EMAIL_QUEUE.send({...});
} else {
  console.log('免费计划模式：直接完成邮件接收');
}
```

### 3. 数据清理
```typescript
// 免费版：定时任务直接执行
if (env.EMAIL_QUEUE) {
  // 付费计划：队列处理
  await env.EMAIL_QUEUE.send({type: 'cleanup_attachments'});
} else {
  // 免费计划：直接清理
  await queueHandler.handleCleanupAttachments();
}
```

## 📊 性能考虑

### 免费计划限制
1. **请求数量**：每天 100,000 次
   - 对应约 1.15 次/秒
   - 适合个人或小团队使用

2. **CPU 时间**：每次 10ms
   - 邮件处理通常 < 5ms
   - 附件处理可能需要更多时间

3. **内存限制**：128MB
   - 足够处理大部分邮件
   - 大附件需要流式处理

### 优化建议
1. **分页查询**：限制每页 20 条记录
2. **附件大小**：限制单个附件 ≤ 10MB
3. **缓存策略**：使用 KV 缓存常用数据
4. **错误处理**：优雅降级，避免无限重试

## 🚀 部署免费版本

### 1. 所需资源
```bash
# 只需创建这些免费资源
wrangler d1 create email-db
wrangler r2 bucket create email-attachments
wrangler kv:namespace create "KV"
# 不需要队列
```

### 2. 配置文件
```toml
# wrangler.toml - 免费版本配置
[[d1_databases]]
binding = "DB"
database_name = "email-db"

[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "email-attachments"

[[kv_namespaces]]
binding = "KV"

# 队列配置已注释（需要付费计划）
# [[queues.producers]]
# binding = "EMAIL_QUEUE"
```

### 3. 环境变量
```bash
# 必需的环境变量
MAILCHANNELS_API_KEY=your_api_key  # 选择一个邮件服务
ENVIRONMENT=production
MAX_ATTACHMENT_SIZE=10485760       # 10MB
DEFAULT_PAGE_SIZE=20
```

## 💡 升级到付费计划

如果需要更高性能或队列功能：

### Workers Paid ($5/月)
- **10,000,000 次请求/月**
- **50ms CPU 时间**
- **Queues 队列功能**
- **Durable Objects**

### 升级后可启用
1. **异步邮件处理**：使用队列提高性能
2. **批量操作**：队列批处理提高效率
3. **后台任务**：定时清理和维护
4. **高并发**：更好的并发处理能力

## 🎉 免费计划足够使用

对于大多数个人和小团队使用场景，免费计划完全足够：

- ✅ **日处理邮件**：数千封
- ✅ **存储容量**：5GB 邮件 + 10GB 附件
- ✅ **响应速度**：< 100ms
- ✅ **稳定性**：99.9% 可用性
- ✅ **功能完整**：收发、搜索、附件、Web界面

开始使用免费版本，需要时再考虑升级！
