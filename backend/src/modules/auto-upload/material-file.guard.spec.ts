import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  assertMaterialFileSafe,
  isAllowedMaterialFile,
  isWithinMaterialSizeLimit,
  MAX_MATERIAL_SIZE,
} from './material-file.guard';

describe('material-file.guard（P0 上传安全加固）', () => {
  describe('isAllowedMaterialFile', () => {
    it('放行图片 MIME', () => {
      expect(
        isAllowedMaterialFile({ mimetype: 'image/jpeg', originalname: 'a.jpg' }),
      ).toBe(true);
    });
    it('放行视频 MIME', () => {
      expect(
        isAllowedMaterialFile({
          mimetype: 'video/mp4',
          originalname: 'a.mp4',
        }),
      ).toBe(true);
    });
    it('放行内部导入（octet-stream + 视频扩展名）', () => {
      expect(
        isAllowedMaterialFile({
          mimetype: 'application/octet-stream',
          originalname: 'web-12345.mp4',
        }),
      ).toBe(true);
    });
    it('拒绝恶意文件（text/php + 无扩展名或伪扩展名）', () => {
      expect(
        isAllowedMaterialFile({
          mimetype: 'text/php',
          originalname: 'shell.php',
        }),
      ).toBe(false);
      expect(
        isAllowedMaterialFile({ mimetype: 'application/x-msdownload', originalname: 'a.exe' }),
      ).toBe(false);
      expect(isAllowedMaterialFile({ mimetype: 'text/plain', originalname: 'a.txt' })).toBe(false);
    });
    it('拒绝空内容', () => {
      expect(isAllowedMaterialFile({})).toBe(false);
    });
  });

  describe('isWithinMaterialSizeLimit', () => {
    it('放行小文件', () => {
      expect(isWithinMaterialSizeLimit({ size: 1024 })).toBe(true);
    });
    it('拒绝超大文件（>50MB）', () => {
      expect(
        isWithinMaterialSizeLimit({ size: MAX_MATERIAL_SIZE + 1 }),
      ).toBe(false);
    });
    it('兼容 buffer.byteLength', () => {
      expect(
        isWithinMaterialSizeLimit({ buffer: Buffer.alloc(1024) }),
      ).toBe(true);
    });
  });

  describe('assertMaterialFileSafe', () => {
    it('通过校验不抛异常', () => {
      expect(() =>
        assertMaterialFileSafe({
          mimetype: 'image/png',
          originalname: 'ok.png',
          size: 1024,
        }),
      ).not.toThrow();
    });
    it('恶意类型抛 BadRequestException', () => {
      expect(() =>
        assertMaterialFileSafe({
          mimetype: 'text/php',
          originalname: 'shell.php',
          size: 10,
        }),
      ).toThrow(BadRequestException);
    });
    it('超大文件抛 PayloadTooLargeException', () => {
      expect(() =>
        assertMaterialFileSafe({
          mimetype: 'video/mp4',
          originalname: 'big.mp4',
          size: MAX_MATERIAL_SIZE + 1,
        }),
      ).toThrow(PayloadTooLargeException);
    });
  });
});
