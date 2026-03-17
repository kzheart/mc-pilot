# Minecraft Auto Test 设计文档

## 1. 项目概述

### 1.1 目标

为 Minecraft 插件/Mod 开发者提供自动化测试框架。AI（如 Claude Code）通过 CLI 工具操控真实 Minecraft 客户端，模拟玩家行为，验证插件功能是否正确。

### 1.2 核心理念

- **基于真实客户端**：不实现协议，直接通过 Fabric Mod 操控真实 Minecraft 客户端，天然兼容所有服务端特性
- **AI 驱动**：所有操作通过 CLI 暴露，AI 调用 CLI 命令 + 分析截图/状态数据来完成测试
- **零侵入**：不需要在服务端安装任何辅助插件，被测插件原样部署即可
- **失焦稳定性**：自动化运行时客户端失去窗口焦点也不应弹出“游戏菜单”阻塞后续操作
- **范围收敛**：当前交付只保留直接操控客户端以及自动化断言所需的最小状态读取/同步能力，不提供私有通信或纯诊断接口

### 1.3 不做什么

- 不实现 Minecraft 协议
- 不提供服务端辅助插件
- 不做单元测试框架（MockBukkit 已经覆盖）
- 不做性能测试/压力测试（SoulFire 等工具已覆盖）
- 不提供 Plugin Channel 私有通信调试接口
- 不提供音效/粒子事件诊断接口

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

#### 3.4.12 资源包

```bash
# 获取当前资源包状态
mct resourcepack status

# 接受/拒绝服务器资源包
mct resourcepack accept
mct resourcepack reject
```

#### 3.4.13 高级交互

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

#### 3.4.14 原始输入控制（底层通用能力）

所有高层语义命令（gui click、move、chat 等）底层都基于原始输入实现。AI 也可以直接使用原始输入来处理任何未预见的场景（如 Mod 自定义 UI 框架、特殊交互方式）。

```bash
# ===== 鼠标操作 =====

# 点击屏幕指定像素坐标（默认左键）
mct input click 400 300
mct input click 400 300 --button left
mct input click 400 300 --button right
mct input click 400 300 --button middle

# Shift/Ctrl + 点击
mct input click 400 300 --modifiers shift
mct input click 400 300 --modifiers ctrl,shift

# 双击
mct input double-click 400 300

# 鼠标移动到指定位置（不点击）
mct input mouse-move 400 300

# 鼠标拖拽（从 A 拖到 B）
mct input drag 100 100 400 300 --button left

# 鼠标滚轮
mct input scroll 400 300 --delta -3      # 向下滚 3 格
mct input scroll 400 300 --delta 5       # 向上滚 5 格

# ===== 键盘操作 =====

# 按一下按键（按下并立即释放）
mct input key press W
mct input key press space
mct input key press escape
mct input key press f3
mct input key press enter

# 长按按键（指定持续时间，毫秒）
mct input key hold W --duration 3000          # 长按 W 3 秒
mct input key hold shift --duration 5000      # 长按 Shift 5 秒

# 按下 / 释放（分离控制，用于同时按多个键）
mct input key down W
mct input key down shift
# ... 做其他操作 ...
mct input key up W
mct input key up shift

# 组合键
mct input key combo ctrl c                # Ctrl+C
mct input key combo ctrl shift e          # Ctrl+Shift+E
mct input key combo alt f4                # Alt+F4

# 输入文字（向当前焦点输入字符串，用于聊天框/告示牌/书本等）
mct input type "Hello World"
mct input type "你好世界"                 # 支持 Unicode

# ===== 查询 =====

# 获取鼠标当前位置
mct input mouse-pos

# 获取当前按下的键
mct input keys-down
```

**按键名称映射**：

