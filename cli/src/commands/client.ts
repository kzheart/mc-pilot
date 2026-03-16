import { Command } from "commander";

import { ClientManager } from "../client/ClientManager.js";
import { wrapCommand } from "../util/command.js";

export function createClientCommand() {
  const command = new Command("client").description("管理 Minecraft 客户端");

  command
    .command("launch")
    .description("启动客户端")
    .argument("<name>", "客户端名称")
    .option("--version <version>", "Minecraft 版本")
    .option("--server <address>", "目标服务器地址")
    .option("--account <account>", "离线用户名或账号标识")
    .option("--ws-port <port>", "客户端 WebSocket 端口", Number)
    .option("--headless", "以无头模式启动")
    .action(
      wrapCommand(async (context, { args, options }) => {
        const manager = new ClientManager(context);
        return manager.launch({
          name: args[0],
          ...options
        });
      })
    );

  command
    .command("stop")
    .description("停止客户端")
    .argument("<name>", "客户端名称")
    .action(
      wrapCommand(async (context, { args }) => {
        const manager = new ClientManager(context);
        return manager.stop(args[0]);
      })
    );

  command
    .command("list")
    .description("列出客户端状态")
    .action(
      wrapCommand(async (context) => {
        const manager = new ClientManager(context);
        return manager.list();
      })
    );

  command
    .command("wait-ready")
    .description("等待客户端 WebSocket 就绪")
    .argument("<name>", "客户端名称")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      wrapCommand(async (context, { args, options }) => {
        const manager = new ClientManager(context);
        return manager.waitReady(
          args[0],
          (options as { timeout?: number }).timeout ?? context.config.timeout.clientReady
        );
      })
    );

  return command;
}
