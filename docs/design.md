# Minecraft Auto Test 设计文档

## 1. 项目概述

### 1.1 目标

为 Minecraft 插件/Mod 开发者提供自动化测试框架。AI（如 Claude Code）通过 CLI 工具操控真实 Minecraft 客户端，模拟玩家行为，验证插件功能是否正确。

### 1.2 核心理念

- **基于真实客户端**：不实现协议，直接通过 Fabric Mod 操控真实 Minecraft 客户端，天然兼容所有服务端特性
- **AI 驱动**：所有操作通过 CLI 暴露，AI 调用 CLI 命令 + 分析截图/状态数据来完成测试
- **零侵入**：不需要在服务端安装任何辅助插件，被测插件原样部署即可

### 1.3 不做什么

- 不实现 Minecraft 协议
- 不提供服务端辅助插件
- 不做单元测试框架（MockBukkit 已经覆盖）
- 不做性能测试/压力测试（SoulFire 等工具已覆盖）

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────┐
│  AI (Claude Code)                                │
│                                                  │
│  1. 阅读插件源码/配置，理解功能                     │
│  2. 调用 CLI 命令操控客户端                         │
│  3. 获取截图 + 状态数据                             │
│  4. 判断插件行为是否符合预期                        │
└────────────────────────┬─────────────────────────┘
                         │
                         │  CLI 命令（进程调用）
                         ▼
┌──────────────────────────────────────────────────┐
│  编排器 (mct CLI)                        Node.js │
│                                                  │
│  - 管理 Paper 服务端进程生命周期                   │
│  - 管理多个 Minecraft 客户端实例                   │
│  - 通过 WebSocket 与客户端 Mod 通信               │
│  - 统一的命令路由和结果收集                        │
└────────┬─────────────────────────┬───────────────┘
         │ 进程管理                 │ WebSocket
         ▼                         ▼
┌────────────────┐    ┌────────────────────────────┐
│  Paper Server  │    │  Minecraft 客户端实例       │
│                │    │  + 测试控制 Mod (Fabric)    │
│  被测插件原样  │◄──►│                            │
│  部署,无需改动  │    │  - WebSocket Server        │
│                │    │  - 接收指令,执行玩家操作    │
│                │    │  - 读取客户端状态           │
│                │    │  - 截取屏幕画面             │
│                │    │  - 返回 JSON 结果           │
└────────────────┘    └────────────────────────────┘
```

### 2.1 组件职责

| 组件 | 语言 | 职责 |
|---|---|---|
| **编排器 CLI (mct)** | Node.js (TypeScript) | AI 的唯一调用入口。管理服务端/客户端进程，通过 WebSocket 向客户端 Mod 下发指令，收集结果返回给 AI |
| **客户端测试 Mod** | Java/Kotlin | 嵌入真实 Minecraft 客户端，接收 WebSocket 指令，操控客户端执行各种玩家操作，读取客户端状态，截图 |

### 2.2 通信协议

编排器与客户端 Mod 之间通过 **WebSocket** 通信。

- 客户端 Mod 启动时在本地开启 WebSocket Server（默认端口 `25560`，多实例递增）
- 编排器作为 WebSocket Client 连接
- 所有消息均为 JSON 格式

**请求格式：**

```json
{
  "id": "uuid-v4",
  "action": "gui.click",
  "params": {
    "slot": 13,
    "button": "left"
  }
}
```

**响应格式：**

```json
{
  "id": "uuid-v4",
  "success": true,
  "data": { ... }
}
```

```json
{
  "id": "uuid-v4",
  "success": false,
  "error": "No GUI is currently open"
}
```

**设计原则：所有通信都是请求-响应模式。** CLI 发送请求，Mod 执行操作，返回结果。没有异步事件推送。CLI 的每条命令都是阻塞的，执行完成后才返回。需要等待异步结果的场景（如等待 GUI 打开、等待聊天消息）通过 `wait-*` 类命令实现，这些命令在 Mod 内部阻塞轮询直到条件满足或超时，然后返回结果。

---

## 3. 编排器 CLI 设计

### 3.1 命令结构

```
mct <子命令组> <操作> [参数] [选项]
```

所有命令的输出默认为 **JSON 格式**（方便 AI 解析），通过 `--human` 可切换为人类可读格式。

**所有命令都是阻塞同步的**——执行完成后才返回结果给调用者。AI 按顺序调用命令，每条命令都有明确的 JSON 返回值。

### 3.2 服务端管理

```bash
# 启动 Paper 服务端
mct server start \
  --jar <paper.jar 路径> \
  --dir <服务器目录> \
  --port 25565 \
  --eula                      # 自动同意 EULA

# 停止服务端
mct server stop

# 查看服务端状态
mct server status

# 等待服务端完全启动（阻塞直到可连接）
mct server wait-ready --timeout 120
```

### 3.3 客户端管理

```bash
# 启动客户端并连接到服务器
mct client launch <名称> \
  --version 1.20.4 \
  --server localhost:25565 \
  --account <离线用户名或微软账号> \
  --ws-port 25560 \
  --headless                  # CI 环境无头模式

# 停止客户端
mct client stop <名称>

# 查看所有客户端状态
mct client list

# 等待客户端进入世界（阻塞直到加入服务器）
mct client wait-ready <名称> --timeout 60
```

### 3.4 玩家操作命令

以下所有命令格式：`mct <类别> <操作> [参数]`

多客户端场景通过 `--client <名称>` 指定目标客户端，单客户端场景可省略。

#### 3.4.1 聊天与命令

```bash
# 发送聊天消息
mct chat send "Hello world"

