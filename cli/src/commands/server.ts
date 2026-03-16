import { Command } from "commander";

import { wrapCommand } from "../util/command.js";
import { ServerManager } from "../server/ServerManager.js";

export function createServerCommand() {
  const command = new Command("server").description("管理 Paper 服务端");

  command
    .command("start")
    .description("启动 Paper 服务端")
    .option("--jar <path>", "Paper jar 路径")
    .option("--dir <path>", "服务端目录")
    .option("--port <number>", "服务端端口", Number)
    .option("--eula", "自动同意 EULA")
    .action(
      wrapCommand(async (context, { options }) => {
        const manager = new ServerManager(context);
        return manager.start(options);
      })
    );

  command
    .command("stop")
    .description("停止服务端")
    .action(
      wrapCommand(async (context) => {
        const manager = new ServerManager(context);
        return manager.stop();
      })
    );

  command
    .command("status")
    .description("查看服务端状态")
    .action(
      wrapCommand(async (context) => {
        const manager = new ServerManager(context);
        return manager.status();
      })
    );

  command
    .command("wait-ready")
    .description("等待服务端端口可连接")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      wrapCommand(async (context, { options }: { options: { timeout?: number } }) => {
        const manager = new ServerManager(context);
        return manager.waitReady(options.timeout ?? context.config.timeout.serverReady);
      })
    );

  return command;
}
