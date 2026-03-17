import { Command } from "commander";

import { ClientManager } from "../client/ClientManager.js";
import { downloadClientMod } from "../download/client/ClientDownloader.js";
import { buildClientSearchResults } from "../download/SearchCommand.js";
import type { ClientLoader } from "../download/VersionMatrix.js";
import { createRequestAction } from "./request-helpers.js";
import { wrapCommand } from "../util/command.js";

export function createClientCommand() {
  const command = new Command("client").description("管理 Minecraft 客户端");

  command
    .command("search")
    .description("搜索可用客户端版本与 Loader 组合")
    .option("--loader <loader>", "客户端 Loader：fabric|forge|neoforge")
    .option("--version <version>", "Minecraft 版本")
    .action(
      wrapCommand(async (_context, { options }: { options: { loader?: ClientLoader; version?: string } }) => {
        return {
          results: buildClientSearchResults({
            loader: options.loader,
            version: options.version
          })
        };
      })
    );

  command
    .command("download")
    .description("下载客户端 Mod 变体并更新配置")
    .option("--loader <loader>", "客户端 Loader：fabric|forge|neoforge")
    .option("--version <version>", "Minecraft 版本")
    .option("--dir <path>", "Mod 下载目录")
    .option("--name <name>", "客户端配置名称")
    .option("--ws-port <port>", "客户端 WebSocket 端口", Number)
    .option("--server <address>", "默认服务器地址")
    .option("--prism-root <path>", "PrismLauncher 根目录")
    .option("--instance-id <id>", "PrismLauncher 实例 ID")
    .action(
      wrapCommand(
        async (
          context,
          {
            options
          }: {
            options: {
              loader?: ClientLoader;
              version?: string;
              dir?: string;
              name?: string;
              wsPort?: number;
              server?: string;
              prismRoot?: string;
              instanceId?: string;
            };
          }
        ) => {
          return downloadClientMod(context, options);
        }
      )
    );

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

  command
    .command("reconnect")
    .description("让当前客户端重新连接到服务器")
    .option("--address <address>", "目标服务器地址，默认使用启动配置中的 server")
    .action(
      createRequestAction("client.reconnect", ({ options }) => ({
        address: options.address
      }))
    );

  return command;
}
