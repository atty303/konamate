function desktopExecArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("Desktop entry arguments cannot contain a newline or NUL");
  }
  return `"${value.replace(/([\\`"$])/g, "\\$1").replaceAll("%", "%%")}"`;
}

export function desktopExecLine(
  selfPath: string,
  gameId: string,
  profile: string,
): string {
  return `${desktopExecArgument(selfPath)} run ${
    desktopExecArgument(gameId)
  } --profile ${desktopExecArgument(profile)} --notify %u`;
}
