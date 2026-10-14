function quoteArgument(value: string): string {
  return /^[a-zA-Z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

export function clientCleanupReminder(
  clientNames: string[],
  profile?: { rootDir: string; name: string },
) {
  if (clientNames.length === 0) return undefined;

  return {
    message:
      "客户端不会随 CLI 命令结束自动关闭。测试结束或失败后，请及时关闭不再使用的客户端；只有需要继续运行时才保留。关闭客户端不会删除实例文件或磁盘缓存。",
    stopCommands: [...new Set(clientNames)].map(
      (name) => `mct client stop ${quoteArgument(name)}`,
    ),
    ...(profile
      ? {
          profileStopCommand: `mct --project ${quoteArgument(profile.rootDir)} --profile ${quoteArgument(profile.name)} down`,
        }
      : {}),
  };
}
