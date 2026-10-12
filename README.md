# HNova Portal

个人 Web 导航与服务入口。首版面向单用户、本机或可信内网的自托管环境。

## 运行

需要 Node.js 22 及以上。Windows 用户可直接双击项目根目录的 **`start-portal.cmd`**。首次启动会安装依赖、执行生产构建并创建本地数据库，然后在浏览器打开 Portal。保持命令窗口开启，关闭窗口即停止服务。

```powershell
npm install
npm run dev
```

开发地址为 `http://127.0.0.1:43100`。生产构建及运行：

```powershell
npm run build
npm start
```

生产地址为 `http://127.0.0.1:43100`。SQLite 默认位于 `data/portal.db`，可用 `HNOVA_DB_PATH` 指定绝对路径。请定期备份数据库和主密码；主密码丢失后加密数据无法恢复。

一键启动脚本会自动补充 HNova Portal、Atlas、Muse、Play、Reader、Archive、TrainEcho 七个本机入口。手动使用 `npm run dev` 或 `npm start` 时，可运行 `npm run seed:services` 添加入口；脚本只补缺少的服务，不覆盖已编辑的记录。GitHub 源码压缩包只包含 Portal 项目；其他六个项目需要分别放在 Portal 同级目录，才能使用网页上的启动按钮。

`node_modules` 由 `npm ci` 自动安装，不包含在 GitHub 源码压缩包中。当前 Windows 安装约 417 MiB，主要是 Next.js 及其原生编译组件、图标库和 TypeScript。源码包运行时需要本机完成构建，因此请保留依赖目录；再次启动不会重复安装。

在「服务」页面可启动 Atlas、Muse、TrainEcho 网页服务，以及 Play、Reader、Archive Windows 桌面程序。前三者启动已有构建版本，需先在对应项目完成构建；后三者需已有 exe。启动操作仅对本机固定项目开放，Portal 自身仍通过 `start-portal.cmd` 启动。桌面程序没有网页地址，请使用「启动应用」按钮。关闭 Portal 不会自动停止已启动的项目。

## 功能

- 网站：像 Edge 收藏夹一样用文件夹管理，支持文件夹嵌套、拖动归档、搜索、多选移动和拖动删除。添加网站只需名称与 URL，也可填写描述和图标并设置收藏。已有 Collection 会自动迁入同名文件夹。
- 公开网站自动尝试 favicon，也可在编辑网站时填写图标 URL；加载失败时显示通用网站图标。
- Services：设备与其服务、Host、端口、协议、路径和环境。
- 已导入：Chrome/Edge 本机资料发现与只读预览、HTML 书签预览、保守 URL 去重和导入历史；书签按浏览器、资料和原有路径形成嵌套文件夹。支持多选后移至网站或私密的指定文件夹。
- 私密：使用主密码解锁后保存加密网址，同样支持嵌套文件夹、拖动和批量管理。
- Protected Area：Imported 与 Private 共用主密码和加密服务；手动锁定、5/10/30 分钟自动锁定；锁定时从搜索及组件状态中清除明文。
- Ctrl+K：搜索网站、服务和当前已解锁的加密网址，也支持 Alias。
- Light、Dark、System 主题。

## 安全边界

主密码只在浏览器使用。客户端用 Argon2id (`t=3`, `m=65536 KiB`, `p=1`) 派生 AES-256-GCM 密钥，每条加密记录独立随机 96 位 nonce。数据库中的保护区项目只保存类型、密文、nonce、加密版本及时间戳，不保存网址、名称、文件夹或资料名。保险库配置保存随机 salt 与加密验证值。锁定时清除 React 中的已解密列表、搜索查询、导入预览及 CryptoKey 引用。

本项目的 API 只允许 `127.0.0.1`/`localhost` 的约定端口，并校验请求 Origin；启动脚本也绑定 `127.0.0.1`。它**没有公网账号认证**。若以后需要公网部署，必须先增加 HTTPS、登录鉴权、会话安全、CSRF 防护和速率限制。不要将现有服务直接暴露到公网。

Chrome/Edge 导入服务只枚举本机用户目录中 `Default` 与 `Profile N` 的 Bookmarks 文件，在内存中读取副本后解析；不会写回浏览器文件。HTML 文件在浏览器中解析。导入预览仍会短暂进入当前浏览器内存；本机浏览器 API 也会在预览响应中传输明文，因此仅适用于可信本机环境。

## 设计文档

参见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
