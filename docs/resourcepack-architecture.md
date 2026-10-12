# 资源包策略与版本适配

## 模块边界

- `client-mod/shared/resourcepack-core/java`：唯一的业务核心，兼容 Java 8，不引用 Minecraft、loader 或 GUI 类型。`ResourcePackPolicy` 负责显式策略、实例策略、已有拒绝偏好的优先级；`ResourcePackLifecycle` 负责资源包状态、聚合、失败与自动重连阻断规则。各构建通过现有 source set 引用同一份源码，不复制实现。
- Yarn 的 `shared/java/.../resourcepack` 与官方命名的 `shared/java-official/.../resourcepack`：Minecraft 接口适配。负责读写服务器设置、识别当前连接、取得原版确认回调，把原版事件转交核心。映射不同的 Minecraft 类型不能直接互相编译，业务规则仍引用共同核心。
- `shared/mixin-resourcepack-*` 和少量版本级 `ConnectScreenMixin`：接入原版连接、确认、下载和资源重载事件。Mixin 方法描述符发生变化时才单独适配；不使用标题文字、按钮顺序或通用反射猜测版本。
- `shared/forge-1.12/.../LegacyResourcePacks`：1.12 的实际 API 桥接。该协议没有现代 UUID 多包与 `required` 字段，也没有现代下载管理器状态事件。它调用原版 `ResourcePackRepository` 下载/加载，使用连接和单次 offer 标识隔离过期回调。1.12 的远程下载 future 不代表资源重载成功，因此原版兼容的网络完成回包仅映射为本地 `unverified`，不会报告 `loaded=true`。URL 校验与本地路径限制单独封装，不能替换为自制下载器。
- CLI：负责统一协议输入、超时和 `wait-ready` 的用户可见结果；不会通过反复点击或盲目重连掩盖下载失败。超时是客户端等待预算，不修改原版资源包网络超时。

## 适配器契约

1. 只有真正开始新连接时才重置状态；原版忽略的重复连接请求不能清空当前下载状态
2. 默认接收，但已有明确拒绝须保留；显式 `accept|prompt|reject` 优先
3. `accepted` 不等于 `loaded`；只有已核实语义的原版加载成功事件才确认已应用。future 必须检查具体语义，HTTP 完成或会吞掉加载失败的 future 均不是应用成功证明
4. 状态和确认操作必须属于当前连接，不能接受旧连接的异步结果
5. 必需包拒绝、下载失败或加载失败不能被自动重连清除；可选包拒绝本身不阻断自动重连
6. 无法可靠观察加载完成的适配器必须返回 `lifecycleSupported: false`，不能伪造就绪
7. 现代 UI 操作调用已捕获的原版资源包确认回调；1.12 使用当前 offer 专属的确认回调并调用原版下载/加载接口。两者都不通过屏幕文本推断

旧 Yarn 版本不能仅靠已有下载管理器计数证明加载完成，因此保留不支持生命周期验证的显式能力标记。1.12 同样返回 `lifecycleSupported: false`：HTTP 完成后的 `unverified` 仅表示已结束可观察的等待，`wait-ready` 必须返回 `resourcePackReadinessVerified: false`，仍需可见纹理验证实际应用。legacy 构建没有可复用的 Mixin/字节码注入入口，不为伪造精确状态新建整套注入机制。1.12 的 saved server 更新也遵循原版：只更新已有列表项，不自动把临时直连地址保存到多人游戏列表。

## 扩展与验证

优先复用现有适配器，只有 Minecraft 类名、签名或语义确实变化时增加入口适配。新增 loader 不应复制策略或状态机。连接入口应核对目标版本字节码，尤其是重复连接 guard 的位置。

共同契约测试入口：`client-mod/tests/run-resourcepack-tests.sh`。legacy 和 mc26 的测试入口复用它或相同核心测试，分别用 Java 8 与 Java 25 检验。连接 hook 结构由 `client-mod/tests/check-resourcepack-connect-hooks.py` 检查。单元测试、构建和实际客户端验证必须分别记录。

真实验证使用隔离服务器、原创可见纹理包和 `scripts/real-resourcepack-smoke.mjs`，同时检查实际 HTTP 下载、屏幕关闭和纹理像素；不能只检查 `allowed` 标志。每个版本/loader 的可获得依赖、编译结果、已运行用例与未测项应分别列出，目录存在不等于支持已验证。
