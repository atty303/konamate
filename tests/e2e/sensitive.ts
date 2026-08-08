const schemeUrlPattern = /konaste\.sdvx:\/\/[^\s]+/g;

export function extractSdvxSchemeUrl(text: string): string | undefined {
  return text.match(schemeUrlPattern)?.at(-1);
}

export function redactSensitive(text: string): string {
  return text
    .replace(schemeUrlPattern, "konaste.sdvx://<redacted>")
    .replace(/([?&]tk=)[^&\s]+/g, "$1<redacted>");
}
