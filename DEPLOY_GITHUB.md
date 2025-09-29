# GitHub + Cloudflare Workers 部署指南

## 🚀 快速部署流程

### 1. 上传到 GitHub

#### 创建 GitHub 仓库
1. 登录 [GitHub](https://github.com)
2. 点击右上角的 "+" → "New repository"
3. 填写仓库信息：
   - Repository name: `cloudflare-email-system`
   - Description: `基于 Cloudflare Workers 的轻量邮箱系统`
   - 选择 `Public` 或 `Private`
   - 不要勾选任何初始化选项（README, .gitignore, license）

#### 推送代码到 GitHub
在项目目录中运行以下命令：

```bash
# 设置远程仓库（替换为您的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/cloudflare-email-system.git

# 推送代码
git branch -M main
git push -u origin main
```

### 2. 配置 Cloudflare 密钥

#### 获取 Cloudflare API 信息
1. **API Token**:
   - 访问 https://dash.cloudflare.com/profile/api-tokens
   - 点击 "Create Token"
   - 选择 "Custom token"
   - 设置权限：
     ```
     Account - Cloudflare Workers:Edit
     Account - Account Settings:Read
     Zone - Zone:Read
     Zone - DNS:Edit
     User - User Details:Read
     ```
   - Account Resources: 选择您的账户
   - Zone Resources: 如果有域名，选择对应域名

2. **Account ID**:
   - 在 Cloudflare Dashboard 右侧边栏可以找到
   - 或访问 https://dash.cloudflare.com/ 查看

#### 在 GitHub 中设置 Secrets
1. 进入您的 GitHub 仓库
2. 点击 `Settings` → `Secrets and variables` → `Actions`
3. 点击 `New repository secret` 添加以下密钥：

   | Name | Value | 说明 |
   |------|-------|------|
   | `CLOUDFLARE_API_TOKEN` | 您的 API Token | 用于部署权限 |
   | `CLOUDFLARE_ACCOUNT_ID` | 您的 Account ID | Cloudflare 账户 ID |

### 3. 更新 wrangler.toml 配置

在部署前，需要更新 `wrangler.toml` 中的资源 ID。您可以：

#### 方法 A：手动触发资源创建
1. 在 GitHub 仓库中点击 `Actions` 标签
2. 选择 `Deploy to Cloudflare Workers` 工作流
3. 点击 `Run workflow` → 选择 `setup-resources` 选项
4. 这将自动创建所需的 Cloudflare 资源

#### 方法 B：本地创建资源（如果已配置 wrangler）
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

然后将返回的 ID 更新到 `wrangler.toml` 中：

```toml
[[d1_databases]]
binding = "DB"
database_name = "email-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # 更新这里

[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # 更新这里
```

### 4. 配置邮件发送服务密钥

选择一个邮件发送服务并在 GitHub Secrets 中添加对应的 API 密钥：

#### MailChannels（推荐）
- Secret Name: `MAILCHANNELS_API_KEY`
- 获取方式: https://mailchannels.zendesk.com/

#### Resend
- Secret Name: `RESEND_API_KEY` 
- 获取方式: https://resend.com/api-keys

#### SendGrid
- Secret Name: `SENDGRID_API_KEY`
- 获取方式: https://app.sendgrid.com/settings/api_keys

### 5. 部署流程

#### 自动部署
每次推送到 `main` 分支时会自动触发部署：

```bash
git add .
git commit -m "更新配置"
git push origin main
```

#### 手动部署
1. 在 GitHub 仓库中点击 `Actions`
2. 选择 `Deploy to Cloudflare Workers`
3. 点击 `Run workflow`

### 6. 验证部署

#### 检查部署状态
1. 在 `Actions` 标签中查看工作流执行状态
2. 确保所有步骤都成功完成（绿色✅）

#### 测试 Worker
部署成功后，您的 Worker 将可在以下地址访问：
```
https://cloudflare-email-system.YOUR_SUBDOMAIN.workers.dev
```

测试健康检查端点：
```bash
curl https://cloudflare-email-system.YOUR_SUBDOMAIN.workers.dev/health
```

预期响应：
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2023-12-01T15:30:00Z"
  }
}
```

### 7. 配置自定义域名（可选）

#### 在 Cloudflare Dashboard 中配置
1. 进入 Workers & Pages → 选择您的 Worker
2. 点击 `Settings` → `Triggers`
3. 点击 `Add Custom Domain`
4. 输入您的域名（如：`mail.yourdomain.com`）

#### 更新 wrangler.toml
```toml
[routes]
pattern = "mail.yourdomain.com/*"
zone_name = "yourdomain.com"
```

### 8. 配置邮件路由

#### DNS 设置
在您的域名 DNS 中添加：
```
MX  @  route1.mx.cloudflare.net  (优先级 10)
MX  @  route2.mx.cloudflare.net  (优先级 20)
MX  @  route3.mx.cloudflare.net  (优先级 30)

TXT @  "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

#### Cloudflare Email Routing
1. 在 Cloudflare Dashboard 中选择您的域名
2. 进入 `Email` → `Email Routing`
3. 启用 Email Routing
4. 添加路由规则：
   - Destination: `https://cloudflare-email-system.YOUR_SUBDOMAIN.workers.dev`
   - 或您的自定义域名

### 9. 创建用户账户

使用 API 创建第一个用户：
```bash
curl -X POST https://your-worker-domain/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourdomain.com"}'
```

保存返回的 token 用于后续操作。

### 10. 前端部署（可选）

#### 自动部署到 Cloudflare Pages
前端会自动部署到 Cloudflare Pages，访问地址：
```
https://cloudflare-email-system.pages.dev
```

#### 自定义域名
在 Cloudflare Pages 设置中可以配置自定义域名。

## 🔧 故障排除

### 常见问题

#### 1. 部署失败
- 检查 Secrets 是否正确设置
- 确保 API Token 权限足够
- 查看 Actions 日志了解具体错误

#### 2. 资源 ID 错误
- 确保 `wrangler.toml` 中的资源 ID 正确
- 重新运行资源创建工作流

#### 3. 邮件接收失败
- 检查 DNS MX 记录设置
- 验证 Email Routing 配置
- 确保 Worker 部署成功

#### 4. 邮件发送失败
- 检查邮件服务 API 密钥
- 验证发送域名配置
- 查看 Worker 日志

### 查看日志
```bash
# 本地查看日志（如果已配置 wrangler）
wrangler tail cloudflare-email-system

# 或在 Cloudflare Dashboard 中查看 Real-time Logs
```

### 更新配置
修改配置后重新部署：
```bash
git add .
git commit -m "更新配置"
git push origin main
```

## 📱 后续操作

1. **测试完整流程**：发送测试邮件验证收发功能
2. **配置监控**：设置 Cloudflare Analytics 和告警
3. **备份数据**：定期导出重要数据
4. **性能优化**：根据使用情况调整配置
5. **安全加固**：定期更新 API 密钥和检查安全设置

部署完成后，您就拥有了一个完全托管在 Cloudflare 上的轻量邮箱系统！🎉