| 类别 | 按键名 |
|---|---|
| 字母 | `a`-`z` (大小写不敏感) |
| 数字 | `0`-`9` |
| 功能键 | `f1`-`f12` |
| 控制键 | `shift`, `ctrl`, `alt`, `tab`, `escape`, `enter`, `backspace`, `delete` |
| 方向键 | `up`, `down`, `left`, `right` |
| 特殊键 | `space`, `minus`, `equals`, `left-bracket`, `right-bracket`, `slash` |
| MC 绑定 | 也可以使用 MC 按键绑定名：`inventory`(E), `drop`(Q), `sprint`(ctrl), `sneak`(shift), `attack`(鼠标左键), `use`(鼠标右键) |

#### 3.4.15 战斗组合操作

封装常见的战斗场景，内部循环执行底层操作直到条件满足。

```bash
# 持续攻击目标直到死亡
mct combat kill --nearest --type zombie --timeout 30
# 返回: {killed: true, hits: 15, duration: 8.2}

# 杀光范围内所有指定类型实体
mct combat clear --type zombie --radius 15 --timeout 60
# 返回: {killed: 8, duration: 23.5, remaining: 0}

# 走到目标身边并攻击直到死亡
mct combat engage --name "§c黑龙领主" --timeout 180
# 返回: {killed: true, hits: 87, duration: 65.3}

# 持续追击（目标有位移时自动跟随）
mct combat chase --id 12345 --timeout 120

# 拾取范围内所有掉落物
mct combat pickup --radius 5 --timeout 10
# 返回: {picked: [{item: "diamond", count: 3}, ...]}
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
│   ├── InputAction.java          # 原始鼠标/键盘输入（底层通用能力）
│   ├── MovementAction.java       # 移动/视角
│   ├── BlockAction.java          # 方块交互
│   ├── EntityAction.java         # 实体交互
│   ├── InventoryAction.java      # 物品/背包
│   ├── GuiAction.java            # GUI/容器交互
│   ├── ChatAction.java           # 聊天/命令
│   ├── CombatAction.java         # 战斗组合操作（持续攻击/清怪/追击）
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
│   └── ResourcePackQuery.java    # 资源包状态
│
├── capture/                  # 截图模块
│   ├── ScreenCapture.java        # 全屏截图
│   ├── GuiCapture.java           # GUI 截图
│   └── RegionCapture.java        # 区域截图
│
├── listener/                 # 内部状态监听器（供 wait-* 和 query 使用）
│   ├── ChatListener.java        # 聊天消息缓冲
│   └── GuiListener.java         # GUI 状态变化检测
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
| `input.*` | InputAction（底层鼠标/键盘） |
| `move.*` | MovementAction |
| `block.*` | BlockAction |
| `entity.*` | EntityAction |
| `inventory.*` | InventoryAction |
| `gui.*` | GuiAction |
| `chat.*` | ChatAction |
| `combat.*` | CombatAction |
| `sign.*` | SignAction |
| `book.*` | BookAction |
| `vehicle.*` | VehicleAction |
| `craft.*` | CraftAction |
| `query.*` | 对应的 Query 类 |
| `capture.*` | 截图模块 |
| `resourcepack.*` | 资源包操作 |

#### 4.2.3 线程模型

| 线程 | 职责 |
|---|---|
| **Netty EventLoop** | WebSocket 消息收发 |
| **MC 主线程 (Render Thread)** | 所有客户端操作：GUI 点击、发送聊天、移动、截图 |
| **异步工作线程** | 寻路计算、截图文件写入、大数据序列化 |

**规则**：任何读写 MinecraftClient 状态的操作**必须**在主线程执行。截图的帧缓冲读取必须在渲染线程。

### 4.3 各模块 API 详细设计

#### 4.3.1 InputAction（底层通用能力）

所有高层操作的基础。直接模拟鼠标和键盘输入事件注入到 Minecraft 客户端的输入系统。

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `mouseClick(x, y, button, modifiers)` | int x, y, string button, string[] modifiers | `{clicked: bool}` | 在屏幕像素坐标点击 |
| `mouseDoubleClick(x, y)` | int x, y | `{clicked: bool}` | 双击 |
| `mouseMove(x, y)` | int x, y | `{moved: bool}` | 移动鼠标到指定位置 |
| `mouseDrag(fromX, fromY, toX, toY, button)` | int * 4, string button | `{dragged: bool}` | 鼠标拖拽 |
| `mouseScroll(x, y, delta)` | int x, y, int delta | `{scrolled: bool}` | 鼠标滚轮 |
| `keyPress(key)` | string key | `{pressed: bool}` | 按一下按键（按下+释放） |
| `keyHold(key, durationMs)` | string key, int ms | `{held: bool, actualDuration}` | 长按指定时间 |
| `keyDown(key)` | string key | `{down: bool}` | 按下不释放 |
| `keyUp(key)` | string key | `{up: bool}` | 释放按键 |
| `keyCombo(keys)` | string[] keys | `{pressed: bool}` | 组合键 |
| `type(text)` | string text | `{typed: bool}` | 向当前焦点输入文字 |
| `getMousePos()` | - | `{x, y}` | 当前鼠标位置 |
| `getKeysDown()` | - | `{keys: string[]}` | 当前按下的键列表 |

**实现方式**：

通过 GLFW 输入 API 或 Mixin 注入到 Minecraft 的 `Mouse` 和 `Keyboard` 处理类，模拟真实的输入事件。注入点：

- `Mouse.onMouseButton()` — 鼠标点击
- `Mouse.onCursorPos()` — 鼠标移动
- `Mouse.onMouseScroll()` — 滚轮
- `Keyboard.onKey()` — 按键事件
- `Keyboard.onChar()` — 字符输入（用于 type 文字）

所有输入注入必须在主线程执行。

**keyHold 实现**：在主线程设置按键状态为按下，启动定时器，到时间后释放。期间 MC 正常处理每帧的按键状态（如持续移动）。

#### 4.3.2 MovementAction

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

#### 4.3.3 BlockAction

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

#### 4.3.4 EntityAction

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

#### 4.3.5 InventoryAction

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

#### 4.3.6 GuiAction（最核心）

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

#### 4.3.7 ChatAction

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

#### 4.3.8 HudQuery

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

#### 4.3.9 StatusQuery

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getHealth()` | - | `{health, maxHealth, food, saturation, absorption}` | 生命相关 |
| `getEffects()` | - | `[{id, amplifier, duration, ambient}]` | 药水效果 |
| `getExperience()` | - | `{level, progress, total}` | 经验 |
| `getGameMode()` | - | `{gameMode}` | 游戏模式 |
| `getWorld()` | - | `{name, dimension, difficulty, time, weather}` | 世界信息 |
| `getAll()` | - | 以上所有数据聚合 | 完整状态 |

