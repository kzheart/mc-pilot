export const chatResourcepackGroup = {
  id: "chat-resourcepack",
  title: "聊天、资源包与重连",
  async run(context) {
    const {
      countOccurrences,
      expect,
      readClientLogText,
      recordStep,
      restartEnvironmentWithResourcePack,
      runCli,
      runClientLeaf,
      runSetup,
      scheduleClientCommand,
      summary,
      takeDesktopScreenshot,
      unwrapRequestSuccess,
      waitForLogEntry,
      waitForTeleport
    } = context;

    await runClientLeaf("chat command", ["chat", "command", "mcttp"], async (data) => {
      expect(data.sent === true, "chat command did not report sent");
      const teleported = await waitForTeleport(30);
      recordStep("chat command teleport confirm", teleported.cli, { kind: "verification", position: teleported.position });
    });

    const chatSendToken = `MCT_REAL_CHAT_SEND_${Date.now()}`;
    await runClientLeaf("chat send", ["chat", "send", chatSendToken], async (data) => {
      expect(data.sent === true, "chat send did not report sent");
      await waitForLogEntry(chatSendToken, 30);
    });

    await runClientLeaf("chat history", ["chat", "history", "--last", "10"], (data) => {
      expect(Array.isArray(data.messages), "chat history messages missing");
      expect(data.messages.some((message) => String(message.content ?? "").includes(chatSendToken)), "chat history missing sent token");
    });

    const chatLastToken = `MCT_REAL_CHAT_LAST_${Date.now()}`;
    await runSetup("setup chat last token", ["chat", "send", chatLastToken], async (data) => {
      expect(data.sent === true, "chat last setup send failed");
      await waitForLogEntry(chatLastToken, 30);
    });

    await runClientLeaf("chat last", ["chat", "last"], (data) => {
      expect(String(data.message?.content ?? "").includes(chatLastToken), "chat last did not return latest token");
    });

    const chatWaitToken = `MCT_REAL_CHAT_WAIT_${Date.now()}`;
    const scheduledChat = scheduleClientCommand(["chat", "send", chatWaitToken], 1000);
    await runClientLeaf("chat wait", ["chat", "wait", "--match", chatWaitToken, "--timeout", "7"], async (data) => {
      expect(data.matched === true, "chat wait did not match");
      expect(String(data.message?.content ?? "").includes(chatWaitToken), "chat wait returned unexpected message");
      unwrapRequestSuccess(await scheduledChat);
    });

    await restartEnvironmentWithResourcePack("setup restart before resourcepack reject");
    await runClientLeaf("resourcepack status", ["resourcepack", "status"], (data) => {
      expect(data.acceptanceStatus === "pending", "resourcepack status was not pending after request");
    });

    await runClientLeaf("resourcepack reject", ["resourcepack", "reject"], (data) => {
      expect(data.acceptanceStatus === "declined", "resourcepack reject did not decline the request");
    });

    await restartEnvironmentWithResourcePack("setup restart before resourcepack accept");
    await runClientLeaf("resourcepack status", ["resourcepack", "status"], (data) => {
      expect(data.acceptanceStatus === "pending", "resourcepack status was not pending before accept");
    });
    await runClientLeaf("resourcepack accept", ["resourcepack", "accept"], (data) => {
      expect(data.acceptanceStatus === "allowed", "resourcepack accept did not allow the request");
    });
    const reconnectCount = countOccurrences(await readClientLogText(), "Connecting to 127.0.0.1, 25565");
    await runClientLeaf("client reconnect", ["client", "reconnect"], (data) => {
      expect(data.connecting === true, "client reconnect did not start");
    });
    await context.waitForClientLogCountIncrease("Connecting to 127.0.0.1, 25565", reconnectCount, 30);
    const reconnectGui = await runCli(["--client", "real", "gui", "info"], { allowFailure: true });
    recordStep("client reconnect gui info", reconnectGui, {
      kind: "verification",
      verifiedData: reconnectGui.json?.data?.data ?? null
    });

    const finalDesktopShot = await takeDesktopScreenshot("client-after-full-real-test");
    summary.screenshots.push(finalDesktopShot);
  }
};
