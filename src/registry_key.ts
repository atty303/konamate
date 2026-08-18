export type RegistryHive = "HKCU" | "HKLM";

export type RegistryLocation = {
  hive: RegistryHive;
  key: string;
};

const registryPath = /^(HKCU|HKLM)\\([^\r\n\0\[\]]+)$/i;

export function isRegistryKey(key: string): boolean {
  return registryPath.test(key);
}

export function parseRegistryKey(key: string): RegistryLocation {
  const match = registryPath.exec(key);
  if (!match) throw new Error("Registry key must start with HKCU or HKLM");
  return { hive: match[1].toUpperCase() as RegistryHive, key: match[2] };
}
