# 新增 Minecraft 版本支持

本文档说明如何在 mc-pilot 中接入新的 Minecraft 游戏版本。完整操作清单见下文；版本表权威来源为 `client-mod/variants.json`，README 中的 Supported Minecraft Versions 表应与其保持同步。

## 判断走哪条构建链

mc-pilot 的 client-mod 目前有两条独立的 Gradle 构建链，按游戏版本时代划分：

| 时代 | 版本范围 | 构建根目录 | 工具链 |
|---|---|---|---|
| **yarn 时代** | ≤ 1.21.11 | `client-mod/` | Gradle 8.11 + Architectury Loom 1.13 + yarn 映射 |
| **mojmap 时代** | 26.x 起（游戏不混淆、官方命名） | `client-mod/mc26/` | Gradle 9.5.1 + Architectury Loom 1.17 + `fabric.loom.disableObfuscation=true`、无 `mappings` 块 |

**判断规则：**

- 若目标版本 ≤ 1.21.11 → 走 yarn 链，在 `client-mod/` 下创建 `version-<mc>/` 模块。
- 若目标版本 ≥ 26.x → 走 mojmap 链，在 `client-mod/mc26/` 下创建 `version-<mc>/` 模块，并在 `variants.json` 条目中标注 `gradleBuild: "mc26"`（带此字段的条目会被根构建 `client-mod/settings.gradle.kts` 自动排除）。

### 26.1 官方依赖记录

精确版本 26.1 使用 Java 25。当前官方元数据对应的客户端依赖为 Fabric Loader `0.19.3`、Forge `62.0.9`、NeoForge `26.1.0.19-beta`。Vanilla 服务端存在；Paper Fill v3 与 Purpur v2 均未发布精确 26.1 制品。Spigot 虽存在 `versions/26.1.json`，但 BuildTools `--rev 26.1` 实际生成 `26.1.2-R0.1-SNAPSHOT`，因此版本矩阵必须将 26.1 的 Paper、Purpur、Spigot 都标记为不支持，不能用后续补丁版本制品代替。

核实来源：

- Mojang `version_manifest_v2.json` 与 26.1 version JSON
- Fabric Meta v2 与 Fabric Maven
- Forge `promotions_slim.json` 与 Forge Maven
- NeoForged Maven metadata
- Paper Fill v3、Purpur v2 API
- Spigot `versions/26.1.json`

参照文件：

- yarn 根构建：`client-mod/settings.gradle.kts`、`client-mod/build.gradle.kts`
- mojmap 根构建：`client-mod/mc26/settings.gradle.kts`、`client-mod/mc26/buildSrc/src/main/kotlin/`（约定插件）

## 通用步骤（两条链相同）

### 1. 在 `client-mod/variants.json` 添加条目

