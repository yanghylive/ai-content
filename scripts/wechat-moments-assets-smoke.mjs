#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const command = path.join(root, "vendor/skillhub/wechat-moments-publish/wechat-moments-publish.sh");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-moments-assets-"));

function touch(name) {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, "x");
  return filePath;
}

function runCase(name, assets, expectedOk, expectedText = "") {
  const result = spawnSync(command, ["素材规则校验", "validate-only", assets.join("\n")], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = expectedOk ? result.status === 0 : result.status !== 0;
  const textOk = expectedText ? output.includes(expectedText) : true;
  return {
    ok: ok && textOk,
    name,
    status: result.status,
    output,
  };
}

const images = Array.from({ length: 9 }, (_, index) => touch(`image-${index + 1}.jpg`));
const tooManyImages = [...images, touch("image-10.png")];
const video = touch("video-1.mp4");
const secondVideo = touch("video-2.mov");
const unsupported = touch("archive.zip");

const results = [
  runCase("9 images pass", images, true, '"status":"validated"'),
  runCase("10 images fail", tooManyImages, false, "朋友圈图片最多支持 9 个素材"),
  runCase("1 video pass", [video], true, '"videoCount":1'),
  runCase("2 videos fail", [video, secondVideo], false, "朋友圈视频最多支持 1 个素材"),
  runCase("mixed image video fail", [images[0], video], false, "不能同时混选图片和视频"),
  runCase("unsupported type fail", [unsupported], false, "不支持的朋友圈素材类型"),
];

const failed = results.filter((item) => !item.ok);
console.log("朋友圈素材规则 smoke");
console.log(`root: ${root}`);
console.log(`passed: ${results.length - failed.length}`);
console.log(`failed: ${failed.length}`);
if (failed.length) {
  for (const item of failed) {
    console.log(`- ${item.name}: status=${item.status} output=${item.output}`);
  }
  process.exitCode = 1;
}
