#!/bin/bash

# Cloudflare 资源初始化脚本
# 用于一键部署后的资源配置

set -e

echo "🚀 开始初始化 Cloudflare 资源..."

# 创建 D1 数据库
echo "📊 创建 D1 数据库..."
wrangler d1 create email-db || echo "✅ D1 数据库可能已存在"

# 创建 R2 存储桶
echo "🗂️ 创建 R2 存储桶..."
wrangler r2 bucket create email-attachments || echo "✅ R2 存储桶可能已存在"

# 创建 KV 命名空间
echo "🗄️ 创建 KV 命名空间..."
wrangler kv:namespace create "KV" || echo "✅ KV 命名空间可能已存在"

# 创建队列（需要付费计划）
echo "📬 跳过队列创建（需要付费计划）..."
# wrangler queues create email-processing || echo "✅ 队列可能已存在"

# 运行数据库迁移
echo "🗃️ 运行数据库迁移..."
wrangler d1 migrations apply email-db || echo "⚠️ 数据库迁移可能需要手动执行"

echo "✅ 资源初始化完成！"
echo ""
echo "📋 后续步骤："
echo "1. 在 Worker 设置中配置资源绑定"
echo "2. 添加邮件服务 API 密钥"
echo "3. 配置域名和 Email Routing"
echo "4. 测试邮件收发功能"
echo ""
echo "🎉 部署完成！访问您的 Worker URL 开始使用邮箱系统。"