#### 4.3.10 ScreenCapture

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

#### 4.3.11 CombatAction

封装常见的战斗场景，内部循环调用 MovementAction + EntityAction 直到条件满足。

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `kill(filter, timeout)` | EntityFilter, int ms | `{killed, hits, duration}` | 持续攻击目标直到死亡 |
| `clear(type, radius, timeout)` | string type, double radius, int ms | `{killed, duration, remaining}` | 清光范围内所有指定类型实体 |
| `engage(filter, timeout)` | EntityFilter, int ms | `{killed, hits, duration}` | 走到目标身边并攻击直到死亡 |
| `chase(filter, timeout)` | EntityFilter, int ms | `{killed, hits, duration}` | 持续追击移动中的目标 |
| `pickup(radius, timeout)` | double radius, int ms | `{picked: [ItemDetail]}` | 拾取范围内所有掉落物 |

**内部循环逻辑（以 chase 为例）**：
1. 查找目标实体
2. 计算距离，若超出攻击范围则寻路靠近
3. 到达攻击范围后执行攻击
4. 目标移动则重新寻路
5. 重复直到目标死亡或超时

#### 4.3.12 其他模块

**SignAction**：
- `read(x, y, z)` — 读取告示牌 Text 组件
- `edit(x, y, z, lines)` — 模拟打开告示牌编辑 Screen，注入文字

**BookAction**：
- `read()` — 从当前打开的 BookScreen 读取页面内容
- `write(pages)` — 模拟书与笔编辑
- `sign(title, author)` — 签名