# 执行命令（自动加 /）
mct chat command "gamemode creative"

# 获取最近 N 条聊天记录
mct chat history --last 10

# 等待匹配特定内容的消息出现
mct chat wait --match "传送成功" --timeout 10

# 获取最后一条消息
mct chat last
```

#### 3.4.2 移动与视角

```bash
# 移动到指定坐标（自动寻路）
mct move to 100 64 200

# 向当前朝向前进 N 格
mct move forward 10

# 方向移动
mct move back 5
mct move left 3
mct move right 3

# 跳跃
mct move jump

# 潜行
mct move sneak on
mct move sneak off

# 疾跑
mct move sprint on
mct move sprint off

# 看向坐标
mct look at 100 64 200

# 看向最近的指定类型实体
mct look entity --type villager --nearest

# 设置精确视角
mct look set --yaw 90 --pitch 0

# 获取当前位置
mct position get

# 获取当前朝向
mct rotation get
```

#### 3.4.3 方块交互

```bash
# 破坏方块（模拟完整挖掘过程）
mct block break 10 64 10

# 放置方块
mct block place 10 65 10 --face up

# 右键交互方块（开箱子/按按钮/拉拉杆/使用工作台）
mct block interact 10 64 10

# 查询方块类型
mct block get 10 64 10
```

#### 3.4.4 实体交互

```bash
# 攻击最近的实体
mct entity attack --nearest

# 攻击指定 ID 的实体
mct entity attack --id 12345

# 右键交互实体（NPC 对话/商人交易/宠物操作）
mct entity interact --nearest --type villager
mct entity interact --id 12345

# 获取范围内实体列表
mct entity list --radius 10

# 获取实体详情
mct entity info --id 12345

# 骑乘/下坐骑
mct entity mount --nearest --type horse
mct entity dismount

# 控制载具方向
mct entity steer --forward --left
```

#### 3.4.5 物品/背包

```bash
# 获取完整背包快照
mct inventory get

# 获取指定 slot 物品详情（含 NBT/Lore/附魔/自定义模型数据）
mct inventory slot 0

# 获取当前手持物品
mct inventory held

# 切换快捷栏
mct inventory hotbar 3

# 丢弃手持物品
mct inventory drop
mct inventory drop --all

# 右键使用手持物品（吃食物/喝药水/扔珍珠/用钓鱼竿）
mct inventory use

# 主副手切换
mct inventory swap-hands
```

#### 3.4.6 GUI/容器交互

```bash
# 获取当前打开的 GUI 信息（标题/大小/类型）
mct gui info

# 获取 GUI 所有 slot 物品快照
mct gui snapshot

# 获取指定 slot 物品详情
mct gui slot 13

# 点击 slot
mct gui click 13                        # 左键
mct gui click 13 --button right         # 右键
mct gui click 13 --button shift-left    # Shift+左键
mct gui click 13 --button middle        # 中键
mct gui click 13 --button number --key 1  # 数字键 1
mct gui click 13 --button double        # 双击
mct gui click 13 --button drop          # Q 键丢弃

# 拖拽操作
mct gui drag --slots 0,1,2 --button left   # 左键拖拽分配
mct gui drag --slots 0,1,2 --button right  # 右键拖拽每格放一个

# 关闭 GUI
mct gui close

# 等待 GUI 打开
mct gui wait-open --timeout 5

# 等待 GUI 内容更新（翻页后等）
mct gui wait-update --timeout 3

# GUI 截图
mct gui screenshot --output ./screenshots/shop.png
```

#### 3.4.7 截图与视觉

```bash
# 截取当前完整画面
mct screenshot --output ./screenshots/full.png

# 截取屏幕指定区域
mct screenshot --region 100,100,400,300 --output ./screenshots/region.png

# 截取当前 GUI（如果有打开的 GUI）
mct screenshot --gui --output ./screenshots/gui.png

# 获取屏幕分辨率
mct screen size
```

#### 3.4.8 HUD/显示信息

```bash
# 获取侧边栏计分板
mct hud scoreboard

# 获取 Tab 列表（所有玩家条目 + header/footer）
mct hud tab

# 获取所有活跃 BossBar
mct hud bossbar

# 获取当前 ActionBar 文字
mct hud actionbar

# 获取当前 Title/Subtitle
mct hud title

# 获取指定玩家的头顶名牌
mct hud nametag --player Steve
```

#### 3.4.9 玩家状态

```bash
# 获取生命/饥饿/饱和度
mct status health

# 获取药水效果列表
mct status effects

# 获取经验等级和进度
mct status experience

# 获取当前游戏模式
mct status gamemode

# 获取当前所在世界
mct status world

# 获取所有状态（聚合）
mct status all
```

#### 3.4.10 告示牌

```bash
# 读取指定位置告示牌内容
mct sign read 10 64 10

# 编辑告示牌（打开编辑界面并输入）
mct sign edit 10 64 10 --lines "第一行" "第二行" "第三行" "第四行"
```

#### 3.4.11 书本

```bash
# 读取当前打开的书本内容
mct book read

# 编辑书与笔（打开编辑界面并写入）
mct book write --pages "第一页内容" "第二页内容"

# 签名书本
mct book sign --title "书名" --author "作者"
```

#### 3.4.12 Plugin Channel

```bash
# 发送自定义 Plugin Message
mct channel send "myplugin:test" --data '{"key":"value"}'

