declare module 'ali-oss' {
  type OssPutResponse = {
    name?: string;
    url?: string;
    res?: { status?: number };
    [key: string]: unknown;
  };
  type OssClient = {
    put(
      name: string,
      file: Buffer | string,
      options?: Record<string, unknown>,
    ): Promise<OssPutResponse>;
    putStream(
      name: string,
      stream: unknown,
      options?: Record<string, unknown>,
    ): Promise<OssPutResponse>;
    delete(name: string): Promise<unknown>;
    signatureUrl(name: string, expires?: number): string;
    list(query?: Record<string, unknown>): Promise<unknown>;
    [key: string]: unknown;
  };
  const OSS: new (options: Record<string, unknown>) => OssClient;
  export default OSS;
}
