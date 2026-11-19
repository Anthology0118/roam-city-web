# Security Policy & Responsible Use

## 安全漏洞披露 (Reporting a Vulnerability)

如果您在 **RoamCity AI** 中发现任何潜在的安全漏洞（例如 SSRF、XSS、Prompt Injection 绕过、未授权访问或依赖安全问题），请**不要**直接在公开 Issue 中披露利用细节。

请通过以下方式负责任地联系维护者：
- 在 GitHub 仓库的 **Security → Advisories → Report a vulnerability** 页面提交私密安全报告；
- 我们会在收到报告后 **72 小时内** 确认并评估修复方案。

## 内置安全防护机制

本项目在代码层内置了多项基础安全防线：
1. **HTTP 安全响应头**：全局注入 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`，防范点击劫持与 MIME 嗅探。
2. **SSRF 端点校验**：对外部 LLM `base_url` 进行协议与目标地址校验，拦截云厂商元数据地址（如 `169.254.169.254`）、链路本地地址与非 HTTP/HTTPS 协议，仅允许可信公网端点或明确配置的本地 Ollama 端口。
3. **API 频控限流（Rate Limiting）**：对 `/api/agent/*`、`/api/bookings`、`/api/guides/ingest` 等写操作与大模型接口实施基于客户端 IP 的滑动窗口限流，防止恶意刷接口与资源耗尽攻击。
4. **敏感信息保护**：严禁将真实 `.env`、`*.db` 或 API Key 提交至 Git 仓库；身份证号、API Key 等敏感字段在 API 响应中均做脱敏处理。
5. **并发安全与防注入**：门票扣减采用数据库乐观锁（`version`）防止并发超卖；前端 Markdown 渲染器零 `dangerouslySetInnerHTML`，杜绝 XSS 注入。

## 合规与免责声明 (Acceptable Use)

- 本项目仅用于**技术学习、个人旅行规划演示与学术研究**，严禁用于任何违法违规用途、恶意爬取、未授权接口探测或滥用第三方大模型 API。
- 如将本项目部署至公网环境，请务必配置反向代理 HTTPS、开启身份鉴权，并妥善保管环境变量中的 API 密钥，切勿直接将未鉴权的测试实例暴露在公网。