# 监听指定频道的消息
mct channel listen "myplugin:test" --timeout 10
```

#### 3.4.13 资源包

```bash
# 获取当前资源包状态
mct resourcepack status

# 接受/拒绝服务器资源包
mct resourcepack accept
mct resourcepack reject
```

#### 3.4.14 音效/粒子

```bash
# 获取最近收到的音效事件
mct effects sounds --last 10

# 获取最近收到的粒子事件
mct effects particles --last 10
```

#### 3.4.15 高级交互

```bash
# 工作台合成（指定 9 宫格物品摆放）
mct craft --recipe '[[null,"diamond",null],[null,"stick",null],[null,"stick",null]]'

# 铁砧操作
mct anvil --input-slot 0 --rename "新名字"

# 附魔台（选择附魔选项）
mct enchant --option 2    # 选择第 2 个附魔选项

# 村民/NPC 交易
mct trade --index 3       # 选择第 3 个交易选项
```

#### 3.4.16 等待与同步

```bash
# 等待指定时间（秒）
mct wait 3

# 等待指定 tick 数
mct wait --ticks 60

# 等待满足条件
mct wait --until-health-above 10 --timeout 30
mct wait --until-gui-open --timeout 5
mct wait --until-on-ground --timeout 10
```

---

## 4. 客户端测试 Mod 设计

### 4.1 模块结构

```
client-mod/
├── core/                     # 核心模块（平台无关）
│   ├── api/                  # 对外 API 定义
│   │   ├── Action.java           # 所有操作的接口定义
│   │   └── Query.java            # 所有查询的接口定义
│   ├── protocol/             # WebSocket 通信协议
│   │   ├── WebSocketServer.java  # WebSocket 服务端
│   │   ├── MessageHandler.java   # 消息路由与分发
│   │   ├── Request.java          # 请求模型
│   │   └── Response.java         # 响应模型
│   └── util/                 # 工具类
│       ├── JsonUtil.java
│       └── ThreadUtil.java       # 线程调度工具
│
├── action/                   # 操作执行器
│   ├── MovementAction.java       # 移动/视角
│   ├── BlockAction.java          # 方块交互
│   ├── EntityAction.java         # 实体交互
│   ├── InventoryAction.java      # 物品/背包
│   ├── GuiAction.java            # GUI/容器交互
│   ├── ChatAction.java           # 聊天/命令
│   ├── SignAction.java           # 告示牌
│   ├── BookAction.java           # 书本
│   ├── VehicleAction.java        # 载具控制
│   └── CraftAction.java         # 合成/铁砧/附魔/交易
│
├── query/                    # 状态查询器
│   ├── PositionQuery.java        # 位置/朝向
│   ├── InventoryQuery.java       # 背包/物品
│   ├── GuiQuery.java             # GUI 状态
│   ├── HudQuery.java             # 计分板/BossBar/ActionBar/Title/Tab/名牌
│   ├── ChatQuery.java            # 聊天历史
│   ├── StatusQuery.java          # 生命/饥饿/效果/经验/游戏模式
│   ├── EntityQuery.java          # 周围实体
│   ├── BlockQuery.java           # 方块信息
│   ├── EffectQuery.java          # 音效/粒子记录
│   └── ResourcePackQuery.java    # 资源包状态
│
├── capture/                  # 截图模块
│   ├── ScreenCapture.java        # 全屏截图
│   ├── GuiCapture.java           # GUI 截图
│   └── RegionCapture.java        # 区域截图
│
├── listener/                 # 内部状态监听器（供 wait-* 和 query 使用）
│   ├── ChatListener.java        # 聊天消息缓冲
│   ├── GuiListener.java         # GUI 状态变化检测
│   ├── SoundListener.java       # 音效事件缓冲
│   └── ParticleListener.java    # 粒子事件缓冲
│
├── pathfinding/              # 寻路模块
│   └── Pathfinder.java           # A* 寻路（moveTo 使用）
│
└── platform/                 # 平台适配层
    ├── VersionAdapter.java       # 版本差异抽象接口
    ├── fabric/                   # Fabric 实现
    ├── forge/                    # Forge 实现
    └── neoforge/                 # NeoForge 实现
```

### 4.2 核心模块详细设计

#### 4.2.1 WebSocket Server

- 使用 Minecraft 内置的 Netty 库实现，零额外依赖
- Mod 初始化时启动，监听指定端口（启动参数配置）
- 所有 MC 操作通过 `MinecraftClient.getInstance().execute()` 调度到主线程
- 异步结果通过 `CompletableFuture` 回传给 WebSocket 线程

```
WebSocket 线程                     MC 主线程
    │                                  │
    │  收到请求 JSON                    │
    │──── execute(() -> { ─────────────►│
    │         执行操作                  │
    │         future.complete(result)   │
    │◄──── }) ─────────────────────────│
    │  future.thenAccept(发送响应)      │
    │                                  │
