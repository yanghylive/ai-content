import { api } from "./client";

/** 存储配置（SecretKey/AccessKey 脱敏返回 ********） */
export interface StorageConfigView {
  provider: "local" | "qiniu" | "aliyun-oss";
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  endpoint?: string;
  region?: string;
}

export const storageApi = {
  /** 读取当前存储配置（SecretKey/AccessKey 脱敏） */
  getConfig() {
    return api.get<StorageConfigView>("/storage/config");
  },
  /** 保存存储配置（仅管理员；传入 ******** 表示保留原值） */
  saveConfig(input: StorageConfigView) {
    return api.put<{ success: boolean; message: string }>("/storage/config", input);
  },
  /** 测试对象存储连接（仅管理员） */
  test() {
    return api.post<{ success: boolean; message?: string }>("/storage/config/test");
  },
};
