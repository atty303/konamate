const schemeUrlPattern = /konaste\.sdvx:\/\/[^\s]+/g;

export function redactSensitive(text: string): string {
  return text
    .replace(schemeUrlPattern, "konaste.sdvx://<redacted>")
    .replace(/([?&]tk=)[^&\s]+/g, "$1<redacted>")
    .replace(
      /(\s-t\s+)(?:'[^'\n]*(?:'"'"'[^'\n]*)*'|"[^"\n]*"|[^\s]+)/g,
      "$1<redacted>",
    );
}
