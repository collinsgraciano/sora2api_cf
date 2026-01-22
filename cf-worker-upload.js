/**
 * Cloudflare Worker - Sora Upload Proxy
 * 
 * 该 Worker 用于代理图片上传请求到 Sora API
 * 支持将 base64 编码的图片转发为 multipart/form-data 格式
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard (https://dash.cloudflare.com)
 * 2. 点击 "Workers & Pages"
 * 3. 点击 "Create Application" -> "Create Worker"
 * 4. 将此代码粘贴到编辑器中
 * 5. 点击 "Save and Deploy"
 * 6. 复制生成的 Worker URL（例如：https://your-worker.your-subdomain.workers.dev）
 * 7. 在 Sora2API 管理界面中配置该 URL
 */

export default {
    async fetch(request, env, ctx) {
        // 处理 CORS 预检请求
        if (request.method === "OPTIONS") {
            return handleCORS();
        }

        const url = new URL(request.url);

        // 路由处理
        if (url.pathname === "/upload" && request.method === "POST") {
            return handleUpload(request);
        }

        // 健康检查端点
        if (url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
        });
    }
};

/**
 * 处理 CORS 预检请求
 */
function handleCORS() {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400"
        }
    });
}

/**
 * 处理图片上传请求
 * 
 * 请求格式：
 * {
 *   "image_data": "base64编码的图片数据",
 *   "filename": "image.png",
 *   "token": "Bearer token",
 *   "target_url": "https://sora.chatgpt.com/backend/uploads"
 * }
 */
async function handleUpload(request) {
    try {
        const data = await request.json();
        const { image_data, filename, token, target_url } = data;

        // 参数验证
        if (!image_data || !filename || !token || !target_url) {
            return jsonResponse({ error: "Missing required fields: image_data, filename, token, target_url" }, 400);
        }

        // 解码 base64 图片数据
        const binaryStr = atob(image_data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        // 检测 MIME 类型
        let mimeType = "image/png";
        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg")) {
            mimeType = "image/jpeg";
        } else if (lowerFilename.endsWith(".webp")) {
            mimeType = "image/webp";
        } else if (lowerFilename.endsWith(".gif")) {
            mimeType = "image/gif";
        }

        // 构建 multipart/form-data
        const formData = new FormData();
        formData.append("file", new Blob([bytes], { type: mimeType }), filename);
        formData.append("file_name", filename);

        // 转发请求到 Sora API
        const response = await fetch(target_url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "User-Agent": "Sora/1.2026.007 (Android 15; 24122RKC7C; build 2600700)"
            },
            body: formData
        });

        // 获取响应内容
        const responseText = await response.text();
        let responseData;

        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = { raw_response: responseText };
        }

        // 返回结果
        return jsonResponse(responseData, response.status);

    } catch (error) {
        console.error("Upload error:", error);
        return jsonResponse({
            error: "Upload failed",
            message: error.message
        }, 500);
    }
}

/**
 * 生成 JSON 响应
 */
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