```

#### 4.2.2 消息路由

MessageHandler 根据 `action` 字段路由到对应的 Action/Query 执行器：

| action 前缀 | 路由目标 |
|---|---|
| `move.*` | MovementAction |
| `block.*` | BlockAction |
| `entity.*` | EntityAction |
| `inventory.*` | InventoryAction |
| `gui.*` | GuiAction |
| `chat.*` | ChatAction |
| `sign.*` | SignAction |
| `book.*` | BookAction |
| `vehicle.*` | VehicleAction |
| `craft.*` | CraftAction |
| `query.*` | 对应的 Query 类 |
| `capture.*` | 截图模块 |
| `channel.*` | Plugin Channel |
| `resourcepack.*` | 资源包操作 |

#### 4.2.3 线程模型

| 线程 | 职责 |
|---|---|
| **Netty EventLoop** | WebSocket 消息收发 |
| **MC 主线程 (Render Thread)** | 所有客户端操作：GUI 点击、发送聊天、移动、截图 |
| **异步工作线程** | 寻路计算、截图文件写入、大数据序列化 |

**规则**：任何读写 MinecraftClient 状态的操作**必须**在主线程执行。截图的帧缓冲读取必须在渲染线程。

### 4.3 各模块 API 详细设计

#### 4.3.1 MovementAction

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `moveTo(x, y, z)` | double x, y, z | `{arrived: bool, finalPos: {x,y,z}, distance: double}` | A* 寻路到目标点，阻塞直到到达或超时 |
| `moveDirection(dir, blocks)` | string dir, double blocks | `{newPos: {x,y,z}}` | 向前/后/左/右移动 |
| `jump()` | - | `{success: bool}` | 跳跃一次 |
| `sneak(enabled)` | bool | `{sneaking: bool}` | 开关潜行 |
| `sprint(enabled)` | bool | `{sprinting: bool}` | 开关疾跑 |
| `swim()` | - | `{success: bool}` | 触发游泳动作 |
| `fly(enabled)` | bool | `{flying: bool}` | 开关创造飞行 |
| `lookAt(x, y, z)` | double x, y, z | `{yaw, pitch}` | 看向坐标 |
| `lookAtEntity(filter)` | EntityFilter | `{yaw, pitch, entityId}` | 看向实体 |
| `setRotation(yaw, pitch)` | float yaw, pitch | `{yaw, pitch}` | 设置精确视角 |
| `getPosition()` | - | `{x, y, z, yaw, pitch, onGround}` | 获取当前位置 |

**寻路实现**：
- 使用 A* 算法，基于客户端已知的方块数据
- 支持跳跃（1 格高差）、游泳、下落
- 不支持挖掘/搭路（纯导航）
- 超时机制：默认 30 秒，可配置

#### 4.3.2 BlockAction

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `breakBlock(x, y, z)` | int x, y, z | `{success, blockType, duration}` | 模拟完整挖掘流程（开始→进度→完成） |
| `placeBlock(x, y, z, face)` | int x, y, z, string face | `{success, placedType}` | 放置手持方块 |
| `interactBlock(x, y, z)` | int x, y, z | `{success, resultAction}` | 右键交互（开箱子/按按钮等） |
| `getBlock(x, y, z)` | int x, y, z | `{type, properties, lightLevel}` | 查询方块信息 |

**挖掘模拟**：
1. 转向目标方块
2. 发送开始挖掘数据包
3. 根据方块硬度和手持工具计算挖掘时间
4. 等待挖掘完成
5. 发送完成挖掘数据包

#### 4.3.3 EntityAction

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `attack(filter)` | EntityFilter | `{success, entityId, entityType}` | 攻击实体 |
| `interact(filter)` | EntityFilter | `{success, entityId, entityType}` | 右键交互 |
| `getEntities(radius)` | double radius | `[{id, type, name, pos, health, distance}]` | 列出范围内实体 |
| `getEntityInfo(id)` | int id | `{id, type, name, pos, health, equipment, effects, nbt}` | 实体详情 |
| `mount(filter)` | EntityFilter | `{success, vehicleId}` | 骑乘实体 |
| `dismount()` | - | `{success}` | 下坐骑 |
| `steer(forward, sideways, jump, sneak)` | float, float, bool, bool | `{newPos}` | 控制载具 |

**EntityFilter**：
```json
{
  "type": "villager",      // 实体类型（可选）
  "name": "Shop NPC",     // 名称匹配（可选，支持正则）
  "nearest": true,         // 最近的（可选）
  "id": 12345,            // 精确 ID（可选）
  "maxDistance": 5.0       // 最大距离（可选）
}
```

#### 4.3.4 InventoryAction

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getInventory()` | - | `{slots: [{slot, item}]}` | 完整背包快照 |
| `getSlot(slot)` | int slot | `ItemDetail` | 指定 slot 物品详情 |
| `getHeldItem()` | - | `ItemDetail` | 当前手持物品 |
| `setHotbar(slot)` | int slot (0-8) | `{selectedSlot, item}` | 切换快捷栏 |
| `drop(all)` | bool all | `{dropped: ItemDetail}` | 丢弃手持物品 |
| `use()` | - | `{success, action}` | 右键使用手持物品 |
| `swapHands()` | - | `{mainHand, offHand}` | 主副手切换 |

**ItemDetail 数据结构**：
```json
{
  "type": "minecraft:diamond_sword",
  "count": 1,
  "displayName": "§6传说之剑",
  "lore": ["§7伤害 +50", "§7暴击率 +10%"],
  "enchantments": [
    {"id": "minecraft:sharpness", "level": 5}
  ],
  "durability": {"current": 1500, "max": 1561},
  "nbt": { ... },
  "customModelData": 10001
}
```

