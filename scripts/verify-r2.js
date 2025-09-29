// R2 存储桶验证脚本
// 用于测试 R2 存储桶是否正确配置

export default {
  async fetch(request, env) {
    try {
      // 检查 R2 绑定是否存在
      if (!env.ATTACHMENTS) {
        return new Response(JSON.stringify({
          success: false,
          error: 'R2 存储桶未绑定',
          message: '请在 Worker 设置中绑定 R2 存储桶'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 测试文件上传
      const testKey = `test/${Date.now()}.txt`;
      const testContent = 'This is a test file for R2 configuration verification.';
      
      console.log('正在测试 R2 上传...');
      await env.ATTACHMENTS.put(testKey, testContent, {
        httpMetadata: {
          contentType: 'text/plain'
        }
      });

      // 测试文件读取
      console.log('正在测试 R2 读取...');
      const file = await env.ATTACHMENTS.get(testKey);
      
      if (!file) {
        throw new Error('无法读取刚上传的测试文件');
      }

      const retrievedContent = await file.text();

      // 测试文件删除
      console.log('正在测试 R2 删除...');
      await env.ATTACHMENTS.delete(testKey);

      // 验证删除
      const deletedFile = await env.ATTACHMENTS.get(testKey);

      return new Response(JSON.stringify({
        success: true,
        message: 'R2 存储桶配置验证成功！',
        tests: {
          upload: '✅ 上传测试通过',
          read: '✅ 读取测试通过', 
          delete: deletedFile ? '❌ 删除测试失败' : '✅ 删除测试通过',
          content_match: retrievedContent === testContent ? '✅ 内容匹配' : '❌ 内容不匹配'
        },
        bucket_info: {
          binding_name: 'ATTACHMENTS',
          test_key: testKey,
          content_type: file.httpMetadata?.contentType || 'unknown'
        }
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (error) {
      console.error('R2 验证失败:', error);
      
      return new Response(JSON.stringify({
        success: false,
        error: 'R2 存储桶验证失败',
        message: error.message,
        troubleshooting: [
          '1. 确保在 Cloudflare Dashboard 中启用了 R2',
          '2. 确保创建了名为 "email-attachments" 的存储桶',
          '3. 确保在 Worker 设置中正确绑定了 R2 存储桶',
          '4. 检查 wrangler.toml 中的 R2 配置'
        ]
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
