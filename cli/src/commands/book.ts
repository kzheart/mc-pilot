import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createBookCommand() {
  const command = new Command("book").description("Book and quill operations (must hold a writable book)");

  command.command("read").description("Read book contents").action(createRequestAction("book.read", () => ({})));

  command
    .command("write")
    .description("Write book pages")
    .requiredOption("--pages <pages...>", "Page contents, e.g. --pages \"Page 1 text\" \"Page 2 text\"")
    .action(createRequestAction("book.write", ({ options }) => ({ pages: options.pages })));

  command
    .command("sign")
    .description("Sign and close the book")
    .requiredOption("--title <title>", "Book title")
    .requiredOption("--author <author>", "Author name")
    .action(
      createRequestAction("book.sign", ({ options }) => ({
        title: options.title,
        author: options.author
      }))
    );

  return command;
}