**ResourcePackAction**：
- `getStatus()` — 当前资源包状态
- `accept()` / `reject()` — 响应服务器资源包请求

### 4.4 内部监听器

Mod 内部维护一组监听器用于缓冲实时数据，**不对外推送**，仅供 `wait-*` 和 `query` 类请求内部使用：

| 监听器 | 职责 | 服务的命令 |
|---|---|---|
| `ChatListener` | 维护聊天消息环形缓冲区（默认 500 条） | `chat.history`, `chat.wait`, `chat.last` |
| `GuiListener` | 检测 GUI 打开/关闭/slot 内容变化 | `gui.waitOpen`, `gui.waitUpdate` |

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
│   │   ├── resourcepack.ts         # mct resourcepack *
│   │   ├── craft.ts                # mct craft / anvil / enchant / trade
│   │   ├── input.ts                # mct input（原始鼠标/键盘）
│   │   ├── combat.ts               # mct combat（战斗组合操作）
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
│   │   ├── download/             # 环境搜索与下载
│   │   │   ├── server/           # 服务端下载（Paper/Purpur/Spigot）
│   │   │   └── client/           # 客户端下载（MC本体/Loader/Mod）
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

## 11. 环境搜索与下载

### 11.1 目标

CLI 内置服务端和客户端的搜索、下载、安装能力，用户无需手动寻找和配置依赖，实现开箱即用。

### 11.2 命令设计

```bash
# ===== 服务端 =====

# 搜索可用的服务端版本
mct server search [--type paper|spigot|purpur] [--version <mc-version>]

# 下载服务端 JAR
mct server download [--type paper] [--version 1.20.4] [--build latest] [--dir ./server]

# ===== 客户端 =====

# 搜索可用的客户端 Loader 版本
mct client search [--loader fabric|forge|neoforge] [--version <mc-version>]

# 下载并安装客户端环境
mct client download [--loader fabric] [--version 1.20.4] [--dir ./client]
```

### 11.3 服务端下载

支持三种服务端类型：

| 类型 | API / 工具 | 说明 |
|------|-----------|------|
| **Paper** | `api.papermc.io/v2/projects/paper` | 默认推荐，公开 REST API，直接下载 JAR |
| **Purpur** | `api.purpurmc.org/v2/purpur` | API 风格兼容 Paper，直接下载 JAR |
| **Spigot** | BuildTools (`hub.spigotmc.org`) | 需要下载 BuildTools.jar 并执行编译构建，依赖 Git + Java |

**`mct server search` 输出示例**：

```
Paper:
  1.21.4  (build 170)
  1.20.4  (build 496)
  1.20.1  (build 196)
  1.18.2  (build 388)
  1.16.5  (build 794)
  1.12.2  (build 1620)

Purpur:
  1.21.4  (build 2406)
  1.20.4  (build 2176)
  1.20.1  (build 2062)

Spigot:
  1.21.4, 1.20.4, 1.20.1, 1.18.2, 1.16.5, 1.12.2
  (需要 BuildTools 本地构建)
```

**`mct server download` 流程**：

1. 调用对应 API 获取指定版本的最新 build 号（或使用 `--build` 指定）
2. 下载 JAR 到 `--dir` 指定目录（默认 `./server/`）
3. 下载完成后校验 SHA256（Paper/Purpur 提供）
4. 自动更新 `mct.config.json` 中的 `server.jar` 和 `server.dir`
5. Spigot 特殊处理：下载 BuildTools.jar → 执行 `java -jar BuildTools.jar --rev <version>` → 产出 spigot-x.x.x.jar

### 11.4 客户端下载

客户端环境由三部分组成：

```
┌─────────────────────────────────────────────────┐
│  完整客户端实例                                    │
│                                                  │
│  1. Minecraft 本体    ← Mojang Version Manifest  │
│     (JAR + Libraries + Assets)                   │
│                                                  │
│  2. Mod Loader        ← Fabric / Forge /         │
│     (Loader + 依赖库)    NeoForge Meta API       │
│                                                  │
│  3. MCT Mod JAR       ← 本项目 GitHub Release    │
│                                                  │
│  版本 × Loader = 一个完整的客户端实例               │
└─────────────────────────────────────────────────┘
```

