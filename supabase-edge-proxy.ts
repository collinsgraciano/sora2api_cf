/**
 * Supabase Edge Function - Sora API Proxy
 *
 * 该函数用于代理所有 Sora API 请求
 * 支持通用 API 代理和图片上传代理
 *
 * 部署步骤：
 * 1. 安装 Supabase CLI: npm i supabase --save-dev
 * 2. 初始化项目: npx supabase init（如果尚未初始化）
 * 3. 创建函数目录: mkdir -p supabase/functions/sora-proxy
 * copy supabase-edge-proxy.ts supabase\functions\sora-proxy\index.ts
 * 4. 将此文件保存为: supabase/functions/sora-proxy/index.ts
 * npx supabase login
 * 5. 部署函数: npx supabase functions deploy sora-proxy --no-verify-jwt
 * 6. 复制生成的 URL（例如：https://<project-ref>.supabase.co/functions/v1/sora-proxy）
 * 7. 在 Sora2API 管理界面中配置该 URL
 *
 * 注意：需要设置 --no-verify-jwt 以允许匿名访问
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

/**
 * 处理 CORS 预检请求
 */
function handleCORS(): Response {
    return new Response(null, { headers: corsHeaders });
}

/**
 * 生成 JSON 响应
 */
function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

/**
 * 处理通用 API 代理请求
 *
 * 请求格式：
 * {
 *   "method": "GET" | "POST",
 *   "url": "https://sora.chatgpt.com/backend/...",
 *   "headers": { "Authorization": "Bearer ...", ... },
 *   "body": { ... }  // 可选，仅 POST 请求
 * }
 */
async function handleProxy(request: Request): Promise<Response> {
    try {
        const data = await request.json();
        const { method, url, headers, body } = data;

        // 参数验证
        if (!method || !url) {
            return jsonResponse(
                { error: "Missing required fields: method, url" },
                400
            );
        }

        // 构建请求选项
        const fetchOptions: RequestInit = {
            method: method.toUpperCase(),
            headers: headers || {},
        };

        // 对于 POST 请求，添加请求体
        if (method.toUpperCase() === "POST" && body) {
            fetchOptions.body = JSON.stringify(body);
            // 确保设置 Content-Type
            if (!fetchOptions.headers || !(fetchOptions.headers as Record<string, string>)["Content-Type"]) {
                (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
            }
        }

        // 转发请求到目标 API
        const response = await fetch(url, fetchOptions);

        // 尝试解析响应
        const responseText = await response.text();
        let responseData;

        try {
            responseData = JSON.parse(responseText);
        } catch {
            // 如果不是 JSON，返回原始文本
            responseData = { raw_response: responseText };
        }

        // 返回结果，保持原始状态码
        return jsonResponse(responseData, response.status);
    } catch (error) {
        console.error("Proxy error:", error);
        return jsonResponse(
            {
                error: "Proxy request failed",
                message: error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
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
async function handleUpload(request: Request): Promise<Response> {
    try {
        const data = await request.json();
        const { image_data, filename, token, target_url } = data;

        // 参数验证
        if (!image_data || !filename || !token || !target_url) {
            return jsonResponse(
                {
                    error:
                        "Missing required fields: image_data, filename, token, target_url",
                },
                400
            );
        }

        // 解码 base64 图片数据
        const binaryData = Uint8Array.from(atob(image_data), (c) => c.charCodeAt(0));

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
        formData.append("file", new Blob([binaryData], { type: mimeType }), filename);
        formData.append("file_name", filename);

        // 转发请求到 Sora API
        const response = await fetch(target_url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "Sora/1.2026.007 (Android 15; 24122RKC7C; build 2600700)",
            },
            body: formData,
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
        return jsonResponse(
            {
                error: "Upload failed",
                message: error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
}

// 主路由处理
serve(async (req: Request) => {
    // 处理 CORS 预检请求
    if (req.method === "OPTIONS") {
        return handleCORS();
    }

    const url = new URL(req.url);

    // 路由处理
    if (url.pathname.endsWith("/proxy") && req.method === "POST") {
        return await handleProxy(req);
    }

    if (url.pathname.endsWith("/upload") && req.method === "POST") {
        return await handleUpload(req);
    }

    // 健康检查端点
    if (url.pathname.endsWith("/health")) {
        return jsonResponse({
            status: "ok",
            timestamp: new Date().toISOString(),
        });
    }

    return jsonResponse({ error: "Not Found" }, 404);
});