#### 4.3.5 GuiAction（最核心）

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getInfo()` | - | `{title, type, size, syncId}` | 当前 GUI 基本信息 |
| `getSnapshot()` | - | `{title, size, slots: [{slot, item}]}` | GUI 完整快照 |
| `getSlot(slot)` | int slot | `ItemDetail` | 指定 slot 物品 |
| `click(slot, button)` | int slot, ClickButton | `{success, cursorItem}` | 点击 slot |
| `drag(slots, button)` | int[] slots, string button | `{success}` | 拖拽分配 |
| `close()` | - | `{success}` | 关闭 GUI |
| `waitOpen(timeout)` | int ms | `{opened: bool, title, size}` | 等待 GUI 打开 |
| `waitUpdate(timeout)` | int ms | `{updated: bool}` | 等待 GUI 内容变化 |
| `screenshot(path)` | string path | `{path, width, height}` | GUI 截图 |

**ClickButton 枚举**：
- `left` — 左键点击
- `right` — 右键点击
- `shift-left` — Shift + 左键（快速移动）
- `shift-right` — Shift + 右键
- `middle` — 中键（创造模式复制）
- `number-1` ~ `number-9` — 数字键交换
- `double` — 双击（收集同类物品）
- `drop` — Q 键丢弃
- `ctrl-drop` — Ctrl+Q 丢弃整组

**GUI 状态变化检测**：
- 监听 `ScreenHandler` 的 slot 更新回调
- `waitUpdate` 通过比对前后 slot 内容判断是否有变化

#### 4.3.6 ChatAction

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `send(message)` | string | `{sent: bool}` | 发送聊天消息 |
| `command(cmd)` | string | `{sent: bool}` | 发送命令（自动加 `/`） |
| `getHistory(count)` | int count | `[{sender, content, raw, timestamp}]` | 最近 N 条消息 |
| `waitMessage(pattern, timeout)` | string regex, int ms | `{matched: bool, message}` | 等待匹配的消息 |
| `getLastMessage()` | - | `{sender, content, raw, timestamp}` | 最后一条消息 |

**聊天消息捕获实现**：
- 通过 Fabric API 的 `ClientReceiveMessageEvents` 监听所有收到的消息
- 维护一个固定大小的消息环形缓冲区（默认 500 条）
- 每条消息保存：原始 Text 对象（含格式）、纯文本内容、时间戳

#### 4.3.7 HudQuery

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getScoreboard()` | - | `{title, entries: [{name, score}]}` | 侧边栏 |
| `getTabList()` | - | `{header, footer, players: [{name, displayName, latency, gameMode}]}` | Tab 列表 |
| `getBossBars()` | - | `[{name, progress, color, style}]` | 所有 BossBar |
| `getActionBar()` | - | `{text, raw}` | ActionBar 文字 |
| `getTitle()` | - | `{title, subtitle, fadeIn, stay, fadeOut}` | 当前 Title |
| `getNameTag(player)` | string player | `{displayName, prefix, suffix}` | 头顶名牌 |

**实现注意**：
- ActionBar、Title、Subtitle 是临时显示数据，有时效性。通过 Mixin `@Accessor` 访问 `InGameHud` 的私有字段
- Scoreboard 从 `ClientWorld.getScoreboard()` 读取
- Tab 列表从 `PlayerListHud` 读取
- BossBar 从 `BossBarHud` 读取