#### 11.4.1 Loader 下载与安装

| Loader | Meta / Maven | 安装方式 |
|--------|-------------|---------|
| **Fabric** | `meta.fabricmc.net/v2` | 下载 Loader JAR + Intermediary，拼接到 classpath，无需额外安装步骤 |
| **Forge** | `files.minecraftforge.net` / Maven | 下载 Installer JAR → 执行 `java -jar forge-installer.jar --installClient`，自动解压 libraries 并 patch 客户端 |
| **NeoForge** | `maven.neoforged.net` | 类似 Forge，下载 Installer 执行安装 |

#### 11.4.2 MCT Mod 分发

通过本项目的 GitHub Release 分发预编译 JAR，按 `{mc-version}-{loader}` 组合命名：

```
mct-client-mod-1.21.4-fabric.jar
mct-client-mod-1.21.4-neoforge.jar
mct-client-mod-1.20.4-fabric.jar
mct-client-mod-1.20.4-forge.jar
mct-client-mod-1.20.1-fabric.jar
mct-client-mod-1.20.1-forge.jar
mct-client-mod-1.18.2-fabric.jar
mct-client-mod-1.18.2-forge.jar
mct-client-mod-1.16.5-fabric.jar
mct-client-mod-1.16.5-forge.jar
mct-client-mod-1.12.2-forge.jar
```

#### 11.4.3 `mct client search` 输出示例

```bash
mct client search --version 1.20.4
```

```
1.20.4:
  Fabric:    ✅  Loader 0.16.10  |  MCT Mod 0.1.0
  Forge:     ✅  Forge 49.0.49   |  MCT Mod 0.1.0
  NeoForge:  ❌  不支持此版本

mct client search --version 1.21.4

1.21.4:
  Fabric:    ✅  Loader 0.16.10  |  MCT Mod 0.1.0
  Forge:     ❌  不支持此版本
  NeoForge:  ✅  NeoForge 21.4.x |  MCT Mod 0.1.0
```

#### 11.4.4 `mct client download` 流程

1. **Java 检测**：检查 `java` 命令可用性和版本，给出明确提示
   - MC 1.16.5: Java 8+
   - MC 1.17~1.20.4: Java 17+
   - MC 1.20.5+: Java 21+
2. **下载 Minecraft 本体**：从 Mojang Version Manifest 下载 client JAR、libraries、assets
3. **安装 Mod Loader**：根据 `--loader` 参数调用对应的安装流程
4. **下载 MCT Mod**：从 GitHub Release 下载对应版本的 MCT Mod JAR，放入 `mods/` 目录
5. **生成启动命令**：根据 Loader 类型生成正确的 classpath 和 mainClass，写入 `mct.config.json` 的 `launchCommand`
6. **更新配置**：自动写入 `mct.config.json` 中的 `clients` 配置

### 11.5 版本兼容矩阵

| MC 版本 | Fabric | Forge | NeoForge | Paper | Purpur | Spigot |
|---------|--------|-------|----------|-------|--------|--------|
| 1.21.x  | ✅     | ❌    | ✅       | ✅    | ✅     | ✅     |
| 1.20.4  | ✅     | ✅    | ❌       | ✅    | ✅     | ✅     |
| 1.20.1  | ✅     | ✅    | ❌       | ✅    | ✅     | ✅     |
| 1.18.2  | ✅     | ✅    | ❌       | ✅    | ❌     | ✅     |
| 1.16.5  | ✅     | ✅    | ❌       | ✅    | ❌     | ✅     |
| 1.12.2  | ❌     | ✅    | ❌       | ✅    | ❌     | ✅     |

`search` 命令展示此兼容矩阵，帮助用户选择可用组合。

### 11.6 缓存与校验

- 所有下载文件缓存在 `~/.mct/cache/`，按类型和版本组织：