为每个 loader（Fabric / Forge / NeoForge）各加一条 variant。字段说明如下：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一标识，格式 `<mc>-<loader>`，如 `26.2-fabric` |
| `minecraftVersion` | 是 | 游戏版本号，如 `26.2` |
| `loader` | 是 | `fabric` / `forge` / `neoforge` |
| `support` | 是 | 支持状态：`configured`（已配置未验证）→ `ready`（可用） |
| `validation` | 是 | 验证状态：`planned`（计划验证）→ `verified`（真机通过）/ `limited`（有限验证） |
| `modVersion` | 是 | mod 发布版本，与现有条目保持一致 |
| `javaVersion` | 是 | 编译与运行所需的 JDK 主版本号 |
| `gradleModule` | 是 | Gradle 子模块名，如 `version-26.2-forge` |
| `fabricLoaderVersion` | Fabric 必填 | Fabric Loader 版本，从 [Fabric Maven](https://maven.fabricmc.net/) 实查 |
| `forgeVersion` | Forge 必填 | Forge 版本，从 [MinecraftForge Maven](https://maven.minecraftforge.net/) 实查 |
| `neoforgeVersion` | NeoForge 必填 | NeoForge 版本，从 [NeoForged Maven](https://maven.neoforged.net/) 实查 |
| `yarnMappings` | yarn 时代 Fabric 必填 | yarn 映射坐标，如 `1.21.11+build.5` |
| `yarnForgePatch` | yarn 时代 Forge 选填 | Forge yarn 补丁映射 |
| `yarnNeoforgePatch` | yarn 时代 NeoForge 选填 | NeoForge yarn 补丁映射 |
| `mappings` | mojmap 时代必填 | 固定值 `"mojang"` |
| `gradleBuild` | mojmap 时代必填 | 固定值 `"mc26"`（26.x 条目必带；根构建据此排除） |

**初始状态：** 新条目设 `support: "configured"`、`validation: "planned"`。真机冒烟全部通过后，翻正为 `support: "ready"`、`validation: "verified"`（或 `limited`，视验证深度而定）。

参照蓝本：`client-mod/variants.json` 中 `26.2-fabric` / `1.21.11-fabric` 条目。

同时在 `versions` 数组头部（或按 semver 顺序）加入新的 `minecraftVersion` 字符串。

### 2. 同步 CLI 侧的 variants 副本

```bash
cp client-mod/variants.json cli/data/variants.json
diff client-mod/variants.json cli/data/variants.json   # 必须无输出
```

两份文件必须逐字节一致；CLI 的 mod 下载与变体选择逻辑读取 `cli/data/variants.json`。

### 3. 更新 CLI 版本矩阵

在 `cli/src/download/VersionMatrix.ts` 的 `VERSION_MATRIX` 数组**头部**插入新版本的 `MinecraftSupportEntry`：

- `paper.latestBuild`：从 [fill.papermc.io v3 API](https://fill.papermc.io/v3/projects/paper) 实查对应 MC 版本的最新 build 号。
- `purpur.latestBuild`：从 [purpurmc.org v2 API](https://api.purpurmc.org/v2/purpur) 实查。
- `clients` 下三个 loader 的 `loaderVersion`、`validation` 与 `variants.json` 保持一致。

同步更新测试断言：

- `cli/src/download/VersionMatrix.test.ts` — 矩阵条目总数、各版本字段。
- `cli/src/download/SearchCommand.test.ts` — 搜索结果的矩阵计数断言。

### 4. 创建版本模块

见下文「yarn 时代」与「mojmap 时代」分链说明。创建完成后分别验证编译：

```bash
# yarn 链
cd client-mod && ./gradlew :version-<mc>:build :version-<mc>-forge:build :version-<mc>-neoforge:build

# mojmap 链
cd client-mod/mc26 && ./gradlew :version-<mc>:build :version-<mc>-forge:build :version-<mc>-neoforge:build
```

### 5. CI 发布流水线

`.github/workflows/release.yml` 中：

- **yarn 链**：`Collect mod JARs` 步骤的 `client-mod/version-*/build/libs` glob 已覆盖所有 yarn 时代模块，通常无需修改。
- **mojmap 链**：若已有针对 `client-mod/mc26/version-*/build/libs` 的收集步骤，同样通常无需修改。
- **仅当新版本的 `javaVersion` 超出当前 `setup-java` 已安装的 JDK 列表时**，才需要在 `setup-java` 步骤中追加对应版本（如 26.2 需要 JDK 25）。

### 6. 真机冒烟与状态翻正

在临时项目中完成端到端验证：

```bash
mct init --name mc-<version>-smoke
mct server create srv --type paper --version <mc> --eula
mct client create <loader>-<mc> --version <mc> --loader <loader>
mct up --eula
```

冒烟断言清单：

- `mct chat send "hello"` + `mct chat history --last 3` — 聊天收发
- `mct position` — 坐标回读
- `mct inventory list` — 背包读取
- `mct screenshot` — 截图生成

全部通过后，翻正三处状态：

1. `client-mod/variants.json`（及同步后的 `cli/data/variants.json`）→ `support: "ready"`、`validation: "verified"`
2. `cli/src/download/VersionMatrix.ts` → 对应 loader 的 `validation: "verified"`
3. `README.md` Supported Minecraft Versions 表 → `Supported`（或 `Supported (limited validation)`）

## yarn 时代：版本模块创建

参照 commit：

- `58a3a9a` — 新增 1.21.11（Fabric 主模块 + 版本适配层）
- `97d51f8` — 批量 Forge / NeoForge 薄壳模块

### Fabric 主模块

蓝本：`client-mod/version-1.21.11/build.gradle.kts`

1. 创建 `client-mod/version-<mc>/build.gradle.kts`，挂接 `shared/java` 及对应代际目录（`legacy` 或 `modern`，按版本选择）。
2. 创建 `client-mod/version-<mc>/src/main/java/com/mct/version/impl/` 下的版本适配层四文件：
   - `VersionAdaptersImpl.java`
   - `ScreenshotSupport.java`
   - `KeyboardInvokerBridge.java`
   - `MouseInvokerBridge.java`
3. 复制 `src/main/resources/` 下的 `fabric.mod.json`、`mct.mixins.json` 并按目标版本调整。

### Forge / NeoForge 薄壳

蓝本：

- `client-mod/version-1.21.11-forge/`
- `client-mod/version-1.21.11-neoforge/`

薄壳模块仅包含 loader 入口、mods.toml / neoforge.mods.toml 和 loader 专属 mixin 配置，共享代码由主模块的 `shared/` 代际目录提供。

在 `client-mod/settings.gradle.kts` 中确认新模块已被 `include`（通常由 variants 驱动的动态 include 逻辑自动处理）。

## mojmap 时代：版本模块创建

蓝本：`client-mod/mc26/version-26.2/`

### Fabric 主模块

1. 创建 `client-mod/mc26/version-<mc>/build.gradle.kts`，挂接 `shared/*-official` 代际目录：

   ```
   shared/java-official
   shared/network-official
   shared/registries-official
   shared/mixin-common-official
   shared/mixin-chat-official
   shared/mixin-hud-official
   shared/mixin-sign-official
   shared/mixin-resourcepack-official
   ```

   参照：`client-mod/mc26/version-26.2/build.gradle.kts`

2. 创建版本适配层四文件（路径同上 yarn 时代），**以上一 mojmap 版本（或最近的 yarn 版本经转换后的 official 目录）为蓝本**，逐方法核对官方 API。推荐用官方 `client.jar` 配合 `javap` 核对方法签名。

### Forge / NeoForge 薄壳

蓝本：

- `client-mod/mc26/version-26.2-forge/`
- `client-mod/mc26/version-26.2-neoforge/`

- 入口源码复用 `shared/forge-modern/java` 与 `shared/neoforge/java`
- TOML 模板复用 `shared/forge/resources` 与 `shared/neoforge/resources-toml-modern`

在 `client-mod/mc26/settings.gradle.kts` 中确认新模块已被 `include`（由 `gradleBuild == "mc26"` 过滤逻辑自动处理）。

## 附录：official 代际目录的机械转换方法

26.2 落地时使用过此方法将 yarn 时代的 `shared/*` 源码批量转换为 `shared/*-official`。未来大版本若需再次批量转换，可复用此流程。

### 工具

根构建（`client-mod/`）的 Architectury Loom `migrateMappings` 任务，支持 mojmap 目标映射。

### 命令

```bash
cd client-mod
./gradlew :version-1.21.11:migrateMappings \
  --mappings "net.minecraft:mappings:1.21.11" \
  --input <源目录绝对路径> \
  --output <输出目录绝对路径>
```

示例（将 `shared/mixin-chat-modern` 转为 `shared/mixin-chat-official`）：

```bash
./gradlew :version-1.21.11:migrateMappings \
  --mappings "net.minecraft:mappings:1.21.11" \
  --input "$(pwd)/shared/mixin-chat-modern" \
  --output "$(pwd)/shared/mixin-chat-official"
```

### 说明

- **AST 级源码重映射（Mercury）**：连 mixin 注解字符串（`@Accessor` / `@Inject` 的 `method` 值）一起转换。
- **版本限制**：仅 `--mappings` 指定的 MC 版本可用 mojmap 目标。
- **转换后仍需手修**：
  - 目标版本相对 1.21.11 的 API 漂移（照编译错误逐个收敛）
  - `@Inject` 方法描述符（descriptor）可能与自动转换结果不完全匹配

转换完成并手修后，将输出目录命名为 `shared/<name>-official`，供 mojmap 时代的 `version-<mc>/build.gradle.kts` 引用。