#### 4.3.8 StatusQuery

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getHealth()` | - | `{health, maxHealth, food, saturation, absorption}` | 生命相关 |
| `getEffects()` | - | `[{id, amplifier, duration, ambient}]` | 药水效果 |
| `getExperience()` | - | `{level, progress, total}` | 经验 |
| `getGameMode()` | - | `{gameMode}` | 游戏模式 |
| `getWorld()` | - | `{name, dimension, difficulty, time, weather}` | 世界信息 |
| `getAll()` | - | 以上所有数据聚合 | 完整状态 |

#### 4.3.9 ScreenCapture

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `screenshot(path)` | string path | `{path, width, height}` | 全屏截图 |
| `screenshotRegion(x, y, w, h, path)` | int x, y, w, h, string path | `{path, width, height}` | 区域截图 |
| `screenshotGui(path)` | string path | `{path, width, height}` | GUI 截图 |
| `getScreenSize()` | - | `{width, height, scaleFactor}` | 屏幕信息 |

**截图实现**：
- 使用 `ScreenshotRecorder.takeScreenshot(framebuffer)` 获取 `NativeImage`
- **必须在渲染线程执行**
- 区域截图：先截全屏再裁剪 NativeImage
- GUI 截图：截全屏或使用离屏 Framebuffer 单独渲染 Screen
- 输出格式：PNG
- 返回文件路径，AI 通过读取文件查看截图

#### 4.3.10 其他模块

**SignAction**：
- `read(x, y, z)` — 读取告示牌 Text 组件
- `edit(x, y, z, lines)` — 模拟打开告示牌编辑 Screen，注入文字

**BookAction**：
- `read()` — 从当前打开的 BookScreen 读取页面内容
- `write(pages)` — 模拟书与笔编辑
- `sign(title, author)` — 签名

**ChannelAction**：
- `send(channel, data)` — 通过 `ClientPlayNetworking.send()` 发送
- `listen(channel, timeout)` — 注册接收回调，等待消息

**ResourcePackAction**：
- `getStatus()` — 当前资源包状态
- `accept()` / `reject()` — 响应服务器资源包请求

**EffectQuery**：
- 维护最近的音效/粒子事件缓冲区
- 通过 Mixin 拦截 `WorldRenderer` 或 `ClientWorld` 的音效/粒子生成方法

### 4.4 内部监听器

Mod 内部维护一组监听器用于缓冲实时数据，**不对外推送**，仅供 `wait-*` 和 `query` 类请求内部使用：

| 监听器 | 职责 | 服务的命令 |
|---|---|---|
| `ChatListener` | 维护聊天消息环形缓冲区（默认 500 条） | `chat.history`, `chat.wait`, `chat.last` |
| `GuiListener` | 检测 GUI 打开/关闭/slot 内容变化 | `gui.waitOpen`, `gui.waitUpdate` |
| `SoundListener` | 缓冲最近收到的音效事件 | `effects.sounds` |
| `ParticleListener` | 缓冲最近收到的粒子事件 | `effects.particles` |

这些监听器在 Mod 初始化时注册，持续运行，数据保存在内存中。当 CLI 发来对应的查询/等待请求时，直接从缓冲区读取或阻塞等待条件满足。

---

## 5. 版本兼容设计

### 5.1 目标版本

| 优先级 | 版本 | Loader | 状态 |
|---|---|---|---|
| **P0** | 1.20.1 | Fabric | 当前最大 Mod 生态 |
| **P0** | 1.21.x (最新) | Fabric | 新一代主力 |
| P1 | 1.20.1 | Forge | Forge 用户覆盖 |
| P1 | 1.21.x | NeoForge | NeoForge 用户覆盖 |
| P2 | 1.18.2 | Fabric | 部分老服务器 |
| P2 | 1.16.5 | Fabric | 部分竞技/小游戏服 |
| P3 | 1.12.2 | Forge | 遗留版本，独立项目 |

### 5.2 构建方案

使用 **Stonecutter + Architectury** 实现单代码库多版本多 Loader 构建。

```
client-mod/
├── settings.gradle.kts         # Stonecutter 版本定义
├── stonecutter.gradle.kts      # 活跃版本切换
├── build.gradle.kts            # Architectury + Stonecutter 构建逻辑
├── src/
│   └── main/
│       ├── java/               # 主代码（含 Stonecutter 条件注释）
│       └── resources/
│           ├── fabric.mod.json
│           ├── META-INF/mods.toml    # Forge/NeoForge
│           └── ...
└── versions/                   # 每个版本变体的覆盖配置
    ├── 1.20.1-fabric/
    ├── 1.20.1-forge/
    ├── 1.21.4-fabric/
    └── 1.21.4-neoforge/
```

### 5.3 版本适配层

需要适配的 API 差异：

| 模块 | 差异点 | 适配方式 |
|---|---|---|
| **聊天** | 1.19+ 签名聊天 vs 旧版 | Stonecutter 条件编译 |
| **GUI/Screen** | 1.20.2 鼠标滚轮参数变化, 1.20.5 ScreenHandler 数据格式变化 | Stonecutter 条件编译 |
| **网络** | 1.20.5 Payload API vs PacketByteBuf | Stonecutter 条件编译 |
| **物品组件** | 1.20.5+ DataComponent vs NBT | Stonecutter 条件编译 |
| **Mod 入口** | Fabric `ModInitializer` vs Forge `@Mod` vs NeoForge `@Mod` | Architectury 平台抽象 |
| **事件系统** | Fabric Events vs Forge/NeoForge EventBus | Architectury 事件抽象 |
| **网络通信** | Fabric Networking API vs Forge SimpleChannel vs NeoForge Payload | Architectury 网络抽象 |

**Stonecutter 条件编译示例**：

```java
public ItemDetail getItemDetail(ItemStack stack) {
    //? if >=1.20.5 {
    // 使用 DataComponent API
    String name = stack.get(DataComponentTypes.CUSTOM_NAME).getString();
    //?} else {
    /*// 使用 NBT API
    String name = stack.getNbt().getString("display").getString("Name");*/
    //?}
}
```

### 5.4 1.12.2 特殊处理

1.12.2 与现代版本差异过大（Forge only，旧注册表，旧渲染管线），作为**独立 Forge Mod 项目**开发，但：

- **对外暴露相同的 WebSocket API**（相同的 JSON 协议）
- 编排器 CLI 无需关心客户端版本差异
- 共享协议定义文件

---

## 6. 编排器 CLI 内部设计

### 6.1 技术栈

- **语言**：TypeScript
- **运行时**：Node.js 20+
- **CLI 框架**：Commander.js
- **WebSocket 客户端**：ws 库
- **进程管理**：child_process

### 6.2 模块结构

```
cli/
├── src/
│   ├── index.ts                # CLI 入口
│   ├── commands/               # 命令定义
│   │   ├── server.ts               # mct server *
│   │   ├── client.ts               # mct client *
│   │   ├── chat.ts                 # mct chat *
│   │   ├── move.ts                 # mct move *
│   │   ├── look.ts                 # mct look *
│   │   ├── block.ts                # mct block *
│   │   ├── entity.ts               # mct entity *
│   │   ├── inventory.ts            # mct inventory *
│   │   ├── gui.ts                  # mct gui *
│   │   ├── screenshot.ts           # mct screenshot
│   │   ├── hud.ts                  # mct hud *
│   │   ├── status.ts               # mct status *
│   │   ├── sign.ts                 # mct sign *
│   │   ├── book.ts                 # mct book *
│   │   ├── channel.ts              # mct channel *
│   │   ├── resourcepack.ts         # mct resourcepack *
│   │   ├── effects.ts              # mct effects *
│   │   ├── craft.ts                # mct craft / anvil / enchant / trade
│   │   └── wait.ts                 # mct wait
│   ├── client/                 # 客户端连接管理
│   │   ├── ClientManager.ts        # 多客户端实例管理
│   │   └── WebSocketClient.ts      # WebSocket 连接封装（请求-响应模式）
│   ├── server/                 # 服务端进程管理
│   │   └── ServerManager.ts        # Paper 进程启停
│   └── util/
│       ├── output.ts               # JSON/人类可读输出格式化
│       └── config.ts               # 配置管理
├── package.json
└── tsconfig.json
```

### 6.3 配置文件

`mct.config.json`（项目根目录）：

```json
{
  "server": {
    "jar": "./server/paper-1.20.4.jar",
    "dir": "./server",
    "port": 25565,
    "jvmArgs": ["-Xmx2G"]
  },
  "clients": {
    "default": {
      "version": "1.20.4",
      "account": "TestPlayer",
      "wsPort": 25560
    }
  },
  "screenshot": {
    "outputDir": "./screenshots"
  },
  "timeout": {
    "serverReady": 120,
    "clientReady": 60,
    "default": 10
  }
}
```

### 6.4 多客户端管理

```bash
# 启动两个客户端
mct client launch player1 --account Player1 --ws-port 25560
mct client launch player2 --account Player2 --ws-port 25561