```
~/.mct/cache/
├── server/
│   ├── paper/
│   │   ├── 1.20.4-496.jar
│   │   └── 1.21.4-170.jar
│   ├── purpur/
│   └── spigot/
├── client/
│   ├── minecraft/
│   │   ├── 1.20.4/
│   │   │   ├── client.jar
│   │   │   ├── libraries/
│   │   │   └── assets/
│   │   └── 1.21.4/
│   ├── fabric/
│   ├── forge/
│   └── neoforge/
└── mod/
    ├── mct-client-mod-1.20.4-fabric.jar
    └── mct-client-mod-1.20.4-forge.jar
```

- Paper/Purpur 提供 SHA256 校验，下载后自动验证
- Mojang 资源文件自带 hash，按 hash 去重存储
- 重复下载同版本时直接使用缓存，跳过下载

### 11.7 配置联动

下载完成后自动更新 `mct.config.json`，用户无需手动编辑：

```bash
# 下载前
mct.config.json 不存在或为空

# 执行
mct server download --version 1.20.4
mct client download --version 1.20.4 --loader forge

# 下载后自动生成
```

```json
{
  "server": {
    "jar": "./server/paper-1.20.4-496.jar",
    "dir": "./server",
    "port": 25565,
    "jvmArgs": ["-Xmx2G"]
  },
  "clients": {
    "default": {
      "version": "1.20.4",
      "account": "TestPlayer",
      "server": "localhost:25565",
      "wsPort": 25560,
      "launchCommand": ["java", "-XstartOnFirstThread", "-Xmx1024m", "-cp", "...", "net.minecraftforge.fml.loading.FMLClientLaunchProvider", "--gameDir", "./client/minecraft", ...]
    }
  }
}
```

### 11.8 完整使用流程

```bash
# 1. 查看可用版本
mct server search
mct client search --version 1.20.4

# 2. 下载服务端和客户端
mct server download --version 1.20.4
mct client download --version 1.20.4 --loader forge

# 3. 启动测试环境
mct server start --eula
mct server wait-ready
mct client launch default
mct client wait-ready default

# 4. 开始测试
mct chat command "op TestPlayer"
mct chat send "Hello from auto test!"
```

### 11.9 模块架构

```
cli/src/
  ├── download/
  │   ├── index.ts                     # 统一入口
  │   ├── DownloadUtils.ts             # 通用工具：进度条、SHA256 校验、重试
  │   ├── CacheManager.ts              # ~/.mct/cache/ 缓存管理
  │   ├── JavaDetector.ts              # Java 版本检测与提示
  │   ├── VersionMatrix.ts             # 版本兼容矩阵
  │   ├── server/
  │   │   ├── ServerProvider.ts        # 统一接口
  │   │   ├── PaperProvider.ts         # Paper API 交互 + 下载
  │   │   ├── PurpurProvider.ts        # Purpur API 交互 + 下载
  │   │   └── SpigotProvider.ts        # Spigot BuildTools 下载 + 构建
  │   └── client/
  │       ├── MinecraftDownloader.ts   # Mojang Version Manifest → 本体 + libs + assets
  │       ├── LoaderInstaller.ts       # 统一接口
  │       ├── FabricInstaller.ts       # Fabric Meta API → Loader + Intermediary
  │       ├── ForgeInstaller.ts        # Forge Maven → Installer → 安装
  │       ├── NeoForgeInstaller.ts     # NeoForge Maven → Installer → 安装
  │       ├── ModDownloader.ts         # GitHub Release → MCT Mod JAR
  │       └── LaunchCommandBuilder.ts  # 根据 Loader 类型生成启动命令
  └── commands/
      ├── server.ts                    # 扩展 search / download 子命令
      └── client.ts                    # 扩展 search / download 子命令
```

### 11.10 注意事项

