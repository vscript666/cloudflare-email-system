#!/bin/bash

# 轻量邮箱系统部署脚本

set -e  # 遇到错误时退出

echo "🚀 开始部署轻量邮箱系统..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查必要的工具
check_tools() {
    echo -e "${BLUE}📋 检查必要工具...${NC}"
    
    if ! command -v wrangler &> /dev/null; then
        echo -e "${RED}❌ Wrangler CLI 未安装，请先安装：npm install -g wrangler${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js 未安装${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ 工具检查完成${NC}"
}

# 检查是否已登录 Cloudflare
check_auth() {
    echo -e "${BLUE}🔐 检查 Cloudflare 认证...${NC}"
    
    if ! wrangler whoami &> /dev/null; then
        echo -e "${YELLOW}⚠️  未登录 Cloudflare，请先登录：${NC}"
        wrangler login
    fi
    
    echo -e "${GREEN}✅ 认证检查完成${NC}"
}

# 安装依赖
install_deps() {
    echo -e "${BLUE}📦 安装项目依赖...${NC}"
    npm install
    echo -e "${GREEN}✅ 依赖安装完成${NC}"
}

# 创建 Cloudflare 资源
create_resources() {
    echo -e "${BLUE}🏗️  创建 Cloudflare 资源...${NC}"
    
    # 检查是否需要创建 D1 数据库
    if ! wrangler d1 list | grep -q "email-db"; then
        echo -e "${YELLOW}📊 创建 D1 数据库...${NC}"
        wrangler d1 create email-db
        echo -e "${YELLOW}⚠️  请更新 wrangler.toml 中的 database_id${NC}"
        read -p "按 Enter 继续..."
    else
        echo -e "${GREEN}✅ D1 数据库已存在${NC}"
    fi
    
    # 检查是否需要创建 R2 存储桶
    if ! wrangler r2 bucket list | grep -q "email-attachments"; then
        echo -e "${YELLOW}🗂️  创建 R2 存储桶...${NC}"
        wrangler r2 bucket create email-attachments
    else
        echo -e "${GREEN}✅ R2 存储桶已存在${NC}"
    fi
    
    # 检查是否需要创建 KV 命名空间
    echo -e "${YELLOW}🗄️  创建 KV 命名空间...${NC}"
    wrangler kv:namespace create "KV" || echo -e "${GREEN}✅ KV 命名空间可能已存在${NC}"
    
    # 检查是否需要创建队列
    if ! wrangler queues list | grep -q "email-processing"; then
        echo -e "${YELLOW}📬 创建队列...${NC}"
        wrangler queues create email-processing
    else
        echo -e "${GREEN}✅ 队列已存在${NC}"
    fi
}

# 运行数据库迁移
run_migrations() {
    echo -e "${BLUE}🗃️  运行数据库迁移...${NC}"
    
    # 生产环境迁移
    wrangler d1 migrations apply email-db
    
    echo -e "${GREEN}✅ 数据库迁移完成${NC}"
}

# 配置环境变量
setup_env() {
    echo -e "${BLUE}⚙️  配置环境变量...${NC}"
    
    # 检查邮件发送服务配置
    echo -e "${YELLOW}请选择邮件发送服务：${NC}"
    echo "1) MailChannels (推荐，专为 Cloudflare Workers 设计)"
    echo "2) Resend"
    echo "3) SendGrid"
    echo "4) 跳过配置"
    
    read -p "请选择 (1-4): " choice
    
    case $choice in
        1)
            echo -e "${BLUE}配置 MailChannels...${NC}"
            read -s -p "请输入 MailChannels API Key: " api_key
            echo
            echo "$api_key" | wrangler secret put MAILCHANNELS_API_KEY
            ;;
        2)
            echo -e "${BLUE}配置 Resend...${NC}"
            read -s -p "请输入 Resend API Key: " api_key
            echo
            echo "$api_key" | wrangler secret put RESEND_API_KEY
            ;;
        3)
            echo -e "${BLUE}配置 SendGrid...${NC}"
            read -s -p "请输入 SendGrid API Key: " api_key
            echo
            echo "$api_key" | wrangler secret put SENDGRID_API_KEY
            ;;
        4)
            echo -e "${YELLOW}⚠️  跳过邮件服务配置，稍后可手动配置${NC}"
            ;;
        *)
            echo -e "${RED}❌ 无效选择${NC}"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}✅ 环境变量配置完成${NC}"
}

# 部署 Worker
deploy_worker() {
    echo -e "${BLUE}🚀 部署 Worker...${NC}"
    
    # 构建和部署
    wrangler deploy
    
    echo -e "${GREEN}✅ Worker 部署完成${NC}"
}

# 部署静态文件到 Pages（可选）
deploy_pages() {
    echo -e "${BLUE}🌐 是否部署前端到 Cloudflare Pages？ (y/n)${NC}"
    read -p "选择: " deploy_pages_choice
    
    if [[ $deploy_pages_choice == "y" || $deploy_pages_choice == "Y" ]]; then
        echo -e "${BLUE}📱 部署前端到 Pages...${NC}"
        
        # 检查是否已创建 Pages 项目
        read -p "请输入 Pages 项目名称: " pages_project
        
        wrangler pages project create "$pages_project" || echo -e "${YELLOW}⚠️  项目可能已存在${NC}"
        wrangler pages deploy public --project-name="$pages_project"
        
        echo -e "${GREEN}✅ 前端部署完成${NC}"
    else
        echo -e "${YELLOW}⚠️  跳过前端部署${NC}"
    fi
}

# 验证部署
verify_deployment() {
    echo -e "${BLUE}🔍 验证部署...${NC}"
    
    # 获取 Worker 的 URL
    worker_url=$(wrangler list | grep "cloudflare-email-system" | awk '{print $3}')
    
    if [ -n "$worker_url" ]; then
        echo -e "${GREEN}✅ Worker 部署成功: $worker_url${NC}"
        
        # 测试健康检查端点
        if curl -f "$worker_url/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ 健康检查通过${NC}"
        else
            echo -e "${YELLOW}⚠️  健康检查失败，请检查部署状态${NC}"
        fi
    else
        echo -e "${RED}❌ 无法获取 Worker URL${NC}"
    fi
}

# 显示后续配置步骤
show_next_steps() {
    echo -e "${BLUE}📋 后续配置步骤：${NC}"
    echo
    echo -e "${YELLOW}1. 域名配置：${NC}"
    echo "   - 添加 MX 记录指向 Cloudflare Email Routing"
    echo "   - 配置 SPF/DKIM/DMARC 记录"
    echo
    echo -e "${YELLOW}2. Email Routing 配置：${NC}"
    echo "   - 在 Cloudflare Dashboard 中启用 Email Routing"
    echo "   - 添加路由规则指向你的 Worker"
    echo
    echo -e "${YELLOW}3. 创建用户账户：${NC}"
    echo "   - 使用 API 注册第一个用户"
    echo "   - 测试邮件收发功能"
    echo
    echo -e "${YELLOW}4. 监控配置：${NC}"
    echo "   - 设置告警规则"
    echo "   - 配置日志导出"
    echo
    echo -e "${GREEN}🎉 部署完成！${NC}"
}

# 主执行流程
main() {
    echo -e "${GREEN}=== 轻量邮箱系统部署脚本 ===${NC}"
    echo
    
    check_tools
    check_auth
    install_deps
    create_resources
    run_migrations
    setup_env
    deploy_worker
    deploy_pages
    verify_deployment
    show_next_steps
}

# 错误处理
trap 'echo -e "${RED}❌ 部署过程中发生错误${NC}"; exit 1' ERR

# 运行主函数
main