# 指定客户端执行操作
mct chat send "Hello" --client player1
mct gui click 13 --client player2

# 不指定则使用默认客户端（第一个启动的或配置中的 default）
mct chat send "Hello"
```

---

## 7. 无头模式与 CI 集成

### 7.1 无头运行

使用 **HeadlessMC + Xvfb** 方案：

- HeadlessMC patch LWJGL 使客户端可在无 GPU 环境运行
- Xvfb 提供虚拟帧缓冲，使截图功能正常工作
- Docker 镜像封装完整环境

```dockerfile
FROM eclipse-temurin:21-jdk
RUN apt-get update && apt-get install -y xvfb
# 安装 HeadlessMC、Fabric、测试 Mod
# ...
CMD ["xvfb-run", "--auto-servernum", "mct", "client", "launch", "test", "--headless"]
```

### 7.2 GitHub Actions 集成

```yaml
name: Plugin Test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup test environment
        uses: headlesshq/mc-runtime-test@4.1.0
        with:
          mc: 1.20.4
          modloader: fabric
          xvfb: true
      - name: Run tests
        run: |
          mct server start --jar paper-1.20.4.jar --eula
          mct server wait-ready
          mct client launch test --headless --version 1.20.4
          mct client wait-ready test
          mct chat command "op TestPlayer"
          # ... 测试命令
```

---

## 8. AI 使用示例

### 8.1 测试 AIOShop 商店购买流程

```bash
# AI 执行的命令序列：

# 1. 准备：给玩家金币和 OP
mct chat command "op TestPlayer"
mct chat command "eco give TestPlayer 10000"

# 2. 打开商店
mct chat command "shop"
mct gui wait-open --timeout 5
mct gui screenshot --output ./screenshots/shop-main.png

# 3. AI 看截图，理解菜单布局，决定点击哪个 slot
mct gui snapshot
# 返回 JSON，AI 分析哪个 slot 是目标分类

# 4. 点击"武器"分类
mct gui click 11
mct gui wait-update --timeout 3
mct gui screenshot --output ./screenshots/shop-weapons.png

# 5. 购买钻石剑
mct gui click 13 --button left
mct chat wait --match "购买成功" --timeout 5

# 6. 关闭商店，验证物品
mct gui close
mct inventory get
# AI 检查背包中是否有钻石剑

# 7. 验证余额扣减
mct chat command "balance"
mct chat wait --match "余额" --timeout 3
# AI 检查余额是否正确扣减
```

### 8.2 测试世界保护插件

```bash
# 1. 传送到保护区域内
mct chat command "tp TestPlayer 100 64 100"
mct wait 1

# 2. 尝试破坏方块（应该被阻止）
mct block break 100 64 100
mct chat history --last 3
# AI 检查是否有"你没有权限"之类的消息

# 3. 截图确认方块没有被破坏
mct block get 100 64 100
# AI 确认方块类型没变

# 4. 移到保护区域外，尝试同样操作
mct move to 200 64 200
mct block break 200 64 200
mct block get 200 64 200
# AI 确认方块已被破坏
```

### 8.3 测试 PVPRank 竞技系统

```bash
# 启动两个客户端
mct client launch player1 --account Fighter1 --ws-port 25560
mct client launch player2 --account Fighter2 --ws-port 25561
mct client wait-ready player1
mct client wait-ready player2

# Player1 发起挑战
mct chat command "pvp challenge Fighter2" --client player1
mct chat wait --match "挑战" --timeout 5 --client player2

# Player2 接受
mct chat command "pvp accept" --client player2
mct wait 3

# 验证双方被传送到竞技场
mct position get --client player1
mct position get --client player2
# AI 确认坐标在竞技场范围内

# Player1 攻击 Player2
mct entity attack --nearest --client player1
mct wait 1
mct status health --client player2
# AI 确认 Player2 生命值下降

