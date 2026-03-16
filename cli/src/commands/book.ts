import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createBookCommand() {
  const command = new Command("book").description("书本操作");

  command.command("read").description("读取书本").action(createRequestAction("book.read", () => ({})));

  command
    .command("write")
    .description("写入书本页面")
    .requiredOption("--pages <pages...>", "页面列表")
    .action(createRequestAction("book.write", ({ options }) => ({ pages: options.pages })));

  command
    .command("sign")
    .description("签名书本")
    .requiredOption("--title <title>", "书名")
    .requiredOption("--author <author>", "作者")
    .action(
      createRequestAction("book.sign", ({ options }) => ({
        title: options.title,
        author: options.author
      }))
    );

  return command;
}