1. **Forge 安装需要 Java**：Forge Installer 本身是一个 Java 程序，安装过程需要执行 `java -jar`，因此用户必须预先安装 Java。CLI 在执行前检测 Java 可用性，缺失时给出明确错误提示和安装指引
2. **Spigot BuildTools 的特殊性**：BuildTools 需要 Git + Java 环境，构建过程耗时较长（首次约 10-20 分钟）。CLI 应提示用户预期等待时间，并在构建过程中显示进度
3. **网络环境**：Mojang/Fabric/Forge 资源可能在部分地区下载较慢，后续可考虑支持镜像源配置
4. **磁盘空间**：完整的 Minecraft 客户端实例（含 libraries + assets）约 1-2 GB，CLI 应在下载前提示预计空间占用

---

## 12. 开发计划

### Phase 1 — 核心骨架

- [ ] CLI 骨架（命令解析、WebSocket 客户端、输出格式化）
- [ ] 客户端 Mod 骨架（Fabric 1.20.1，WebSocket Server，消息路由）
- [ ] 原始输入控制（鼠标点击/移动/拖拽、键盘按键/长按/输入文字）
- [ ] 基础操作：连接管理、聊天/命令、位置查询
- [ ] 截图功能

### Phase 2 — GUI 与物品

- [ ] GUI 完整交互（打开/快照/点击/关闭/等待）
- [ ] 背包操作（查询/切换/使用/丢弃）
- [ ] 物品详情读取（NBT/Lore/附魔/自定义模型数据）
- [ ] GUI 截图

### Phase 3 — 移动与战斗

- [ ] 移动控制（方向移动/跳跃/潜行/疾跑）
- [ ] A* 寻路
- [ ] 实体交互（攻击/右键/列表/详情）
- [ ] 方块交互（挖掘/放置/右键/查询）
- [ ] 战斗组合操作（持续攻击/清怪/追击/拾取）

### Phase 4 — HUD 与显示

- [ ] 计分板读取
- [ ] Tab 列表读取
- [ ] BossBar/ActionBar/Title 读取
- [ ] 名牌读取

### Phase 5 — 高级功能

- [ ] 合成/铁砧/附魔台/交易
- [ ] 骑乘/载具控制
- [ ] 告示牌/书本交互
- [ ] 资源包管理

### Phase 6 — 多版本支持

- [ ] Stonecutter + Architectury 构建配置
- [ ] 1.21.x Fabric 适配
- [ ] 1.20.1 Forge 适配
- [ ] 1.21.x NeoForge 适配
- [ ] 1.18.2 / 1.16.5 适配
- [ ] 1.12.2 独立 Forge 项目

### Phase 7 — 环境搜索与下载

- [ ] 下载基础设施（DownloadUtils、CacheManager、JavaDetector）
- [ ] 版本兼容矩阵（VersionMatrix）
- [ ] 服务端下载 — Paper Provider（API 交互 + 下载 + SHA256 校验）
- [ ] 服务端下载 — Purpur Provider
- [ ] 服务端下载 — Spigot Provider（BuildTools 下载 + 构建）
- [ ] `mct server search` / `mct server download` 命令
- [ ] 客户端下载 — Minecraft 本体下载（Mojang Version Manifest → JAR + libraries + assets）
- [ ] 客户端下载 — Fabric Installer（Meta API → Loader + Intermediary）
- [ ] 客户端下载 — Forge Installer（Maven → Installer → 安装）
- [ ] 客户端下载 — NeoForge Installer（Maven → Installer → 安装）
- [ ] 客户端下载 — MCT Mod 下载（GitHub Release）
- [ ] 启动命令生成（LaunchCommandBuilder，按 Loader 类型生成 classpath + mainClass）
- [ ] `mct client search` / `mct client download` 命令
- [ ] 配置联动（下载后自动更新 mct.config.json）

### Phase 8 — CI/CD 与无头模式

- [ ] HeadlessMC 集成
- [ ] Docker 镜像
- [ ] GitHub Actions 模板
- [ ] 服务端进程管理完善

### Phase 9 — 多客户端与编排

- [ ] 多客户端实例管理
- [ ] 客户端间命令路由
- [ ] 等待/同步原语完善
