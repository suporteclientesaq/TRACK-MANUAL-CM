export function metaApiVersion(): string {
  const v = (process.env.META_API_VERSION || "v25.0").trim();
  return v.startsWith("v") ? v : `v${v}`;
}
