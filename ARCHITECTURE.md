# HNova Portal 架构

## 推荐架构

Next.js App Router 提供界面和本机 API，SQLite 保存数据。它适合单用户、自托管、低并发场景，部署简单，浏览器书签的本机读取也容易放在 Node 侧。未来若要多用户或公网部署，需要另加身份和权限层。UI 为 React + TypeScript；数据在 `src/lib/db.ts` 初始化，API 在 `src/app/api`，浏览器端保险库在 `src/lib/vault.ts`。

## 数据模型

| 表 | 内容 |
| --- | --- |
| `websites` | 公开 Name、URL、描述、Icon、Tags、Collection、Favorite、Alias |
| `servers` | 设备 Name、Host、Environment、描述 |
| `services` | 可选 `server_id`、Name、Host、Port、Protocol、Path、Tags、Alias |
| `vault` | KDF salt、AES-GCM 加密的验证值及 nonce、版本 |
| `protected_items` | `kind` 为 `imported` 或 `private`；只存密文、nonce、版本、时间 |
| `import_batches` | 来源类别、扫描/新增/跳过数、导入时间，不含书签明文 |

Imported 的 Browser、Profile、原文件夹、名称和 URL 都在加密 payload 内。逻辑上按 Browser → Profile → Folder 分组，批次只用于历史记录。

## 导入管线

1. Windows 上从 `%LOCALAPPDATA%` 对应的 Chrome/Edge User Data 目录发现 `Default` 与 `Profile N`。可读取 `Local State` 中的显示名，但不依赖它判断资料是否存在。
2. 服务端只读 Bookmarks 并复制到内存快照，再解析 URL 节点；HTML 导出由浏览器 DOMParser 解析。
3. 页面预览来源、书签数、文件夹数、与已有网站和解锁项目的重复数。
4. URL 只做主机大小写、默认端口、结尾斜杠的保守规范化；保留 Path 和 Query。支持 Skip、Keep both、Merge 已导入的重复书签。
5. 客户端用主密码派生的密钥加密所有新项，批量写入 `protected_items`，随后写入 `import_batches`。

## 密钥生命周期

第一次设置主密码时生成 16 字节随机 salt，经 Argon2id 派生 256 位密钥；AES-GCM 加密固定验证文本，服务端保存验证密文。解锁时在浏览器派生相同密钥并尝试解密验证文本。CryptoKey 不可导出，仅保存在组件 ref 中；加密记录在解锁期间解密成临时 React 状态。手动或超时锁定清除 ref、明文项目、搜索和导入预览。锁定时全局搜索无保护区记录。这里没有云同步、密码恢复或密码管理器功能。

## 后续扩展

健康检查应由独立本机 Agent 或 Node 后台任务对服务 URL 采样，SQLite 中另存上次结果和时间，避免浏览器 CORS、Mixed Content 和内网限制。首版只显示配置好的服务，不推断在线状态。浏览器双向同步、浏览历史、账号系统、多用户与云同步均不在 MVP 范围。

## 目录

```text
src/app/                页面、样式及 API 路由
src/components/         Portal 交互界面
src/lib/db.ts           SQLite 模型与快照
src/lib/validation.ts   输入、URL 与本机来源校验
src/lib/vault.ts        浏览器端 KDF 与 AES-GCM
data/                   运行时 SQLite 数据（忽略提交）
```