# 截图记分板
mct screenshot --client player1 --output ./screenshots/pvp-scoreboard.png
mct hud scoreboard --client player1
# AI 验证计分板显示正确
```

---

## 9. 错误处理

### 9.1 CLI 层

所有 CLI 命令遵循统一的错误处理：

| 错误类型 | 退出码 | 说明 |
|---|---|---|
| 成功 | 0 | 正常返回 JSON 结果 |
| 连接失败 | 1 | 无法连接到客户端 WebSocket |
| 超时 | 2 | 操作超时（等待 GUI、等待消息等） |
| 客户端错误 | 3 | 客户端 Mod 返回的业务错误（如"没有打开的 GUI"） |
| 参数错误 | 4 | CLI 参数格式错误 |
| 服务端错误 | 5 | Paper 服务端进程异常 |

**JSON 错误格式**：

```json
{
  "success": false,
  "error": {
    "code": "GUI_NOT_OPEN",
    "message": "No GUI is currently open",
    "details": {}
  }
}
```

### 9.2 客户端 Mod 层

| 错误码 | 说明 |
|---|---|
| `GUI_NOT_OPEN` | 没有打开的 GUI，无法执行 GUI 操作 |
| `SLOT_OUT_OF_RANGE` | slot 索引超出范围 |
| `ENTITY_NOT_FOUND` | 找不到匹配的实体 |
| `BLOCK_OUT_OF_RANGE` | 目标方块超出交互距离 |
| `PATHFINDING_FAILED` | 寻路失败（无法到达目标） |
| `TIMEOUT` | 操作超时 |
| `NOT_IN_WORLD` | 玩家不在世界中（加载中/死亡画面） |
| `INVALID_PARAMS` | 参数格式错误 |

---

## 10. 项目结构总览

```
minecraft-auto-test/
├── docs/
│   └── design.md                 # 本设计文档
│
├── cli/                          # 编排器 CLI
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── commands/
│   │   ├── client/
│   │   ├── server/
│   │   └── util/
│   └── bin/
│       └── mct                   # CLI 入口脚本
│
├── client-mod/                   # 客户端测试 Mod
│   ├── settings.gradle.kts       # Stonecutter 多版本配置
│   ├── stonecutter.gradle.kts
│   ├── build.gradle.kts          # Architectury 构建
│   ├── gradle.properties
│   ├── src/
│   │   └── main/
│   │       ├── java/             # Mod 源码
│   │       │   └── com/mct/
│   │       │       ├── ModEntry.java
│   │       │       ├── core/
│   │       │       │   ├── api/
│   │       │       │   ├── protocol/
│   │       │       │   └── util/
│   │       │       ├── action/
│   │       │       ├── query/
│   │       │       ├── capture/
│   │       │       ├── listener/
│   │       │       ├── pathfinding/
│   │       │       └── platform/
│   │       └── resources/
│   │           ├── fabric.mod.json
│   │           ├── mct.mixins.json
│   │           └── ...
│   └── versions/
│       ├── 1.20.1-fabric/
│       ├── 1.20.1-forge/
│       ├── 1.21.4-fabric/
│       └── 1.21.4-neoforge/
│
├── client-mod-legacy/            # 1.12.2 独立 Forge Mod
│   ├── build.gradle
│   └── src/
│
├── protocol/                     # 共享协议定义
│   ├── actions.json              # 所有 action 的 schema
│   ├── queries.json              # 所有 query 的 schema
│   └── errors.json               # 错误码定义
│
└── examples/                     # 测试用例示例
    ├── shop-test.sh
    ├── worldguard-test.sh
    └── pvp-test.sh
```

---

## 11. 开发计划

### Phase 1 — 核心骨架

- [ ] CLI 骨架（命令解析、WebSocket 客户端、输出格式化）
- [ ] 客户端 Mod 骨架（Fabric 1.20.1，WebSocket Server，消息路由）
- [ ] 基础操作：连接管理、聊天/命令、位置查询
- [ ] 截图功能

### Phase 2 — GUI 与物品

- [ ] GUI 完整交互（打开/快照/点击/关闭/等待）
- [ ] 背包操作（查询/切换/使用/丢弃）
- [ ] 物品详情读取（NBT/Lore/附魔/自定义模型数据）
- [ ] GUI 截图

### Phase 3 — 移动与实体

- [ ] 移动控制（方向移动/跳跃/潜行/疾跑）
- [ ] A* 寻路
- [ ] 实体交互（攻击/右键/列表/详情）
- [ ] 方块交互（挖掘/放置/右键/查询）

### Phase 4 — HUD 与显示

- [ ] 计分板读取
- [ ] Tab 列表读取
- [ ] BossBar/ActionBar/Title 读取
- [ ] 名牌读取

### Phase 5 — 高级功能

- [ ] 合成/铁砧/附魔台/交易
- [ ] 骑乘/载具控制
- [ ] 告示牌/书本交互
- [ ] Plugin Channel
- [ ] 资源包管理
- [ ] 音效/粒子监听

### Phase 6 — 多版本支持

- [ ] Stonecutter + Architectury 构建配置
- [ ] 1.21.x Fabric 适配
- [ ] 1.20.1 Forge 适配
- [ ] 1.21.x NeoForge 适配
- [ ] 1.18.2 / 1.16.5 适配
- [ ] 1.12.2 独立 Forge 项目

### Phase 7 — CI/CD 与无头模式

- [ ] HeadlessMC 集成
- [ ] Docker 镜像
- [ ] GitHub Actions 模板
- [ ] 服务端进程管理完善

### Phase 8 — 多客户端与编排

- [ ] 多客户端实例管理
- [ ] 客户端间命令路由
- [ ] 等待/同步原语完善
