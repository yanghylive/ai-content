#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HELPER_NAME = 'kaypal-wechat-db-helper';
const HELPER_VERSION = '0.3.3';
const CONTRACT_VERSION = 'kaypal-wechat-db-helper/v1';
const DEFAULT_RANDOM_LIMIT = 500;
const DEFAULT_ALL_LIMIT = 50000;
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 80;
const DECRYPTED_DB_ROOT = path.join(os.tmpdir(), 'ai-content-wechat-contact-db');
const FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64 = 'dXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uQ29sbGVjdGlvbnMuR2VuZXJpYzsKdXNpbmcgU3lzdGVtLkRpYWdub3N0aWNzOwp1c2luZyBTeXN0ZW0uSU87CnVzaW5nIFN5c3RlbS5SdW50aW1lLkludGVyb3BTZXJ2aWNlczsKdXNpbmcgU3lzdGVtLlNlY3VyaXR5LkNyeXB0b2dyYXBoeTsKdXNpbmcgU3lzdGVtLlRleHQ7CgpwdWJsaWMgY2xhc3MgS2F5cGFsV2VjaGF0RGJEZWNyeXB0b3IKewogICAgc3RhdGljIExpc3Q8c3RyaW5nPiBMYXN0U2NhbkRpYWdub3N0aWNzID0gbmV3IExpc3Q8c3RyaW5nPigpOwogICAgc3RhdGljIGxvbmcgU2NhblJlZ2lvbnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhbkJ5dGVzID0gMDsKICAgIHN0YXRpYyBsb25nIFNjYW5TYWx0SGl0cyA9IDA7CiAgICBzdGF0aWMgbG9uZyBTY2FuTGl0ZXJhbENhbmRpZGF0ZXMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0NhbmRpZGF0ZXMgPSAwOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIEdldExhc3REaWFnbm9zdGljcygpCiAgICB7CiAgICAgICAgcmV0dXJuIFN0cmluZy5Kb2luKCIgfCAiLCBMYXN0U2NhbkRpYWdub3N0aWNzLlRvQXJyYXkoKSk7CiAgICB9CgogICAgc3RhdGljIHZvaWQgUmVzZXRQcm9jZXNzU2NhbkNvdW50ZXJzKCkKICAgIHsKICAgICAgICBTY2FuUmVnaW9ucyA9IDA7CiAgICAgICAgU2NhbkJ5dGVzID0gMDsKICAgICAgICBTY2FuU2FsdEhpdHMgPSAwOwogICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyA9IDA7CiAgICAgICAgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgICAgIFNjYW5SYXdDYW5kaWRhdGVzID0gMDsKICAgIH0KCiAgICBzdGF0aWMgdm9pZCBBZGRTY2FuRGlhZ25vc3RpYyhzdHJpbmcgdmFsdWUpCiAgICB7CiAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eSh2YWx1ZSkgJiYgTGFzdFNjYW5EaWFnbm9zdGljcy5Db3VudCA8IDQwKSBMYXN0U2NhbkRpYWdub3N0aWNzLkFkZCh2YWx1ZSk7CiAgICB9CiAgICBjb25zdCBpbnQgUGFnZVNpemUgPSA0MDk2OwogICAgY29uc3QgaW50IFNhbHRTaXplID0gMTY7CiAgICBjb25zdCBpbnQgUmVzZXJ2ZVNpemUgPSA4MDsKICAgIGNvbnN0IGludCBJdlNpemUgPSAxNjsKICAgIGNvbnN0IGludCBIbWFjU2l6ZSA9IDY0OwogICAgY29uc3QgaW50IE1lbUNvbW1pdCA9IDB4MTAwMDsKICAgIGNvbnN0IGludCBDaHVua1NpemUgPSA0ICogMTAyNCAqIDEwMjQ7CiAgICBjb25zdCB1aW50IFByb2Nlc3NBY2Nlc3MgPSAweDAwMTAgfCAweDA0MDAgfCAweDEwMDA7CgogICAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXQogICAgc3RydWN0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24KICAgIHsKICAgICAgICBwdWJsaWMgSW50UHRyIEJhc2VBZGRyZXNzOwogICAgICAgIHB1YmxpYyBJbnRQdHIgQWxsb2NhdGlvbkJhc2U7CiAgICAgICAgcHVibGljIHVpbnQgQWxsb2NhdGlvblByb3RlY3Q7CiAgICAgICAgcHVibGljIEludFB0ciBSZWdpb25TaXplOwogICAgICAgIHB1YmxpYyB1aW50IFN0YXRlOwogICAgICAgIHB1YmxpYyB1aW50IFByb3RlY3Q7CiAgICAgICAgcHVibGljIHVpbnQgVHlwZTsKICAgIH0KCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIE9wZW5Qcm9jZXNzKHVpbnQgZHdEZXNpcmVkQWNjZXNzLCBib29sIGJJbmhlcml0SGFuZGxlLCBpbnQgZHdQcm9jZXNzSWQpOwoKICAgIFtEbGxJbXBvcnQoImtlcm5lbDMyLmRsbCIsIFNldExhc3RFcnJvciA9IHRydWUpXQogICAgc3RhdGljIGV4dGVybiBib29sIENsb3NlSGFuZGxlKEludFB0ciBoT2JqZWN0KTsKCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIFZpcnR1YWxRdWVyeUV4KEludFB0ciBoUHJvY2VzcywgSW50UHRyIGxwQWRkcmVzcywgb3V0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbHBCdWZmZXIsIEludFB0ciBkd0xlbmd0aCk7CgogICAgW0RsbEltcG9ydCgia2VybmVsMzIuZGxsIiwgU2V0TGFzdEVycm9yID0gdHJ1ZSldCiAgICBzdGF0aWMgZXh0ZXJuIGJvb2wgUmVhZFByb2Nlc3NNZW1vcnkoSW50UHRyIGhQcm9jZXNzLCBJbnRQdHIgbHBCYXNlQWRkcmVzcywgYnl0ZVtdIGxwQnVmZmVyLCBJbnRQdHIgZHdTaXplLCBvdXQgSW50UHRyIGxwTnVtYmVyT2ZCeXRlc1JlYWQpOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIERlY3J5cHRXaXRoTWVtb3J5S2V5KHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoKQogICAgewogICAgICAgIHN0cmluZyBrZXkgPSBGaW5kTWVtb3J5S2V5KGRiUGF0aCk7CiAgICAgICAgaWYgKFN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiAiIjsKICAgICAgICBEZWNyeXB0RGF0YWJhc2UoZGJQYXRoLCBvdXRwdXRQYXRoLCBrZXkpOwogICAgICAgIHJldHVybiBrZXk7CiAgICB9CgogICAgcHVibGljIHN0YXRpYyBzdHJpbmcgRmluZE1lbW9yeUtleShzdHJpbmcgZGJQYXRoKQogICAgewogICAgICAgIExhc3RTY2FuRGlhZ25vc3RpY3MuQ2xlYXIoKTsKICAgICAgICBieXRlW10gcGFnZTEgPSBSZWFkRmlyc3RQYWdlKGRiUGF0aCk7CiAgICAgICAgc3RyaW5nIHNhbHRIZXggPSBUb0hleChwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIExpc3Q8UHJvY2Vzcz4gcHJvY2Vzc2VzID0gbmV3IExpc3Q8UHJvY2Vzcz4oKTsKICAgICAgICBmb3JlYWNoIChzdHJpbmcgbmFtZSBpbiBuZXcgc3RyaW5nW10geyAiV2VpeGluIiwgIldlQ2hhdCIsICJXZUNoYXRBcHBFeCIsICJXZUNoYXRBcHAiLCAiV2VDaGF0QnJvd3NlciIgfSkKICAgICAgICB7CiAgICAgICAgICAgIHRyeSB7IHByb2Nlc3Nlcy5BZGRSYW5nZShQcm9jZXNzLkdldFByb2Nlc3Nlc0J5TmFtZShuYW1lKSk7IH0gY2F0Y2ggeyB9CiAgICAgICAgfQogICAgICAgIEFkZFNjYW5EaWFnbm9zdGljKCJwcm9jZXNzLWNvdW50PSIgKyBwcm9jZXNzZXMuQ291bnQpOwogICAgICAgIHByb2Nlc3Nlcy5Tb3J0KGRlbGVnYXRlKFByb2Nlc3MgYSwgUHJvY2VzcyBiKQogICAgICAgIHsKICAgICAgICAgICAgbG9uZyBidyA9IDA7CiAgICAgICAgICAgIGxvbmcgYXcgPSAwOwogICAgICAgICAgICB0cnkgeyBidyA9IGIuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICB0cnkgeyBhdyA9IGEuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICByZXR1cm4gYncuQ29tcGFyZVRvKGF3KTsKICAgICAgICB9KTsKCiAgICAgICAgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCA9IG5ldyBIYXNoU2V0PHN0cmluZz4oU3RyaW5nQ29tcGFyZXIuT3JkaW5hbElnbm9yZUNhc2UpOwogICAgICAgIGZvcmVhY2ggKFByb2Nlc3MgcHJvY2VzcyBpbiBwcm9jZXNzZXMpCiAgICAgICAgewogICAgICAgICAgICBJbnRQdHIgaGFuZGxlID0gSW50UHRyLlplcm87CiAgICAgICAgICAgIHRyeQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBSZXNldFByb2Nlc3NTY2FuQ291bnRlcnMoKTsKICAgICAgICAgICAgICAgIGhhbmRsZSA9IE9wZW5Qcm9jZXNzKFByb2Nlc3NBY2Nlc3MsIGZhbHNlLCBwcm9jZXNzLklkKTsKICAgICAgICAgICAgICAgIGlmIChoYW5kbGUgPT0gSW50UHRyLlplcm8pCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49ZmFpbGVkIik7CiAgICAgICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBzdHJpbmcga2V5ID0gU2NhblByb2Nlc3NGb3JLZXkoaGFuZGxlLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICAgICAgICAgIHN0cmluZyBzdW1tYXJ5ID0gcHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49b2s6cmVnaW9ucz0iICsgU2NhblJlZ2lvbnMgKyAiOm1iPSIgKyAoU2NhbkJ5dGVzIC8gMTAyNCAvIDEwMjQpICsgIjpzYWx0PSIgKyBTY2FuU2FsdEhpdHMgKyAiOmxpdGVyYWw9IiArIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyArICI6cmF3QW5jaG9ycz0iICsgU2NhblJhd0FuY2hvcnMgKyAiOnJhdz0iICsgU2NhblJhd0NhbmRpZGF0ZXMgKyAiOmZvdW5kPSIgKyAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkgPyAieWVzIiA6ICJubyIpOwogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMoc3VtbWFyeSk7CiAgICAgICAgICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgY2F0Y2ggKEV4Y2VwdGlvbiBleCkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOmVycm9yPSIgKyBleC5HZXRUeXBlKCkuTmFtZSk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZmluYWxseQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlICE9IEludFB0ci5aZXJvKSBDbG9zZUhhbmRsZShoYW5kbGUpOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5Qcm9jZXNzRm9yS2V5KEludFB0ciBoYW5kbGUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgbG9uZyBhZGRyZXNzID0gMDsKICAgICAgICBsb25nIG1heEFkZHJlc3MgPSAweDdGRkZGRkZGRkZGRjsKICAgICAgICBpbnQgbWJpU2l6ZSA9IE1hcnNoYWwuU2l6ZU9mKHR5cGVvZihNZW1vcnlCYXNpY0luZm9ybWF0aW9uKSk7CiAgICAgICAgd2hpbGUgKGFkZHJlc3MgPiAtMSAmJiBhZGRyZXNzIDwgbWF4QWRkcmVzcykKICAgICAgICB7CiAgICAgICAgICAgIE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbWJpOwogICAgICAgICAgICBJbnRQdHIgcXVlcnkgPSBuZXcgSW50UHRyKGFkZHJlc3MpOwogICAgICAgICAgICBJbnRQdHIgcmVzdWx0ID0gVmlydHVhbFF1ZXJ5RXgoaGFuZGxlLCBxdWVyeSwgb3V0IG1iaSwgbmV3IEludFB0cihtYmlTaXplKSk7CiAgICAgICAgICAgIGlmIChyZXN1bHQgPT0gSW50UHRyLlplcm8pIGJyZWFrOwoKICAgICAgICAgICAgbG9uZyBiYXNlQWRkcmVzcyA9IG1iaS5CYXNlQWRkcmVzcy5Ub0ludDY0KCk7CiAgICAgICAgICAgIGxvbmcgcmVnaW9uU2l6ZSA9IG1iaS5SZWdpb25TaXplLlRvSW50NjQoKTsKICAgICAgICAgICAgaWYgKHJlZ2lvblNpemUgPiAwICYmIHJlZ2lvblNpemUgPCA1MDBMICogMTAyNEwgKiAxMDI0TCAmJiBtYmkuU3RhdGUgPT0gTWVtQ29tbWl0ICYmIElzUmVhZGFibGVQcm90ZWN0KG1iaS5Qcm90ZWN0KSkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgU2NhblJlZ2lvbnMrKzsKICAgICAgICAgICAgICAgIHN0cmluZyBrZXkgPSBTY2FuTWVtb3J5UmVnaW9uKGhhbmRsZSwgYmFzZUFkZHJlc3MsIHJlZ2lvblNpemUsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICB9CgogICAgICAgICAgICBsb25nIG5leHQgPSBiYXNlQWRkcmVzcyArIHJlZ2lvblNpemU7CiAgICAgICAgICAgIGlmIChuZXh0IDw9IGFkZHJlc3MpIGJyZWFrOwogICAgICAgICAgICBhZGRyZXNzID0gbmV4dDsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2Nhbk1lbW9yeVJlZ2lvbihJbnRQdHIgaGFuZGxlLCBsb25nIGJhc2VBZGRyZXNzLCBsb25nIHJlZ2lvblNpemUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgYnl0ZVtdIHRhaWwgPSBuZXcgYnl0ZVswXTsKICAgICAgICBsb25nIG9mZnNldCA9IDA7CiAgICAgICAgd2hpbGUgKG9mZnNldCA8IHJlZ2lvblNpemUpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZFNpemUgPSAoaW50KU1hdGguTWluKChsb25nKUNodW5rU2l6ZSwgcmVnaW9uU2l6ZSAtIG9mZnNldCk7CiAgICAgICAgICAgIGJ5dGVbXSBidWZmZXIgPSBuZXcgYnl0ZVtyZWFkU2l6ZV07CiAgICAgICAgICAgIEludFB0ciBieXRlc1JlYWQ7CiAgICAgICAgICAgIGJvb2wgb2sgPSBSZWFkUHJvY2Vzc01lbW9yeShoYW5kbGUsIG5ldyBJbnRQdHIoYmFzZUFkZHJlc3MgKyBvZmZzZXQpLCBidWZmZXIsIG5ldyBJbnRQdHIocmVhZFNpemUpLCBvdXQgYnl0ZXNSZWFkKTsKICAgICAgICAgICAgaWYgKG9rICYmIGJ5dGVzUmVhZC5Ub0ludDY0KCkgPiAwKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpbnQgYWN0dWFsID0gKGludClNYXRoLk1pbigobG9uZylyZWFkU2l6ZSwgYnl0ZXNSZWFkLlRvSW50NjQoKSk7CiAgICAgICAgICAgICAgICBpZiAoYWN0dWFsICE9IGJ1ZmZlci5MZW5ndGgpCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgYnl0ZVtdIHNtYWxsZXIgPSBuZXcgYnl0ZVthY3R1YWxdOwogICAgICAgICAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoYnVmZmVyLCAwLCBzbWFsbGVyLCAwLCBhY3R1YWwpOwogICAgICAgICAgICAgICAgICAgIGJ1ZmZlciA9IHNtYWxsZXI7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBTY2FuQnl0ZXMgKz0gYnVmZmVyLkxlbmd0aDsKICAgICAgICAgICAgICAgIGJ5dGVbXSBkYXRhID0gQ29tYmluZSh0YWlsLCBidWZmZXIpOwogICAgICAgICAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5DYW5kaWRhdGVzKGRhdGEsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICAgICAgdGFpbCA9IExhc3RCeXRlcyhkYXRhLCAyNTYpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIG9mZnNldCArPSByZWFkU2l6ZTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2NhbkNhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5TcWxDaXBoZXJMaXRlcmFsQ2FuZGlkYXRlcyhkYXRhLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgcmV0dXJuIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoZGF0YSwgcGFnZTEsIHRlc3RlZCk7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBTY2FuU3FsQ2lwaGVyTGl0ZXJhbENhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgKyAzIDwgZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGlmICgoZGF0YVtpXSAhPSAoYnl0ZSkneCcgJiYgZGF0YVtpXSAhPSAoYnl0ZSknWCcpIHx8IGRhdGFbaSArIDFdICE9IChieXRlKSdcJycpIGNvbnRpbnVlOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBpICsgMjsKICAgICAgICAgICAgaW50IGogPSBzdGFydDsKICAgICAgICAgICAgd2hpbGUgKGogPCBkYXRhLkxlbmd0aCAmJiBJc0hleEJ5dGUoZGF0YVtqXSkgJiYgaiAtIHN0YXJ0IDw9IDE5MikgaisrOwogICAgICAgICAgICBpbnQgbGVuID0gaiAtIHN0YXJ0OwogICAgICAgICAgICBpZiAoaiA+PSBkYXRhLkxlbmd0aCB8fCBkYXRhW2pdICE9IChieXRlKSdcJycgfHwgbGVuIDwgNjQgfHwgbGVuID4gMTkyIHx8IChsZW4gJSAyKSAhPSAwKSBjb250aW51ZTsKICAgICAgICAgICAgc3RyaW5nIGhleCA9IEVuY29kaW5nLkFTQ0lJLkdldFN0cmluZyhkYXRhLCBzdGFydCwgbGVuKTsKICAgICAgICAgICAgc3RyaW5nIG1hcmtlciA9ICJzcWxjaXBoZXItbGl0ZXJhbDoiICsgaGV4OwogICAgICAgICAgICBpZiAodGVzdGVkLkNvbnRhaW5zKG1hcmtlcikpIGNvbnRpbnVlOwogICAgICAgICAgICB0ZXN0ZWQuQWRkKG1hcmtlcik7CiAgICAgICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcysrOwoKICAgICAgICAgICAgc3RyaW5nIGVuY0tleUhleCA9ICIiOwogICAgICAgICAgICBzdHJpbmcgY2FuZGlkYXRlU2FsdCA9ICIiOwogICAgICAgICAgICBpZiAobGVuID09IDY0KQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBlbmNLZXlIZXggPSBoZXg7CiAgICAgICAgICAgICAgICBjYW5kaWRhdGVTYWx0ID0gc2FsdEhleDsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlIGlmIChsZW4gPT0gOTYpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGVuY0tleUhleCA9IGhleC5TdWJzdHJpbmcoMCwgNjQpOwogICAgICAgICAgICAgICAgY2FuZGlkYXRlU2FsdCA9IGhleC5TdWJzdHJpbmcoNjQsIDMyKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICghU3RyaW5nLkVxdWFscyhjYW5kaWRhdGVTYWx0LCBzYWx0SGV4LCBTdHJpbmdDb21wYXJpc29uLk9yZGluYWxJZ25vcmVDYXNlKSkgY29udGludWU7CiAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGVuY0tleUhleCk7CiAgICAgICAgICAgIGlmIChWZXJpZnlFbmNLZXkoZW5jS2V5LCBwYWdlMSkpIHJldHVybiBlbmNLZXlIZXg7CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCkKICAgIHsKICAgICAgICBieXRlW10gc2FsdCA9IFNsaWNlKHBhZ2UxLCAwLCBTYWx0U2l6ZSk7CiAgICAgICAgaW50IGFuY2hvcnMgPSAwOwogICAgICAgIGZvciAoaW50IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCAwKTsgYW5jaG9yID49IDA7IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCBhbmNob3IgKyAxKSkKICAgICAgICB7CiAgICAgICAgICAgIGFuY2hvcnMrKzsKICAgICAgICAgICAgU2NhblNhbHRIaXRzKys7CiAgICAgICAgICAgIFNjYW5SYXdBbmNob3JzKys7CiAgICAgICAgICAgIGlmIChhbmNob3JzID4gNjQpIGJyZWFrOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBNYXRoLk1heCgwLCBhbmNob3IgLSA0MDk2KTsKICAgICAgICAgICAgaW50IGVuZCA9IE1hdGguTWluKGRhdGEuTGVuZ3RoIC0gMzIsIGFuY2hvciArIDQwOTYpOwogICAgICAgICAgICBpbnQgcHJvYmVzID0gMDsKICAgICAgICAgICAgZm9yIChpbnQgaSA9IHN0YXJ0OyBpIDw9IGVuZDsgaSsrKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBwcm9iZXMrKzsKICAgICAgICAgICAgICAgIGlmIChwcm9iZXMgPiAxMjAwMCkgYnJlYWs7CiAgICAgICAgICAgICAgICBpZiAoIUxvb2tzTGlrZVJhd0tleShkYXRhLCBpKSkgY29udGludWU7CiAgICAgICAgICAgICAgICBTY2FuUmF3Q2FuZGlkYXRlcysrOwogICAgICAgICAgICAgICAgc3RyaW5nIGhleCA9IFRvSGV4KGRhdGEsIGksIDMyKTsKICAgICAgICAgICAgICAgIHN0cmluZyBtYXJrZXIgPSAicmF3LW5lYXItc2FsdDoiICsgaGV4OwogICAgICAgICAgICAgICAgaWYgKHRlc3RlZC5Db250YWlucyhtYXJrZXIpKSBjb250aW51ZTsKICAgICAgICAgICAgICAgIHRlc3RlZC5BZGQobWFya2VyKTsKICAgICAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBTbGljZShkYXRhLCBpLCAzMik7CiAgICAgICAgICAgICAgICBpZiAoVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSByZXR1cm4gaGV4OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgaW50IEluZGV4T2ZCeXRlcyhieXRlW10gZGF0YSwgYnl0ZVtdIG5lZWRsZSwgaW50IHN0YXJ0KQogICAgewogICAgICAgIGlmIChkYXRhID09IG51bGwgfHwgbmVlZGxlID09IG51bGwgfHwgbmVlZGxlLkxlbmd0aCA9PSAwKSByZXR1cm4gLTE7CiAgICAgICAgZm9yIChpbnQgaSA9IE1hdGguTWF4KDAsIHN0YXJ0KTsgaSArIG5lZWRsZS5MZW5ndGggPD0gZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGludCBqID0gMDsKICAgICAgICAgICAgZm9yICg7IGogPCBuZWVkbGUuTGVuZ3RoOyBqKyspCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGlmIChkYXRhW2kgKyBqXSAhPSBuZWVkbGVbal0pIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChqID09IG5lZWRsZS5MZW5ndGgpIHJldHVybiBpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gLTE7CiAgICB9CgogICAgc3RhdGljIGJvb2wgTG9va3NMaWtlUmF3S2V5KGJ5dGVbXSBkYXRhLCBpbnQgc3RhcnQpCiAgICB7CiAgICAgICAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCArIDMyID4gZGF0YS5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBib29sW10gc2VlbiA9IG5ldyBib29sWzI1Nl07CiAgICAgICAgaW50IHVuaXF1ZSA9IDA7CiAgICAgICAgaW50IHplcm9zID0gMDsKICAgICAgICBpbnQgcHJpbnRhYmxlID0gMDsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IDMyOyBpKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlIHZhbHVlID0gZGF0YVtzdGFydCArIGldOwogICAgICAgICAgICBpZiAodmFsdWUgPT0gMCkgemVyb3MrKzsKICAgICAgICAgICAgaWYgKHZhbHVlID49IDB4MjAgJiYgdmFsdWUgPD0gMHg3ZSkgcHJpbnRhYmxlKys7CiAgICAgICAgICAgIGlmICghc2Vlblt2YWx1ZV0pCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHNlZW5bdmFsdWVdID0gdHJ1ZTsKICAgICAgICAgICAgICAgIHVuaXF1ZSsrOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmICh6ZXJvcyA+IDQpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAodW5pcXVlIDwgMTgpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAocHJpbnRhYmxlID49IDMwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgcmV0dXJuIHRydWU7CiAgICB9CgogICAgc3RhdGljIGJvb2wgSXNSZWFkYWJsZVByb3RlY3QodWludCBwcm90ZWN0KQogICAgewogICAgICAgIGlmICgocHJvdGVjdCAmIDB4MTAwKSAhPSAwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgdWludCBwID0gcHJvdGVjdCAmIDB4ZmY7CiAgICAgICAgcmV0dXJuIHAgPT0gMHgwMiB8fCBwID09IDB4MDQgfHwgcCA9PSAweDA4IHx8IHAgPT0gMHgxMCB8fCBwID09IDB4MjAgfHwgcCA9PSAweDQwIHx8IHAgPT0gMHg4MDsKICAgIH0KCiAgICBzdGF0aWMgYm9vbCBJc0hleEJ5dGUoYnl0ZSB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKHZhbHVlID49IChieXRlKScwJyAmJiB2YWx1ZSA8PSAoYnl0ZSknOScpIHx8CiAgICAgICAgICAgICAgICh2YWx1ZSA+PSAoYnl0ZSknYScgJiYgdmFsdWUgPD0gKGJ5dGUpJ2YnKSB8fAogICAgICAgICAgICAgICAodmFsdWUgPj0gKGJ5dGUpJ0EnICYmIHZhbHVlIDw9IChieXRlKSdGJyk7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBSZWFkRmlyc3RQYWdlKHN0cmluZyBkYlBhdGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIHBhZ2UgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgdXNpbmcgKEZpbGVTdHJlYW0gZnMgPSBGaWxlLk9wZW5SZWFkKGRiUGF0aCkpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZCA9IGZzLlJlYWQocGFnZSwgMCwgcGFnZS5MZW5ndGgpOwogICAgICAgICAgICBpZiAocmVhZCA8IFBhZ2VTaXplKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiY29udGFjdC5kYiBpcyBzbWFsbGVyIHRoYW4gb25lIFNRTENpcGhlciBwYWdlIik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBwYWdlOwogICAgfQoKICAgIHN0YXRpYyBib29sIFZlcmlmeUVuY0tleShieXRlW10gZW5jS2V5LCBieXRlW10gcGFnZTEpCiAgICB7CiAgICAgICAgYnl0ZVtdIHNhbHQgPSBTbGljZShwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIGJ5dGVbXSBtYWNTYWx0ID0gbmV3IGJ5dGVbc2FsdC5MZW5ndGhdOwogICAgICAgIGZvciAoaW50IGkgPSAwOyBpIDwgc2FsdC5MZW5ndGg7IGkrKykgbWFjU2FsdFtpXSA9IChieXRlKShzYWx0W2ldIF4gMHgzYSk7CiAgICAgICAgYnl0ZVtdIG1hY0tleSA9IFBia2RmMlNoYTUxMihlbmNLZXksIG1hY1NhbHQsIDIsIDMyKTsKICAgICAgICBieXRlW10gaG1hY0RhdGEgPSBTbGljZShwYWdlMSwgU2FsdFNpemUsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgKyBJdlNpemUgLSBTYWx0U2l6ZSk7CiAgICAgICAgYnl0ZVtdIGV4cGVjdGVkID0gU2xpY2UocGFnZTEsIFBhZ2VTaXplIC0gSG1hY1NpemUsIEhtYWNTaXplKTsKICAgICAgICBieXRlW10gcGFnZU5vID0gbmV3IGJ5dGVbXSB7IDEsIDAsIDAsIDAgfTsKICAgICAgICB1c2luZyAoSE1BQ1NIQTUxMiBobWFjID0gbmV3IEhNQUNTSEE1MTIobWFjS2V5KSkKICAgICAgICB7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtQmxvY2soaG1hY0RhdGEsIDAsIGhtYWNEYXRhLkxlbmd0aCwgbnVsbCwgMCk7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtRmluYWxCbG9jayhwYWdlTm8sIDAsIHBhZ2VOby5MZW5ndGgpOwogICAgICAgICAgICByZXR1cm4gRml4ZWRUaW1lRXF1YWxzKGhtYWMuSGFzaCwgZXhwZWN0ZWQpOwogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIFBia2RmMlNoYTUxMihieXRlW10gcGFzc3dvcmQsIGJ5dGVbXSBzYWx0LCBpbnQgaXRlcmF0aW9ucywgaW50IGRrTGVuKQogICAgewogICAgICAgIGludCBoYXNoTGVuID0gNjQ7CiAgICAgICAgaW50IGJsb2NrcyA9IChpbnQpTWF0aC5DZWlsaW5nKChkb3VibGUpZGtMZW4gLyBoYXNoTGVuKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbYmxvY2tzICogaGFzaExlbl07CiAgICAgICAgaW50IG9mZnNldCA9IDA7CiAgICAgICAgZm9yIChpbnQgYmxvY2sgPSAxOyBibG9jayA8PSBibG9ja3M7IGJsb2NrKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlW10gaW50QmxvY2sgPSBuZXcgYnl0ZVtdIHsKICAgICAgICAgICAgICAgIChieXRlKSgoYmxvY2sgPj4gMjQpICYgMHhmZiksCiAgICAgICAgICAgICAgICAoYnl0ZSkoKGJsb2NrID4+IDE2KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKChibG9jayA+PiA4KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKGJsb2NrICYgMHhmZikKICAgICAgICAgICAgfTsKICAgICAgICAgICAgYnl0ZVtdIHU7CiAgICAgICAgICAgIHVzaW5nIChITUFDU0hBNTEyIGhtYWMgPSBuZXcgSE1BQ1NIQTUxMihwYXNzd29yZCkpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHUgPSBobWFjLkNvbXB1dGVIYXNoKENvbWJpbmUoc2FsdCwgaW50QmxvY2spKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBieXRlW10gdCA9IChieXRlW10pdS5DbG9uZSgpOwogICAgICAgICAgICBmb3IgKGludCBpID0gMTsgaSA8IGl0ZXJhdGlvbnM7IGkrKykKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgdXNpbmcgKEhNQUNTSEE1MTIgaG1hYyA9IG5ldyBITUFDU0hBNTEyKHBhc3N3b3JkKSkKICAgICAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgICAgICB1ID0gaG1hYy5Db21wdXRlSGFzaCh1KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGZvciAoaW50IGogPSAwOyBqIDwgaGFzaExlbjsgaisrKSB0W2pdIF49IHVbal07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgQnVmZmVyLkJsb2NrQ29weSh0LCAwLCBvdXRwdXQsIG9mZnNldCwgaGFzaExlbik7CiAgICAgICAgICAgIG9mZnNldCArPSBoYXNoTGVuOwogICAgICAgIH0KICAgICAgICByZXR1cm4gU2xpY2Uob3V0cHV0LCAwLCBka0xlbik7CiAgICB9CgogICAgc3RhdGljIHZvaWQgRGVjcnlwdERhdGFiYXNlKHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoLCBzdHJpbmcga2V5SGV4KQogICAgewogICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGtleUhleCk7CiAgICAgICAgYnl0ZVtdIHBhZ2UxID0gUmVhZEZpcnN0UGFnZShkYlBhdGgpOwogICAgICAgIGlmICghVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiSE1BQyB2ZXJpZmljYXRpb24gZmFpbGVkIik7CiAgICAgICAgc3RyaW5nIGRpcmVjdG9yeSA9IFBhdGguR2V0RGlyZWN0b3J5TmFtZShvdXRwdXRQYXRoKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGRpcmVjdG9yeSkpIERpcmVjdG9yeS5DcmVhdGVEaXJlY3RvcnkoZGlyZWN0b3J5KTsKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBpbnB1dCA9IEZpbGUuT3BlblJlYWQoZGJQYXRoKSkKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBvdXRwdXQgPSBGaWxlLkNyZWF0ZShvdXRwdXRQYXRoKSkKICAgICAgICB7CiAgICAgICAgICAgIGludCBwYWdlTm8gPSAxOwogICAgICAgICAgICBieXRlW10gcGFnZSA9IG5ldyBieXRlW1BhZ2VTaXplXTsKICAgICAgICAgICAgd2hpbGUgKHRydWUpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGludCByZWFkID0gUmVhZEZ1bGxQYWdlKGlucHV0LCBwYWdlKTsKICAgICAgICAgICAgICAgIGlmIChyZWFkID09IDApIGJyZWFrOwogICAgICAgICAgICAgICAgaWYgKHJlYWQgPCBQYWdlU2l6ZSkgYnJlYWs7CiAgICAgICAgICAgICAgICBieXRlW10gcGxhaW4gPSBEZWNyeXB0UGFnZShlbmNLZXksIHBhZ2UsIHBhZ2VObyk7CiAgICAgICAgICAgICAgICBvdXRwdXQuV3JpdGUocGxhaW4sIDAsIHBsYWluLkxlbmd0aCk7CiAgICAgICAgICAgICAgICBwYWdlTm8rKzsKICAgICAgICAgICAgICAgIEFycmF5LkNsZWFyKHBhZ2UsIDAsIHBhZ2UuTGVuZ3RoKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgaW50IFJlYWRGdWxsUGFnZShGaWxlU3RyZWFtIGlucHV0LCBieXRlW10gcGFnZSkKICAgIHsKICAgICAgICBpbnQgdG90YWwgPSAwOwogICAgICAgIHdoaWxlICh0b3RhbCA8IHBhZ2UuTGVuZ3RoKQogICAgICAgIHsKICAgICAgICAgICAgaW50IHJlYWQgPSBpbnB1dC5SZWFkKHBhZ2UsIHRvdGFsLCBwYWdlLkxlbmd0aCAtIHRvdGFsKTsKICAgICAgICAgICAgaWYgKHJlYWQgPT0gMCkgYnJlYWs7CiAgICAgICAgICAgIHRvdGFsICs9IHJlYWQ7CiAgICAgICAgfQogICAgICAgIHJldHVybiB0b3RhbDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIERlY3J5cHRQYWdlKGJ5dGVbXSBrZXksIGJ5dGVbXSBwYWdlLCBpbnQgcGFnZU5vKQogICAgewogICAgICAgIGJ5dGVbXSBpdiA9IFNsaWNlKHBhZ2UsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUsIEl2U2l6ZSk7CiAgICAgICAgaW50IHN0YXJ0ID0gcGFnZU5vID09IDEgPyBTYWx0U2l6ZSA6IDA7CiAgICAgICAgaW50IGxlbmd0aCA9IFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgLSBzdGFydDsKICAgICAgICBieXRlW10gY2lwaGVyVGV4dCA9IFNsaWNlKHBhZ2UsIHN0YXJ0LCBsZW5ndGgpOwogICAgICAgIGJ5dGVbXSBkZWNyeXB0ZWQ7CiAgICAgICAgdXNpbmcgKEFlc0NyeXB0b1NlcnZpY2VQcm92aWRlciBhZXMgPSBuZXcgQWVzQ3J5cHRvU2VydmljZVByb3ZpZGVyKCkpCiAgICAgICAgewogICAgICAgICAgICBhZXMuS2V5U2l6ZSA9IDI1NjsKICAgICAgICAgICAgYWVzLkJsb2NrU2l6ZSA9IDEyODsKICAgICAgICAgICAgYWVzLk1vZGUgPSBDaXBoZXJNb2RlLkNCQzsKICAgICAgICAgICAgYWVzLlBhZGRpbmcgPSBQYWRkaW5nTW9kZS5Ob25lOwogICAgICAgICAgICBhZXMuS2V5ID0ga2V5OwogICAgICAgICAgICBhZXMuSVYgPSBpdjsKICAgICAgICAgICAgdXNpbmcgKElDcnlwdG9UcmFuc2Zvcm0gdHJhbnNmb3JtID0gYWVzLkNyZWF0ZURlY3J5cHRvcigpKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBkZWNyeXB0ZWQgPSB0cmFuc2Zvcm0uVHJhbnNmb3JtRmluYWxCbG9jayhjaXBoZXJUZXh0LCAwLCBjaXBoZXJUZXh0Lkxlbmd0aCk7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgYnl0ZVtdIHBhZ2VPdXQgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgaWYgKHBhZ2VObyA9PSAxKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZVtdIGhlYWRlciA9IEVuY29kaW5nLkFTQ0lJLkdldEJ5dGVzKCJTUUxpdGUgZm9ybWF0IDNcMCIpOwogICAgICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGhlYWRlciwgMCwgcGFnZU91dCwgMCwgaGVhZGVyLkxlbmd0aCk7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCBTYWx0U2l6ZSwgZGVjcnlwdGVkLkxlbmd0aCk7CiAgICAgICAgfQogICAgICAgIGVsc2UKICAgICAgICB7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCAwLCBkZWNyeXB0ZWQuTGVuZ3RoKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIHBhZ2VPdXQ7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBDb21iaW5lKGJ5dGVbXSBsZWZ0LCBieXRlW10gcmlnaHQpCiAgICB7CiAgICAgICAgaWYgKGxlZnQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCA9PSAwKSByZXR1cm4gcmlnaHQ7CiAgICAgICAgaWYgKHJpZ2h0ID09IG51bGwgfHwgcmlnaHQuTGVuZ3RoID09IDApIHJldHVybiBsZWZ0OwogICAgICAgIGJ5dGVbXSBjb21iaW5lZCA9IG5ldyBieXRlW2xlZnQuTGVuZ3RoICsgcmlnaHQuTGVuZ3RoXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGxlZnQsIDAsIGNvbWJpbmVkLCAwLCBsZWZ0Lkxlbmd0aCk7CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShyaWdodCwgMCwgY29tYmluZWQsIGxlZnQuTGVuZ3RoLCByaWdodC5MZW5ndGgpOwogICAgICAgIHJldHVybiBjb21iaW5lZDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIExhc3RCeXRlcyhieXRlW10gaW5wdXQsIGludCBjb3VudCkKICAgIHsKICAgICAgICBpZiAoaW5wdXQgPT0gbnVsbCB8fCBpbnB1dC5MZW5ndGggPT0gMCkgcmV0dXJuIG5ldyBieXRlWzBdOwogICAgICAgIGludCBsZW4gPSBNYXRoLk1pbihjb3VudCwgaW5wdXQuTGVuZ3RoKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbbGVuXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGlucHV0LCBpbnB1dC5MZW5ndGggLSBsZW4sIG91dHB1dCwgMCwgbGVuKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gU2xpY2UoYnl0ZVtdIGlucHV0LCBpbnQgc3RhcnQsIGludCBsZW5ndGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIG91dHB1dCA9IG5ldyBieXRlW2xlbmd0aF07CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShpbnB1dCwgc3RhcnQsIG91dHB1dCwgMCwgbGVuZ3RoKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBib29sIEZpeGVkVGltZUVxdWFscyhieXRlW10gbGVmdCwgYnl0ZVtdIHJpZ2h0KQogICAgewogICAgICAgIGlmIChsZWZ0ID09IG51bGwgfHwgcmlnaHQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCAhPSByaWdodC5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBpbnQgZGlmZiA9IDA7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgPCBsZWZ0Lkxlbmd0aDsgaSsrKSBkaWZmIHw9IGxlZnRbaV0gXiByaWdodFtpXTsKICAgICAgICByZXR1cm4gZGlmZiA9PSAwOwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gSGV4VG9CeXRlcyhzdHJpbmcgaGV4KQogICAgewogICAgICAgIGJ5dGVbXSBieXRlcyA9IG5ldyBieXRlW2hleC5MZW5ndGggLyAyXTsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IGJ5dGVzLkxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZXNbaV0gPSBDb252ZXJ0LlRvQnl0ZShoZXguU3Vic3RyaW5nKGkgKiAyLCAyKSwgMTYpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBUb0hleChieXRlW10gYnl0ZXMsIGludCBzdGFydCwgaW50IGxlbmd0aCkKICAgIHsKICAgICAgICBjaGFyW10gYyA9IG5ldyBjaGFyW2xlbmd0aCAqIDJdOwogICAgICAgIGludCBiID0gMDsKICAgICAgICBmb3IgKGludCBpID0gc3RhcnQ7IGkgPCBzdGFydCArIGxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZSB2ID0gYnl0ZXNbaV07CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgLyAxNik7CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgJSAxNik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBuZXcgc3RyaW5nKGMpOwogICAgfQoKICAgIHN0YXRpYyBjaGFyIEdldEhleFZhbHVlKGludCB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKGNoYXIpKHZhbHVlIDwgMTAgPyB2YWx1ZSArICcwJyA6IHZhbHVlIC0gMTAgKyAnYScpOwogICAgfQp9';

let emitted = false;

function compactText(value) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleepMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, delay);
}

function emit(payload, code = 0) {
  if (emitted) return;
  emitted = true;
  const base = {
    ok: Boolean(payload && payload.ok),
    helper: HELPER_NAME,
    helperVersion: HELPER_VERSION,
    contractVersion: CONTRACT_VERSION,
  };
  fs.writeSync(1, `${JSON.stringify({ ...base, ...(payload || {}) })}\n`);
  process.exit(code);
}

process.on('uncaughtException', (error) => {
  emit({
    ok: false,
    status: 'failed',
    error: 'wechat db helper crashed',
    diagnostics: {
      stage: 'uncaught-exception',
      message: compactText(error && error.message ? error.message : error),
    },
  }, 70);
});

process.on('unhandledRejection', (reason) => {
  emit({
    ok: false,
    status: 'failed',
    error: 'wechat db helper rejected unexpectedly',
    diagnostics: {
      stage: 'unhandled-rejection',
      message: compactText(reason && reason.message ? reason.message : reason),
    },
  }, 70);
});

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function allArgValues(names) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (!names.includes(process.argv[index])) continue;
    if (process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function readJsonStdin() {
  if (process.stdin.isTTY) {
    return { value: {}, raw: '', hasInput: false };
  }
  let raw = '';
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        raw = fs.readFileSync(0, 'utf8');
        break;
      } catch (error) {
        if (error && error.code === 'EAGAIN' && attempt < 4) {
          sleepMs(30 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    return {
      value: {},
      raw: '',
      hasInput: false,
      error: `stdin read failed: ${compactText(error.message)}`,
    };
  }
  if (!raw.trim()) return { value: {}, raw, hasInput: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      value: parsed && typeof parsed === 'object' ? parsed : {},
      raw,
      hasInput: true,
    };
  } catch (error) {
    return {
      value: {},
      raw,
      hasInput: true,
      error: `stdin json parse failed: ${compactText(error.message)}`,
    };
  }
}

function uniquePaths(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    let full = '';
    try {
      full = path.resolve(String(item));
    } catch {
      continue;
    }
    const key = process.platform === 'win32' ? full.toLowerCase() : full;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

function pathExists(candidate) {
  try {
    return Boolean(candidate && fs.existsSync(candidate));
  } catch {
    return false;
  }
}

function safeStat(candidate) {
  try {
    return candidate && fs.existsSync(candidate) ? fs.statSync(candidate) : null;
  } catch {
    return null;
  }
}

const recentDirMtimeCache = new Map();

function latestChildMtimeMs(dirPath, maxEntries = 160) {
  const key = normalizedPathKey(dirPath);
  if (!key) return 0;
  if (recentDirMtimeCache.has(key)) return recentDirMtimeCache.get(key);
  let latest = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    recentDirMtimeCache.set(key, 0);
    return 0;
  }
  for (const entry of entries.slice(0, maxEntries)) {
    const full = path.join(dirPath, entry.name);
    const stat = safeStat(full);
    if (!stat) continue;
    latest = Math.max(latest, Number(stat.mtimeMs) || 0, Number(stat.ctimeMs) || 0);
  }
  recentDirMtimeCache.set(key, latest);
  return latest;
}

function extractDbAccountInfo(dbPath) {
  const text = String(dbPath || '');
  const normalized = text.replace(/\\/g, '/');
  const match = normalized.match(/(?:^|\/)(xwechat_files|WeChat Files)\/([^/]+)(?:\/|$)/i);
  const rootKind = match ? match[1] : '';
  const accountFolder = match ? match[2] : '';
  const baseWxidMatch = accountFolder.match(/^(wxid_[A-Za-z0-9]+)(?:_|$)/i);
  const baseWxid = baseWxidMatch ? baseWxidMatch[1] : accountFolder;
  const lower = normalized.toLowerCase();
  const accountRoot = match
    ? normalized.slice(0, normalized.indexOf(`/${rootKind}/`) + rootKind.length + accountFolder.length + 2)
    : '';
  return {
    path: text,
    rootKind,
    accountFolder,
    baseWxid,
    accountRoot,
    isBackup: /\/backup(?:\/|$)/i.test(normalized),
    isAllUsers: /\/all_users(?:\/|$)/i.test(normalized) || accountFolder.toLowerCase() === 'all_users',
    isXWechat: rootKind.toLowerCase() === 'xwechat_files',
    isContactDb: /\/db_storage\/contact\/contact\.db$/i.test(normalized) || /\/contact\.db$/i.test(normalized),
    isMessageDb: /\/(?:msg|db_storage\/message|message)\/[^/]*(?:micromsg|msg)\.db$/i.test(lower) || /\/(?:micromsg|msg)\.db$/i.test(lower),
  };
}

function candidateProbePaths(dbPath, info) {
  const probes = [dbPath, path.dirname(dbPath), info.accountRoot];
  if (info.accountRoot) {
    probes.push(
      path.join(info.accountRoot, 'db_storage'),
      path.join(info.accountRoot, 'db_storage', 'contact'),
      path.join(info.accountRoot, 'db_storage', 'session'),
      path.join(info.accountRoot, 'db_storage', 'message'),
      path.join(info.accountRoot, 'db_storage', 'msg'),
      path.join(info.accountRoot, 'db_storage', 'chat'),
      path.join(info.accountRoot, 'db_storage', 'ChatMsg'),
      path.join(info.accountRoot, 'config'),
      path.join(info.accountRoot, 'msg'),
      path.join(info.accountRoot, 'resource'),
      path.join(info.accountRoot, 'temp'),
    );
  }
  return probes.filter(Boolean);
}

function describeDbCandidate(dbPath) {
  const info = extractDbAccountInfo(dbPath);
  let activeMtimeMs = 0;
  let sizeBytes = 0;
  const dbStat = safeStat(dbPath);
  if (dbStat) sizeBytes = Number(dbStat.size) || 0;
  for (const probe of candidateProbePaths(dbPath, info)) {
    const stat = safeStat(probe);
    if (!stat) continue;
    activeMtimeMs = Math.max(activeMtimeMs, Number(stat.mtimeMs) || 0, Number(stat.ctimeMs) || 0);
    if (stat.isDirectory()) {
      activeMtimeMs = Math.max(activeMtimeMs, latestChildMtimeMs(probe));
    }
  }
  let score = 0;
  if (info.isXWechat) score += 80;
  if (info.isContactDb) score += 60;
  if (info.accountFolder && !info.isAllUsers && !info.isBackup) score += 20;
  if (info.isMessageDb) score -= 20;
  if (info.isAllUsers || info.isBackup) score -= 2000;
  score += Math.min(80, Math.floor(sizeBytes / 1024 / 1024));
  return {
    ...info,
    sizeBytes,
    activeMtimeMs,
    activeMtime: activeMtimeMs ? new Date(activeMtimeMs).toISOString() : '',
    score,
  };
}

function normalizedPathKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function inputWechatFilesRoots(input = {}) {
  const processInfo = input && typeof input.process === 'object' ? input.process : {};
  return uniquePaths([
    input.wechatFilesPath,
    ...(Array.isArray(input.wechatFilesPaths) ? input.wechatFilesPaths : []),
    processInfo.wechatFilesPath,
    ...(Array.isArray(processInfo.wechatFilesPaths) ? processInfo.wechatFilesPaths : []),
    process.env.AI_CONTENT_ACTIVE_WECHAT_FILES_DIR,
  ].filter(Boolean));
}

function isUnderRoot(dbPath, root) {
  const dbKey = normalizedPathKey(dbPath);
  const rootKey = normalizedPathKey(root);
  return Boolean(rootKey && (dbKey === rootKey || dbKey.startsWith(`${rootKey}/`)));
}

function activeRootScore(dbPath, activeRoots) {
  for (let index = 0; index < activeRoots.length; index += 1) {
    if (isUnderRoot(dbPath, activeRoots[index])) return activeRoots.length - index;
  }
  return 0;
}

function rankDbPaths(paths, input = {}) {
  const explicitPath = input.dbPath || process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH || '';
  let explicitResolved = '';
  try {
    explicitResolved = explicitPath ? path.resolve(String(explicitPath)) : '';
  } catch {
    explicitResolved = '';
  }
  const activeRoots = inputWechatFilesRoots(input);
  return uniquePaths(paths)
    .filter(pathExists)
    .map((dbPath, index) => ({
      dbPath,
      index,
      details: describeDbCandidate(dbPath),
      activeRootScore: activeRootScore(dbPath, activeRoots),
    }))
    .sort((left, right) => {
      const explicitLeft = explicitResolved && left.dbPath.toLowerCase() === explicitResolved.toLowerCase() ? 1 : 0;
      const explicitRight = explicitResolved && right.dbPath.toLowerCase() === explicitResolved.toLowerCase() ? 1 : 0;
      if (explicitLeft !== explicitRight) return explicitRight - explicitLeft;
      if (left.activeRootScore !== right.activeRootScore) return right.activeRootScore - left.activeRootScore;
      if (left.details.activeMtimeMs !== right.details.activeMtimeMs) {
        return right.details.activeMtimeMs - left.details.activeMtimeMs;
      }
      if (left.details.sizeBytes !== right.details.sizeBytes) return right.details.sizeBytes - left.details.sizeBytes;
      if (left.details.score !== right.details.score) return right.details.score - left.details.score;
      return left.index - right.index;
    })
    .map((item) => item.dbPath);
}

function copyFileWithRetries(sourcePath, targetPath, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 8);
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs) || 120);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.copyFileSync(sourcePath, targetPath);
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) sleepMs(baseDelayMs * attempt);
    }
  }
  return {
    ok: false,
    attempts,
    error: compactText(lastError && lastError.message ? lastError.message : lastError),
  };
}

function copyFileWithSharedRead(sourcePath, targetPath) {
  if (process.platform !== 'win32') {
    return { ok: false, status: 'skipped', reason: 'non-windows' };
  }
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $sourcePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(sourcePath)}'))
  $targetPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(targetPath)}'))
  $targetDir = [System.IO.Path]::GetDirectoryName($targetPath)
  if (-not [string]::IsNullOrWhiteSpace($targetDir)) {
    [System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
  }
  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
  }
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  $inputStream = [System.IO.File]::Open($sourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
  try {
    $outputStream = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
      $inputStream.CopyTo($outputStream)
    } finally {
      $outputStream.Dispose()
    }
  } finally {
    $inputStream.Dispose()
  }
  [ordered]@{
    ok = (Test-Path -LiteralPath $targetPath)
    outputPath = $targetPath
    outputBytes = if (Test-Path -LiteralPath $targetPath) { (Get-Item -LiteralPath $targetPath).Length } else { 0 }
  } | ConvertTo-Json -Compress
} catch {
  [ordered]@{
    ok = $false
    error = $_.Exception.Message
    errorType = $_.Exception.GetType().FullName
  } | ConvertTo-Json -Compress
  exit 3
}
`;
  const result = runPowerShellScript(script, 60000);
  const jsonLine = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .pop();
  const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
  return {
    ok: Boolean(parsed.ok) && pathExists(targetPath),
    status: result.status === 0 ? 'completed' : 'failed',
    exitCode: result.status,
    outputPath: parsed.outputPath || targetPath,
    outputBytes: Number(parsed.outputBytes) || 0,
    error: compactText(parsed.error || parsed.parseError || result.stderr || result.stdout || result.error?.message || ''),
  };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function toBase64Utf8(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return { parseError: compactText(error.message || error) };
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 15000,
    ...options,
  });
}

function fileSha256Hex(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function splitPathList(value) {
  return String(value || '')
    .split(process.platform === 'win32' ? /[;]+/ : /[:]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function describeToolCandidate(candidate) {
  const stat = safeStat(candidate);
  const ready = Boolean(stat && stat.isFile());
  return {
    path: candidate,
    status: ready ? 'ready' : 'missing',
    bytes: ready ? Number(stat.size) || 0 : 0,
    sha256: ready ? fileSha256Hex(candidate).slice(0, 16) : '',
    architecture: ready ? describePortableExecutableArchitecture(candidate) : 'missing',
  };
}

function firstReadyTool(candidates) {
  return candidates.find((item) => item.status === 'ready') || null;
}

function describePortableExecutableArchitecture(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const dos = Buffer.alloc(64);
      if (fs.readSync(fd, dos, 0, dos.length, 0) < 64) return 'unknown';
      if (dos.readUInt16LE(0) !== 0x5a4d) return 'non-pe';
      const peOffset = dos.readUInt32LE(0x3c);
      if (!Number.isFinite(peOffset) || peOffset <= 0) return 'unknown';
      const header = Buffer.alloc(6);
      if (fs.readSync(fd, header, 0, header.length, peOffset) < header.length) return 'unknown';
      if (header.toString('ascii', 0, 4) !== 'PE\0\0') return 'unknown';
      const machine = header.readUInt16LE(4);
      if (machine === 0x014c) return 'x86';
      if (machine === 0x8664) return 'x64';
      if (machine === 0xaa64) return 'arm64';
      if (machine === 0x01c0 || machine === 0x01c4) return 'arm';
      return `pe-0x${machine.toString(16)}`;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'unknown';
  }
}

function sqliteCandidates(input) {
  return [
    argValue('--sqlite'),
    argValue('--sqlite-path'),
    input.sqlitePath,
    input.sqliteExe,
    process.env.AI_CONTENT_SQLITE_EXE,
    process.env.SQLITE_EXE,
    path.join(__dirname, 'sqlite3.exe'),
    path.join(__dirname, 'sqlite3'),
    'sqlite3.exe',
    'sqlite3',
  ].filter(Boolean);
}

function resolveSqlite(input = {}) {
  const attempts = [];
  for (const candidate of sqliteCandidates(input)) {
    const text = String(candidate);
    const isPathLike = text.includes(path.sep) || text.includes('/') || /^[A-Za-z]:[\\/]/.test(text);
    if (isPathLike && !pathExists(text)) {
      attempts.push({ path: text, status: 'missing' });
      continue;
    }
    const result = run(text, ['-version'], { timeout: 5000 });
    const status = result.status === 0 ? 'ready' : 'failed';
    attempts.push({
      path: text,
      status,
      exitCode: result.status,
      error: compactText((result.error && result.error.message) || result.stderr || result.stdout),
    });
    if (result.status === 0) {
      return { path: text, attempts };
    }
  }
  return { path: '', attempts };
}

function isPlainSqliteDatabase(dbPath) {
  try {
    const fd = fs.openSync(dbPath, 'r');
    try {
      const header = Buffer.alloc(16);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      return read === header.length && header.equals(Buffer.from('SQLite format 3\0', 'ascii'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function externalToolCandidates(input = {}) {
  const home = os.homedir();
  const dirs = uniquePaths([
    __dirname,
    path.join(__dirname, '..', 'wechat-db-helper'),
    path.join(__dirname, '..', 'wechat-native-runtime'),
    process.cwd(),
    path.join(process.cwd(), 'bin'),
    path.join(process.cwd(), 'tools'),
    path.join(home, 'Documents', 'dt-ai-helper', 'bin', 'DbKey'),
    path.join(home, 'Documents', 'Kaypal', 'DbKey'),
    path.join(home, 'Documents', 'DbKey'),
  ]);
  const fromDirs = (names) => {
    const out = [];
    for (const dir of dirs) {
      for (const name of names) out.push(path.join(dir, name));
    }
    return out;
  };
  const dbKeyExplicit = []
    .concat(input.dbKeyHelperPath || [])
    .concat(input.dbKeyCommandPath || [])
    .concat(input.dbKeyToolPath || [])
    .concat(Array.isArray(input.dbKeyHelperPaths) ? input.dbKeyHelperPaths : [])
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_DBKEY_EXE))
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_DB_KEY_EXE))
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_KEY_HELPER));
  const dumpRsExplicit = []
    .concat(input.wechatDumpRsPath || [])
    .concat(input.rawKeyToolPath || [])
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_DUMP_RS_EXE))
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_RAW_KEY_EXE));
  const wxKeyDllExplicit = []
    .concat(input.wxKeyDllPath || [])
    .concat(input.wechatKeyDllPath || [])
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_WX_KEY_DLL));
  const sqlcipherExplicit = []
    .concat(input.sqlcipherPath || [])
    .concat(input.sqlcipherExe || [])
    .concat(splitPathList(process.env.AI_CONTENT_WECHAT_SQLCIPHER_EXE))
    .concat(splitPathList(process.env.SQLCIPHER_EXE));
  return {
    dbKey: uniquePaths(dbKeyExplicit.concat(fromDirs(['DbkeyHookCMD.exe', 'DbKeyHookCMD.exe', 'Dbkey.exe', 'DbKey.exe']))),
    dumpRs: uniquePaths(dumpRsExplicit.concat(fromDirs(['wechat-dump-rs.exe']))),
    wxKeyDll: uniquePaths(wxKeyDllExplicit.concat(fromDirs(['wx_key.dll']))),
    sqlcipher: uniquePaths(sqlcipherExplicit.concat(fromDirs(['sqlcipher.exe', 'sqlcipher']))),
  };
}

function resolveExternalKeyTools(input = {}, diagnostics = {}) {
  const candidates = externalToolCandidates(input);
  const dbKey = candidates.dbKey.map(describeToolCandidate);
  const dumpRs = candidates.dumpRs.map(describeToolCandidate);
  const wxKeyDll = candidates.wxKeyDll.map(describeToolCandidate);
  const sqlcipher = candidates.sqlcipher.map(describeToolCandidate);
  diagnostics.externalKeyToolCandidates = {
    dbKey: dbKey.slice(0, 30),
    dumpRs: dumpRs.slice(0, 30),
    wxKeyDll: wxKeyDll.slice(0, 30),
    sqlcipher: sqlcipher.slice(0, 30),
  };
  return {
    dbKey: firstReadyTool(dbKey),
    dumpRs: firstReadyTool(dumpRs),
    wxKeyDll: firstReadyTool(wxKeyDll),
    sqlcipher: firstReadyTool(sqlcipher),
  };
}

function normalizeHexSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^0x/i, '').replace(/[^A-Fa-f0-9]/g, '').toLowerCase();
  if (!stripped || stripped.length % 2 !== 0) return '';
  return stripped;
}

function extractHexSecrets(text, allowedLengths = []) {
  const wanted = new Set((allowedLengths || []).map(Number).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(/(?:0x)?[A-Fa-f0-9]{64,128}/g)) {
    const hex = normalizeHexSecret(match[0]);
    if (!hex) continue;
    if (wanted.size && !wanted.has(hex.length)) continue;
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

function secretFingerprint(secret) {
  const hex = normalizeHexSecret(secret);
  return hex ? sha256Hex(hex).slice(0, 16) : '';
}

function redactSecrets(value) {
  return compactText(value)
    .replace(/(?:0x)?[A-Fa-f0-9]{64,128}/g, '[hex-secret]')
    .slice(0, 700);
}

function isNativeToolCrashExitCode(code) {
  const numeric = Number(code);
  return numeric === 3221225477 || numeric === -1073741819;
}

function classifyNativeToolAttemptStatus(result, successStatus, missingStatus) {
  if (successStatus) return successStatus;
  if (!result) return missingStatus;
  if (isNativeToolCrashExitCode(result.status)) return 'tool-crashed';
  if (result.error && result.error.code === 'ETIMEDOUT') return 'tool-timeout';
  return missingStatus;
}

function classifyDumpRsFailureStatus(result, text, fallbackStatus = 'failed') {
  const base = classifyNativeToolAttemptStatus(result, '', fallbackStatus);
  if (base !== fallbackStatus) return base;
  const output = compactText(text).toLowerCase();
  if (/unbale to find user info|unable to find user info|find user info/.test(output)) {
    return 'unsupported-wechat-profile-layout';
  }
  if (/unbale to find phone type string|unable to find phone type string|phone type string/.test(output)) {
    return 'unsupported-wechat-subprocess';
  }
  if (/param error|invalid.*param|argument/i.test(output)) {
    return 'unsupported-command-arguments';
  }
  if (/unsupported|not support|不支持/i.test(output)) {
    return 'unsupported-wechat-version';
  }
  return fallbackStatus;
}

function isMainWechatProcessName(value) {
  return /^(weixin|wechat)(\.exe)?$/i.test(compactText(value));
}

const processArchitectureCache = new Map();

function describeWindowsProcessArchitecture(processId) {
  const pid = Number(processId);
  if (!Number.isFinite(pid) || pid <= 0 || process.platform !== 'win32') {
    return {
      processId: pid || 0,
      processName: '',
      executablePath: '',
      architecture: process.platform === 'win32' ? 'unknown' : 'unsupported-platform',
      status: 'skipped',
    };
  }
  if (processArchitectureCache.has(pid)) return processArchitectureCache.get(pid);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$pidValue = ${pid}
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue"
if (-not $p) {
  [ordered]@{ ok = $false; processId = $pidValue; status = 'not-found' } | ConvertTo-Json -Compress
  exit 0
}
[ordered]@{
  ok = $true
  processId = $pidValue
  processName = $p.Name
  executablePath = $p.ExecutablePath
  status = if ([string]::IsNullOrWhiteSpace($p.ExecutablePath)) { 'path-missing' } else { 'ready' }
} | ConvertTo-Json -Compress
`;
  const result = runPowerShellScript(script, 12000);
  const jsonLine = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .pop();
  const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
  const executablePath = compactText(parsed.executablePath || '');
  const item = {
    processId: pid,
    processName: compactText(parsed.processName || ''),
    executablePath,
    architecture: executablePath ? describePortableExecutableArchitecture(executablePath) : 'unknown',
    status: parsed.status || (parsed.ok ? 'ready' : 'failed'),
    error: compactText(parsed.error || parsed.parseError || result.stderr || result.error?.message || ''),
  };
  processArchitectureCache.set(pid, item);
  return item;
}

function describeWechatProcesses(input = {}, options = {}) {
  return discoverWechatProcessIds(input, options)
    .map((pid) => describeWindowsProcessArchitecture(pid))
    .filter((item) => item.processId);
}

function isToolArchitectureCompatibleWithProcess(toolArchitecture, processArchitecture) {
  const tool = compactText(toolArchitecture).toLowerCase();
  const target = compactText(processArchitecture).toLowerCase();
  if (!tool || !target || tool === 'unknown' || target === 'unknown') return true;
  if (tool === 'x86' && (target === 'x64' || target === 'arm64')) return false;
  if (tool === 'arm' && target === 'arm64') return false;
  return true;
}

function discoverWechatProcessIds(input = {}, options = {}) {
  const mainOnly = Boolean(options.mainOnly);
  const items = [];
  const addItem = (value, meta = {}) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    items.push({
      processId: id,
      processName: compactText(meta.processName || meta.name || ''),
      mainWindowHandle: Number(meta.mainWindowHandle) || 0,
      workingSet64: Number(meta.workingSet64) || 0,
      wechatFilesPath: compactText(meta.wechatFilesPath || ''),
    });
  };
  addItem(input.processId, input);
  if (input.process && typeof input.process === 'object') {
    addItem(input.process.processId, input.process);
    const fromProcess = Array.isArray(input.process.wechatProcesses) ? input.process.wechatProcesses : [];
    for (const item of fromProcess) addItem(item.processId || item.Id || item.id, item);
  }
  const processLists = []
    .concat(Array.isArray(input.processes) ? input.processes : [])
    .concat(Array.isArray(input.wechatProcesses) ? input.wechatProcesses : []);
  for (const item of processLists) addItem(item.processId || item.Id || item.id, item);
  addItem(process.env.AI_CONTENT_WECHAT_PID, { processName: 'env' });
  addItem(process.env.WECHAT_PID, { processName: 'env' });
  const sortItems = () => {
    const seen = new Set();
    return items
      .sort((left, right) => {
        const leftName = left.processName.toLowerCase();
        const rightName = right.processName.toLowerCase();
        const leftRank = /^(weixin|wechat)(\.exe)?$/.test(leftName) ? 3 : /^wechatappex(\.exe)?$/.test(leftName) ? 1 : 2;
        const rightRank = /^(weixin|wechat)(\.exe)?$/.test(rightName) ? 3 : /^wechatappex(\.exe)?$/.test(rightName) ? 1 : 2;
        if (leftRank !== rightRank) return rightRank - leftRank;
        const leftWindow = left.mainWindowHandle ? 1 : 0;
        const rightWindow = right.mainWindowHandle ? 1 : 0;
        if (leftWindow !== rightWindow) return rightWindow - leftWindow;
        if (left.workingSet64 !== right.workingSet64) return right.workingSet64 - left.workingSet64;
        return left.processId - right.processId;
      })
      .filter((item) => {
        if (mainOnly && !isMainWechatProcessName(item.processName)) return false;
        if (seen.has(item.processId)) return false;
        seen.add(item.processId);
        return true;
      });
  };
  const sortIds = () => {
    let sorted = sortItems();
    if (mainOnly && !sorted.length) {
      sorted = items
        .slice()
        .sort((left, right) => right.workingSet64 - left.workingSet64)
        .slice(0, 1);
    }
    const seen = new Set();
    return sorted
      .map((item) => item.processId)
      .filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  };
  if (items.length || process.platform !== 'win32') return sortIds();
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$names = ${mainOnly ? "@('WeChat','Weixin')" : "@('WeChat','Weixin','WeChatAppEx')"}
Get-Process | Where-Object { $_.ProcessName -in $names } |
  Sort-Object @{ Expression = { if ($_.ProcessName -in @('WeChat','Weixin')) { 3 } elseif ($_.ProcessName -eq 'WeChatAppEx') { 1 } else { 2 } }; Descending = $true }, @{ Expression = { if ($_.MainWindowHandle -ne 0) { 1 } else { 0 } }; Descending = $true }, @{ Expression = 'WorkingSet64'; Descending = $true }, @{ Expression = 'Id'; Descending = $false } |
  Select-Object ProcessName,Id,MainWindowHandle,WorkingSet64 |
  ConvertTo-Json -Depth 3 -Compress
`;
  const result = runPowerShellScript(script, 12000);
  if (result.status !== 0) return [];
  const parsed = safeJsonParse(String(result.stdout || '').trim());
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  for (const item of rows) addItem(item.Id, {
    processName: item.ProcessName,
    mainWindowHandle: item.MainWindowHandle,
    workingSet64: item.WorkingSet64,
  });
  return sortIds();
}

function readSiblingDbKey(toolPath) {
  const candidates = uniquePaths([
    path.join(path.dirname(toolPath), 'dbkey.txt'),
    path.join(process.cwd(), 'dbkey.txt'),
  ]);
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      const key = extractHexSecrets(text, [64])[0];
      if (key) return { key, path: candidate };
    } catch {
      // Try next dbkey.txt location.
    }
  }
  return null;
}

function runDbKeyCommand(toolPath, input, diagnostics) {
  const attempts = diagnostics.externalDbKeyAttempts || [];
  diagnostics.externalDbKeyAttempts = attempts;
  if (!toolPath) return '';
  const processIds = discoverWechatProcessIds(input, { mainOnly: true });
  const toolArchitecture = describePortableExecutableArchitecture(toolPath);
  const processArchitectures = processIds.map((pid) => describeWindowsProcessArchitecture(pid));
  diagnostics.wechatProcessArchitectures = [
    ...((diagnostics.wechatProcessArchitectures || []).filter((item) => item && item.processId) || []),
    ...processArchitectures,
  ].slice(0, 30);
  const compatibleProcessIds = processIds.filter((pid) => {
    const processInfo = processArchitectures.find((item) => item.processId === pid);
    return isToolArchitectureCompatibleWithProcess(toolArchitecture, processInfo && processInfo.architecture);
  });
  diagnostics.externalKeyToolCompatibility = [
    ...((diagnostics.externalKeyToolCompatibility || []).filter(Boolean) || []),
    {
      toolPath,
      toolArchitecture,
      targetProcesses: processArchitectures.map((item) => ({
        processId: item.processId,
        processName: item.processName,
        architecture: item.architecture,
        status: item.status,
      })),
      compatibleProcessIds,
      status: compatibleProcessIds.length ? 'compatible-or-unknown' : 'incompatible',
      reason: compatibleProcessIds.length ? '' : 'tool-process-architecture-mismatch',
    },
  ].slice(0, 20);
  if (processIds.length && !compatibleProcessIds.length) {
    attempts.push({
      toolPath,
      args: [],
      status: 'tool-incompatible',
      reason: 'tool-process-architecture-mismatch',
      toolArchitecture,
      targetProcesses: processArchitectures.map((item) => ({
        processId: item.processId,
        processName: item.processName,
        architecture: item.architecture,
      })),
    });
    return '';
  }
  const lowerName = path.basename(toolPath).toLowerCase();
  const argSets = [];
  if (lowerName.includes('dbkeyhookcmd')) {
    for (const pid of compatibleProcessIds) {
      argSets.push(['-pid', String(pid)]);
      argSets.push(['--pid', String(pid)]);
      argSets.push(['-p', String(pid)]);
    }
    for (const pid of compatibleProcessIds) {
      argSets.push(['-r', '-pid', String(pid)]);
      argSets.push(['-r', '-p', String(pid)]);
    }
    argSets.push([]);
  } else {
    for (const pid of compatibleProcessIds) {
      argSets.push(['-pid', String(pid)]);
      argSets.push(['--pid', String(pid)]);
      argSets.push(['-p', String(pid)]);
    }
    argSets.push([]);
  }
  const uniqueArgSets = [];
  const seen = new Set();
  for (const args of argSets) {
    const key = JSON.stringify(args);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueArgSets.push(args);
  }
  for (const args of uniqueArgSets) {
    const result = run(toolPath, args, {
      cwd: path.dirname(toolPath),
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const key = extractHexSecrets(text, [64])[0];
    const sibling = key ? null : readSiblingDbKey(toolPath);
    const foundKey = key || (sibling && sibling.key) || '';
    const status = classifyNativeToolAttemptStatus(
      result,
      foundKey ? 'key-found' : '',
      'key-missing',
    );
    attempts.push({
      toolPath,
      args,
      status,
      exitCode: result.status,
      signal: result.signal || '',
      crashCode: isNativeToolCrashExitCode(result.status) ? result.status : undefined,
      keyFingerprint: secretFingerprint(foundKey),
      dbkeyTextPath: sibling ? sibling.path : '',
      output: redactSecrets(text || result.error?.message || ''),
    });
    if (foundKey) return foundKey;
  }
  return '';
}

function outputDirectoryForTool(dbPath, label) {
  const key = sha256Hex(`${dbPath}|${label}|${Date.now()}|${Math.random()}`).slice(0, 20);
  return path.join(DECRYPTED_DB_ROOT, `tool-${key}`);
}

function walkFiles(root, options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 240);
  const maxDepth = Math.max(0, Number(options.maxDepth) || 8);
  const out = [];
  const stack = [{ dir: root, depth: 0 }];
  const seen = new Set();
  while (stack.length && out.length < maxFiles) {
    const current = stack.pop();
    const key = normalizedPathKey(current.dir);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile()) {
        out.push(full);
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

function findDumpedContactDb(outputDir, originalDbPath) {
  if (!pathExists(outputDir)) return '';
  const originalName = path.basename(originalDbPath || '').toLowerCase();
  const originalInfo = describeDbCandidate(originalDbPath || '');
  const files = walkFiles(outputDir, { maxFiles: 500, maxDepth: 10 })
    .filter((item) => isPlainSqliteDatabase(item))
    .map((item) => {
      const lower = item.toLowerCase();
      let score = 0;
      if (path.basename(item).toLowerCase() === originalName) score += 100;
      if (/contact/.test(lower)) score += 80;
      if (/db_storage[\\/]+contact/.test(lower)) score += 80;
      if (originalInfo.accountFolder && lower.includes(originalInfo.accountFolder.toLowerCase())) score += 60;
      const stat = safeStat(item);
      score += Math.min(80, Math.floor((Number(stat?.size) || 0) / 1024 / 1024));
      return { path: item, score, size: Number(stat?.size) || 0 };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return right.size - left.size;
    });
  return files[0]?.path || '';
}

function dumpRsDataDirs(input, dbPath) {
  const info = extractDbAccountInfo(dbPath);
  const dirs = [];
  if (info.accountRoot) {
    dirs.push(info.accountRoot);
    const parent = path.dirname(info.accountRoot);
    if (parent && parent !== info.accountRoot) dirs.push(parent);
  }
  dirs.push(...inputWechatFilesRoots(input));
  return uniquePaths(dirs).filter(pathExists);
}

function runDumpRsPidDecrypt(toolPath, dbPath, input, diagnostics, originalDbPath = dbPath) {
  const attempts = diagnostics.externalDumpRsPidAttempts || [];
  diagnostics.externalDumpRsPidAttempts = attempts;
  if (!toolPath || process.platform !== 'win32') return null;
  const processIds = discoverWechatProcessIds(input, { mainOnly: true });
  const toolArchitecture = describePortableExecutableArchitecture(toolPath);
  const processArchitectures = processIds.map((pid) => describeWindowsProcessArchitecture(pid));
  diagnostics.wechatProcessArchitectures = [
    ...((diagnostics.wechatProcessArchitectures || []).filter((item) => item && item.processId) || []),
    ...processArchitectures,
  ].slice(0, 30);
  diagnostics.externalKeyToolCompatibility = [
    ...((diagnostics.externalKeyToolCompatibility || []).filter(Boolean) || []),
    {
      toolPath,
      toolArchitecture,
      targetProcesses: processArchitectures.map((item) => ({
        processId: item.processId,
        processName: item.processName,
        architecture: item.architecture,
        status: item.status,
      })),
      compatibleProcessIds: processIds,
      status: 'compatible-or-unknown',
      reason: '',
    },
  ].slice(0, 20);
  if (!processIds.length) {
    attempts.push({
      toolPath,
      status: 'blocked',
      reason: 'wechat-process-not-found',
      toolArchitecture,
    });
    return null;
  }

  const argPlans = [];
  const enableFileMode = process.env.AI_CONTENT_WECHAT_DUMPRS_ENABLE_FILE_MODE === '1';
  for (const pid of processIds) {
    if (enableFileMode) {
      const fileOutDir = outputDirectoryForTool(originalDbPath, `dumprs-file-${pid}`);
      argPlans.push({
        pid,
        outDir: fileOutDir,
        args: ['-p', String(pid), '-f', dbPath, '-o', fileOutDir, '--vv', '4'],
        label: 'pid-file',
      });
    }
    for (const dataDir of dumpRsDataDirs(input, originalDbPath)) {
      const dataOutDir = outputDirectoryForTool(originalDbPath, `dumprs-data-${pid}`);
      argPlans.push({
        pid,
        outDir: dataOutDir,
        args: ['-p', String(pid), '-d', dataDir, '-o', dataOutDir, '-a', '--vv', '4'],
        label: 'pid-data-all',
      });
    }
    const autoOutDir = outputDirectoryForTool(originalDbPath, `dumprs-auto-${pid}`);
    argPlans.push({
      pid,
      outDir: autoOutDir,
      args: ['-p', String(pid), '-o', autoOutDir, '-a', '--vv', '4'],
      label: 'pid-auto-all',
    });
  }

  const seen = new Set();
  for (const plan of argPlans) {
    const key = JSON.stringify(plan.args);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      fs.mkdirSync(plan.outDir, { recursive: true });
    } catch {
      // The process run below will report a clearer failure.
    }
    const result = run(toolPath, plan.args, {
      cwd: path.dirname(toolPath),
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const dumpedDbPath = findDumpedContactDb(plan.outDir, originalDbPath);
    const status = dumpedDbPath ? 'decrypted' : classifyDumpRsFailureStatus(result, text, 'failed');
    const processInfo = processArchitectures.find((item) => item.processId === plan.pid);
    const attempt = {
      toolPath,
      args: plan.args.map((arg) => (String(arg).length >= 64 && /^[A-Fa-f0-9]+$/.test(String(arg)) ? '[hex-secret]' : arg)),
      pid: plan.pid,
      processName: processInfo?.processName || '',
      processArchitecture: processInfo?.architecture || '',
      toolArchitecture,
      label: plan.label,
      status,
      exitCode: result.status,
      signal: result.signal || '',
      crashCode: isNativeToolCrashExitCode(result.status) ? result.status : undefined,
      outputDir: plan.outDir,
      outputPath: dumpedDbPath,
      output: redactSecrets(text || result.error?.message || ''),
    };
    attempts.push(attempt);
    if (dumpedDbPath) {
      diagnostics.decryptionStatus = 'completed';
      diagnostics.keyHelperStatus = 'external-dumprs-decrypted';
      diagnostics.dbKeyStatus = 'decrypted-with-dumprs-pid';
      diagnostics.externalKeyMethod = 'wechat-dump-rs-pid';
      diagnostics.decryptedDbPaths = uniquePaths([...(diagnostics.decryptedDbPaths || []), dumpedDbPath]);
      return { path: dumpedDbPath, source: 'windows-wechat-db-decrypted-dumprs', attempt };
    }
  }
  return null;
}

function runWxKeyDll(dllPath, input, diagnostics) {
  const attempts = diagnostics.externalWxKeyDllAttempts || [];
  diagnostics.externalWxKeyDllAttempts = attempts;
  if (!dllPath || process.platform !== 'win32') return '';
  const dllArchitecture = describePortableExecutableArchitecture(dllPath);
  const timeoutSeconds = Math.max(10, Math.min(Number(process.env.AI_CONTENT_WECHAT_WX_KEY_TIMEOUT_SECONDS) || 45, 180));
  const processIds = discoverWechatProcessIds(input, { mainOnly: true });
  const processArchitectures = processIds.map((pid) => describeWindowsProcessArchitecture(pid));
  diagnostics.wechatProcessArchitectures = [
    ...((diagnostics.wechatProcessArchitectures || []).filter((item) => item && item.processId) || []),
    ...processArchitectures,
  ].slice(0, 30);
  diagnostics.externalKeyToolCompatibility = [
    ...((diagnostics.externalKeyToolCompatibility || []).filter(Boolean) || []),
    {
      toolPath: dllPath,
      toolArchitecture: dllArchitecture,
      targetProcesses: processArchitectures.map((item) => ({
        processId: item.processId,
        processName: item.processName,
        architecture: item.architecture,
        status: item.status,
      })),
      compatibleProcessIds: processIds,
      status: 'compatible-or-unknown',
      reason: '',
    },
  ].slice(0, 20);
  for (const pid of processIds) {
    const processInfo = processArchitectures.find((item) => item.processId === pid);
    const script = `
$ErrorActionPreference = 'Stop'
$dllPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(dllPath)}'))
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class KaypalWxKeyProbe
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeLibrary(IntPtr hModule);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate bool InitializeHookDelegate(UInt32 pid);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate bool PollKeyDataDelegate(byte[] buffer, int size);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate bool GetStatusMessageDelegate(byte[] buffer, int size, ref int level);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate bool CleanupHookDelegate();

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate IntPtr GetLastErrorMsgDelegate();

    static T Get<T>(IntPtr module, string name) where T : class
    {
        IntPtr proc = GetProcAddress(module, name);
        if (proc == IntPtr.Zero) throw new InvalidOperationException("missing export " + name);
        return Marshal.GetDelegateForFunctionPointer(proc, typeof(T)) as T;
    }

    static string ReadBuffer(byte[] buffer)
    {
        int len = 0;
        while (len < buffer.Length && buffer[len] != 0) len++;
        return Encoding.UTF8.GetString(buffer, 0, len);
    }

    static string PtrString(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero) return "";
        try { return Marshal.PtrToStringAnsi(ptr) ?? ""; } catch { return ""; }
    }

    public static Dictionary<string, object> Dump(string dllPath, UInt32 pid, int timeoutSeconds)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        List<string> logs = new List<string>();
        IntPtr module = LoadLibrary(dllPath);
        result["pid"] = pid;
        result["dllPath"] = dllPath;
        if (module == IntPtr.Zero)
        {
            result["ok"] = false;
            result["error"] = "LoadLibrary failed " + Marshal.GetLastWin32Error();
            result["logs"] = logs.ToArray();
            return result;
        }
        try
        {
            InitializeHookDelegate initialize = Get<InitializeHookDelegate>(module, "InitializeHook");
            PollKeyDataDelegate poll = Get<PollKeyDataDelegate>(module, "PollKeyData");
            GetStatusMessageDelegate status = Get<GetStatusMessageDelegate>(module, "GetStatusMessage");
            CleanupHookDelegate cleanup = Get<CleanupHookDelegate>(module, "CleanupHook");
            GetLastErrorMsgDelegate lastError = Get<GetLastErrorMsgDelegate>(module, "GetLastErrorMsg");
            bool initOk = false;
            try { initOk = initialize(pid); } catch (Exception ex) { logs.Add("InitializeHook exception: " + ex.GetType().Name); }
            if (!initOk)
            {
                string initError = PtrString(lastError());
                if (!String.IsNullOrWhiteSpace(initError)) logs.Add("InitializeHook returned false: " + initError);
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
            int emptyCount = 0;
            while (DateTime.UtcNow < deadline)
            {
                byte[] keyBuffer = new byte[128];
                try
                {
                    if (poll(keyBuffer, keyBuffer.Length))
                    {
                        string key = ReadBuffer(keyBuffer).Trim();
                        if (!String.IsNullOrWhiteSpace(key))
                        {
                            result["ok"] = true;
                            result["key"] = key;
                            result["logs"] = logs.ToArray();
                            try { cleanup(); } catch {}
                            return result;
                        }
                    }
                }
                catch (Exception ex)
                {
                    logs.Add("PollKeyData exception: " + ex.GetType().Name);
                }
                byte[] logBuffer = new byte[512];
                int level = 0;
                try
                {
                    if (status(logBuffer, logBuffer.Length, ref level))
                    {
                        string message = ReadBuffer(logBuffer);
                        if (logs.Count < 12 && !String.IsNullOrWhiteSpace(message)) logs.Add("L" + level + ":" + message);
                        if (String.IsNullOrWhiteSpace(message) && level == 0) emptyCount++; else emptyCount = 0;
                        if (message.Contains("已成功接收到密钥")) break;
                    }
                }
                catch (Exception ex)
                {
                    logs.Add("GetStatusMessage exception: " + ex.GetType().Name);
                }
                if (emptyCount >= 3)
                {
                    try { cleanup(); } catch {}
                    Thread.Sleep(1000);
                    try { initialize(pid); } catch {}
                    emptyCount = 0;
                }
                Thread.Sleep(500);
            }
            result["ok"] = false;
            result["error"] = "wx_key.dll did not return db key before timeout";
            result["logs"] = logs.ToArray();
            try { cleanup(); } catch {}
            return result;
        }
        catch (Exception ex)
        {
            result["ok"] = false;
            result["error"] = ex.GetType().FullName + ": " + ex.Message;
            result["logs"] = logs.ToArray();
            return result;
        }
        finally
        {
            FreeLibrary(module);
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
[KaypalWxKeyProbe]::Dump($dllPath, [uint32]${Number(pid)}, [int]${timeoutSeconds}) | ConvertTo-Json -Depth 5 -Compress
`;
    const result = runPowerShellScript(script, (timeoutSeconds + 15) * 1000);
    const jsonLine = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .pop();
    const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
    const key = normalizeHexSecret(parsed.key || '');
    attempts.push({
      dllPath,
      pid,
      processName: processInfo?.processName || '',
      processArchitecture: processInfo?.architecture || '',
      dllArchitecture,
      status: key ? 'key-found' : 'key-missing',
      exitCode: result.status,
      keyFingerprint: secretFingerprint(key),
      error: redactSecrets(parsed.error || parsed.parseError || result.stderr || result.stdout || result.error?.message || ''),
      logs: Array.isArray(parsed.logs) ? parsed.logs.map(redactSecrets).slice(0, 12) : [],
    });
    if (key && key.length === 64) return key;
  }
  return '';
}

function runRawKeyCommand(toolPath, dbKeyHex, dbPath, diagnostics) {
  const attempts = diagnostics.externalRawKeyAttempts || [];
  diagnostics.externalRawKeyAttempts = attempts;
  if (!toolPath || !dbKeyHex) return '';
  const args = ['-k', dbKeyHex, '-f', dbPath, '-r', '--vv', '4'];
  const result = run(toolPath, args, {
    cwd: path.dirname(toolPath),
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const rawKey = extractHexSecrets(text, [96, 64])
    .sort((left, right) => right.length - left.length)[0] || '';
  attempts.push({
    toolPath,
    args: ['-k', '[db-key]', '-f', dbPath, '-r', '--vv', '4'],
    status: rawKey ? 'raw-key-found' : 'raw-key-missing',
    exitCode: result.status,
    rawKeyFingerprint: secretFingerprint(rawKey),
    output: redactSecrets(text || result.error?.message || ''),
  });
  return rawKey;
}

function sqlCipherMacKey(encKey, salt) {
  const macSalt = Buffer.from(salt);
  for (let index = 0; index < macSalt.length; index += 1) macSalt[index] ^= 0x3a;
  return crypto.pbkdf2Sync(encKey, macSalt, 2, 32, 'sha512');
}

function verifySqlCipherKey(encKey, page) {
  if (!Buffer.isBuffer(encKey) || encKey.length !== 32 || !Buffer.isBuffer(page) || page.length < 4096) {
    return false;
  }
  const salt = page.subarray(0, 16);
  const macKey = sqlCipherMacKey(encKey, salt);
  const hmacData = page.subarray(16, 4096 - 80 + 16);
  const expected = page.subarray(4096 - 64, 4096);
  const pageNo = Buffer.from([1, 0, 0, 0]);
  const actual = crypto.createHmac('sha512', macKey).update(hmacData).update(pageNo).digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function decryptSqlCipherDatabaseWithKey(dbPath, outputPath, keyHex) {
  const normalized = normalizeHexSecret(keyHex);
  if (normalized.length < 64) {
    return { ok: false, error: 'key is shorter than 32 bytes' };
  }
  const encKey = Buffer.from(normalized.slice(0, 64), 'hex');
  const input = fs.openSync(dbPath, 'r');
  try {
    const firstPage = Buffer.alloc(4096);
    const firstRead = fs.readSync(input, firstPage, 0, firstPage.length, 0);
    if (firstRead < 4096) return { ok: false, error: 'contact.db is smaller than one SQLCipher page' };
    if (!verifySqlCipherKey(encKey, firstPage)) return { ok: false, error: 'HMAC verification failed' };
  } finally {
    fs.closeSync(input);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const source = fs.openSync(dbPath, 'r');
  const target = fs.openSync(outputPath, 'w');
  try {
    let pageNo = 1;
    let position = 0;
    while (true) {
      const page = Buffer.alloc(4096);
      const read = fs.readSync(source, page, 0, page.length, position);
      if (read === 0) break;
      if (read < 4096) break;
      const start = pageNo === 1 ? 16 : 0;
      const cipherText = page.subarray(start, 4096 - 80);
      const iv = page.subarray(4096 - 80, 4096 - 80 + 16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
      decipher.setAutoPadding(false);
      const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
      const pageOut = Buffer.alloc(4096);
      if (pageNo === 1) {
        Buffer.from('SQLite format 3\0', 'ascii').copy(pageOut, 0);
        plain.copy(pageOut, 16);
      } else {
        plain.copy(pageOut, 0);
      }
      fs.writeSync(target, pageOut, 0, pageOut.length, position);
      pageNo += 1;
      position += 4096;
    }
  } finally {
    fs.closeSync(source);
    fs.closeSync(target);
  }
  return {
    ok: isPlainSqliteDatabase(outputPath),
    outputPath,
    outputBytes: safeStat(outputPath)?.size || 0,
  };
}

function decryptWithExternalKeyTools(dbPath, input, diagnostics, originalDbPath = dbPath) {
  const attempts = diagnostics.decryptAttempts || [];
  diagnostics.decryptAttempts = attempts;
  const tools = resolveExternalKeyTools(input, diagnostics);
  diagnostics.externalKeyToolStatus = tools.dbKey || tools.wxKeyDll || tools.dumpRs ? 'detected' : 'missing';
  diagnostics.externalRawKeyToolStatus = tools.dumpRs ? 'detected' : 'missing';

  const suppliedRawKey = normalizeHexSecret(
    input.rawKey || input.wechatRawKey || process.env.AI_CONTENT_WECHAT_RAW_KEY || '',
  );
  let dbKey = normalizeHexSecret(
    input.dbKey || input.wechatDbKey || process.env.AI_CONTENT_WECHAT_DB_KEY || '',
  );

  if (tools.dumpRs) {
    const dumped = runDumpRsPidDecrypt(tools.dumpRs.path, dbPath, input, diagnostics, originalDbPath);
    if (dumped && dumped.path) return dumped;
  }

  if (!dbKey && tools.dbKey) dbKey = runDbKeyCommand(tools.dbKey.path, input, diagnostics);
  if (!dbKey && tools.wxKeyDll) dbKey = runWxKeyDll(tools.wxKeyDll.path, input, diagnostics);
  let rawKey = suppliedRawKey;
  if (!rawKey && dbKey && tools.dumpRs) rawKey = runRawKeyCommand(tools.dumpRs.path, dbKey, dbPath, diagnostics);

  const keyAttempts = [];
  if (rawKey) keyAttempts.push({ kind: 'raw-key', key: rawKey });
  if (dbKey) keyAttempts.push({ kind: 'db-key', key: dbKey });
  if (!keyAttempts.length) {
    const externalAttempts = []
      .concat(diagnostics.externalDumpRsPidAttempts || [])
      .concat(diagnostics.externalDbKeyAttempts || [])
      .concat(diagnostics.externalWxKeyDllAttempts || []);
    const anyCrash = externalAttempts.some((attempt) => attempt && attempt.status === 'tool-crashed');
    const anyTimeout = externalAttempts.some((attempt) => attempt && attempt.status === 'tool-timeout');
    const anyIncompatible = externalAttempts.some((attempt) => attempt && attempt.status === 'tool-incompatible');
    const anyUnsupported = externalAttempts.some((attempt) =>
      attempt && /unsupported/.test(String(attempt.status || '')),
    );
    let externalKeyFailureReason = 'external-key-tool-missing';
    if (tools.dbKey || tools.wxKeyDll || tools.dumpRs) {
      if (anyIncompatible && anyUnsupported) externalKeyFailureReason = 'external-key-toolchain-incompatible-and-unsupported';
      else if (anyIncompatible) externalKeyFailureReason = 'external-key-tool-architecture-mismatch';
      else if (anyUnsupported) externalKeyFailureReason = 'external-key-tool-wechat-version-unsupported';
      else if (anyCrash) externalKeyFailureReason = 'external-key-tool-crashed';
      else if (anyTimeout) externalKeyFailureReason = 'external-key-tool-timeout';
      else externalKeyFailureReason = 'external-key-tools-returned-no-usable-key';
    }
    attempts.push({
      path: originalDbPath,
      sourcePath: dbPath,
      status: 'blocked',
      method: 'external-key-toolchain',
      reason: externalKeyFailureReason,
    });
    if (anyCrash) diagnostics.externalKeyToolCrash = true;
    if (anyTimeout) diagnostics.externalKeyToolTimeout = true;
    if (anyIncompatible) diagnostics.externalKeyToolIncompatible = true;
    if (anyUnsupported) diagnostics.externalKeyToolUnsupported = true;
    return null;
  }

  for (const keyAttempt of keyAttempts) {
    const outPath = stableDecryptedDbPath(`${originalDbPath}|${keyAttempt.kind}`);
    let result = null;
    try {
      result = decryptSqlCipherDatabaseWithKey(dbPath, outPath, keyAttempt.key);
    } catch (error) {
      result = { ok: false, error: compactText(error.message || error) };
    }
    const attempt = {
      path: originalDbPath,
      sourcePath: dbPath,
      status: result.ok ? 'decrypted' : 'failed',
      method: `external-${keyAttempt.kind}`,
      keyFingerprint: secretFingerprint(keyAttempt.key),
      outputPath: result.outputPath || outPath,
      outputBytes: Number(result.outputBytes) || 0,
      error: compactText(result.error || ''),
    };
    attempts.push(attempt);
    if (attempt.status === 'decrypted') {
      diagnostics.decryptionStatus = 'completed';
      diagnostics.keyHelperStatus = 'external-key-found';
      diagnostics.dbKeyStatus = 'decrypted-with-external-key';
      diagnostics.externalKeyMethod = keyAttempt.kind;
      diagnostics.decryptedDbPaths = uniquePaths([...(diagnostics.decryptedDbPaths || []), outPath]);
      return { path: outPath, source: 'windows-wechat-db-decrypted-external', attempt };
    }
  }
  return null;
}

function backendBundleCandidates(input = {}) {
  return uniquePaths([
    input.backendBundlePath,
    process.env.AI_CONTENT_BACKEND_BUNDLE,
    path.join(__dirname, '..', 'backend', 'index.js'),
    path.join(__dirname, '..', '..', '..', 'backend', 'dist-bundle-sqlite', 'index.js'),
    path.join(__dirname, '..', '..', '..', 'backend', 'src', 'modules', 'local-engine', 'local-engine.service.ts'),
    path.join(process.cwd(), 'backend', 'dist-bundle-sqlite', 'index.js'),
    path.join(process.cwd(), 'backend', 'src', 'modules', 'local-engine', 'local-engine.service.ts'),
  ]).filter(pathExists);
}

function extractDecryptorSourceBase64(text) {
  const matches = String(text || '').matchAll(/FromBase64String\('([A-Za-z0-9+/=]{10000,})'\)/g);
  for (const match of matches) {
    const candidate = match[1];
    try {
      const source = Buffer.from(candidate, 'base64').toString('utf8');
      if (source.includes('class KaypalWechatDbDecryptor') && source.includes('DecryptWithMemoryKey')) {
        return candidate;
      }
    } catch {
      // Try the next embedded source.
    }
  }
  return '';
}

function resolveDecryptorSourceBase64(input = {}, diagnostics = {}) {
  if (FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64) {
    diagnostics.decryptorSource = 'helper-fallback';
    return FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64;
  }
  const attempts = [];
  for (const candidate of backendBundleCandidates(input)) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      const sourceBase64 = extractDecryptorSourceBase64(text);
      attempts.push({ path: candidate, status: sourceBase64 ? 'found' : 'not-found' });
      if (sourceBase64) {
        diagnostics.decryptorSource = candidate;
        diagnostics.decryptorSourceAttempts = attempts;
        return sourceBase64;
      }
    } catch (error) {
      attempts.push({ path: candidate, status: 'failed', error: compactText(error.message || error) });
    }
  }
  diagnostics.decryptorSourceAttempts = attempts;
  return '';
}

function stableDecryptedDbPath(dbPath) {
  const key = sha256Hex(`${dbPath}|${safeStatFingerprint(dbPath)}`).slice(0, 32);
  return path.join(DECRYPTED_DB_ROOT, `contact-${key}.db`);
}

function safeStatFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}|${Number(stat.mtimeMs) || 0}`;
  } catch {
    return '';
  }
}

function writePowerShellScript(script) {
  const scriptPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-db-decrypt-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
  );
  const body = Buffer.from(String(script || ''), 'utf16le');
  fs.writeFileSync(scriptPath, Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
  return scriptPath;
}

function runPowerShellScript(script, timeout) {
  const scriptPath = writePowerShellScript(script);
  try {
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    try {
      fs.rmSync(scriptPath, { force: true });
    } catch {
      // Best effort temp cleanup.
    }
  }
}

function decryptWithMemoryKey(dbPath, input, diagnostics, originalDbPath = dbPath) {
  const attempts = diagnostics.decryptAttempts || [];
  diagnostics.decryptAttempts = attempts;
  const external = decryptWithExternalKeyTools(dbPath, input, diagnostics, originalDbPath);
  if (external && external.path) return external;
  if (process.platform !== 'win32') {
    attempts.push({ path: originalDbPath, sourcePath: dbPath, status: 'skipped', reason: 'non-windows' });
    return null;
  }
  const deterministicExternalFailure =
    diagnostics.externalKeyToolIncompatible ||
    diagnostics.externalKeyToolUnsupported;
  if (
    deterministicExternalFailure &&
    process.env.AI_CONTENT_WECHAT_ALLOW_SLOW_MEMORY_SCAN !== '1'
  ) {
    attempts.push({
      path: originalDbPath,
      sourcePath: dbPath,
      status: 'skipped',
      method: 'process-memory-key-scan',
      reason: 'slow-memory-scan-disabled-after-deterministic-tool-failure',
    });
    diagnostics.decryptionStatus = diagnostics.decryptionStatus || 'failed';
    diagnostics.keyHelperStatus = 'native-key-helper-blocked';
    diagnostics.memoryScanStatus = 'skipped-deterministic-tool-failure';
    return null;
  }
  const sourceBase64 = resolveDecryptorSourceBase64(input, diagnostics);
  if (!sourceBase64) {
    attempts.push({ path: originalDbPath, sourcePath: dbPath, status: 'blocked', reason: 'decryptor-source-missing' });
    diagnostics.decryptionStatus = 'decryptor-missing';
    diagnostics.keyHelperStatus = 'missing';
    return null;
  }
  const outPath = stableDecryptedDbPath(originalDbPath);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  } catch {
    // Directory creation is checked by the decryptor result below.
  }
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $dbPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(dbPath)}'))
  $outPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(outPath)}'))
  $source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${sourceBase64}'))
  Add-Type -TypeDefinition $source -Language CSharp
  if (Test-Path -LiteralPath $outPath) { Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue }
  $key = [KaypalWechatDbDecryptor]::DecryptWithMemoryKey($dbPath, $outPath)
  $scanDiagnostics = ''
  try { $scanDiagnostics = [KaypalWechatDbDecryptor]::GetLastDiagnostics() } catch { $scanDiagnostics = '' }
  $keyFound = -not [string]::IsNullOrWhiteSpace($key)
  $keyFingerprint = ''
  if ($keyFound) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $keyFingerprint = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })
      if ($keyFingerprint.Length -gt 16) { $keyFingerprint = $keyFingerprint.Substring(0, 16) }
    } finally {
      $sha.Dispose()
    }
  }
  $exists = Test-Path -LiteralPath $outPath
  $bytes = if ($exists) { (Get-Item -LiteralPath $outPath).Length } else { 0 }
  [ordered]@{
    ok = ($keyFound -and $exists -and $bytes -gt 0)
    keyFound = $keyFound
    keyFingerprint = $keyFingerprint
    outputPath = $outPath
    outputBytes = $bytes
    scanDiagnostics = $scanDiagnostics
    decryptor = 'KaypalWechatDbDecryptor'
  } | ConvertTo-Json -Compress
} catch {
  $scanDiagnostics = ''
  try { $scanDiagnostics = [KaypalWechatDbDecryptor]::GetLastDiagnostics() } catch { $scanDiagnostics = '' }
  [ordered]@{
    ok = $false
    error = $_.Exception.Message
    errorType = $_.Exception.GetType().FullName
    scanDiagnostics = $scanDiagnostics
    decryptor = 'KaypalWechatDbDecryptor'
  } | ConvertTo-Json -Compress
  exit 3
}
`;
  const result = runPowerShellScript(script, 180000);
  const jsonLine = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .pop();
  const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
  const attempt = {
    path: originalDbPath,
    sourcePath: dbPath,
    status: parsed.ok && isPlainSqliteDatabase(outPath) ? 'decrypted' : 'failed',
    exitCode: result.status,
    keyFound: Boolean(parsed.keyFound),
    keyFingerprint: parsed.keyFingerprint || '',
    outputPath: parsed.outputPath || outPath,
    outputBytes: Number(parsed.outputBytes) || 0,
    scanDiagnostics: compactText(parsed.scanDiagnostics || ''),
    error: compactText(parsed.error || parsed.parseError || result.stderr || result.stdout || result.error?.message || ''),
  };
  attempts.push(attempt);
  if (attempt.status === 'decrypted') {
    diagnostics.decryptionStatus = 'completed';
    diagnostics.keyHelperStatus = 'memory-key-found';
    diagnostics.dbKeyStatus = 'decrypted-with-memory-key';
    diagnostics.decryptedDbPaths = uniquePaths([...(diagnostics.decryptedDbPaths || []), outPath]);
    return { path: outPath, source: 'windows-wechat-db-decrypted', attempt };
  }
  diagnostics.decryptionStatus = diagnostics.decryptionStatus || 'failed';
  diagnostics.keyHelperStatus = attempt.keyFound ? 'memory-key-found' : 'memory-key-missing';
  if (attempt.scanDiagnostics) diagnostics.keyScanDiagnostics = attempt.scanDiagnostics;
  return null;
}

function findFilesLimited(root, names, maxDepth = MAX_SCAN_DEPTH, maxCount = MAX_SCAN_FILES) {
  const found = [];
  if (!root || !pathExists(root)) return found;
  const wanted = new Set(names.map((item) => item.toLowerCase()));
  const queue = [{ dir: path.resolve(root), depth: 0 }];
  while (queue.length && found.length < maxCount) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (wanted.has(entry.name.toLowerCase())) {
        found.push(full);
        if (found.length >= maxCount) break;
      }
    }
  }
  return found;
}

function dbPathCandidates(input = {}) {
  const explicit = []
    .concat(allArgValues(['--db', '--db-path']))
    .concat(Array.isArray(input.dbPaths) ? input.dbPaths : [])
    .concat(input.dbPath ? [input.dbPath] : [])
    .concat(process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH ? [process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH] : []);
  const fromRoots = [];
  const roots = []
    .concat(Array.isArray(input.roots) ? input.roots : [])
    .concat(input.root ? [input.root] : [])
    .concat(process.env.AI_CONTENT_WECHAT_CONTACT_DB_DIR ? [process.env.AI_CONTENT_WECHAT_CONTACT_DB_DIR] : []);
  for (const root of roots) {
    fromRoots.push(...findFilesLimited(root, ['contact.db', 'Contact.db', 'MicroMsg.db', 'MSG.db']));
  }
  return rankDbPaths(explicit.concat(fromRoots), input);
}

function isSystemContactId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!id) return true;
  if (id.endsWith('@chatroom') || id.startsWith('gh_')) return true;
  return new Set([
    'fmessage',
    'qmessage',
    'tmessage',
    'weixin',
    'filehelper',
    'newsapp',
    'qqmail',
    'floatbottle',
    'lbsapp',
    'medianote',
    'qqsync',
    'weibo',
    'masssendapp',
    'feedsapp',
    'voip',
    'officialaccounts',
    'notification_messages',
    'notifymessage',
    'mphelper',
  ]).has(id);
}

function normalizeContactText(value) {
  const text = compactText(value);
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length < 2 || compact.length > 80) return '';
  if (/^(WeChat|Weixin|Contacts|Friends|OfficialAccounts|FileTransfer|Settings|Search)$/i.test(compact)) return '';
  if (/^[\d\s:.,/\\-]+$/.test(compact)) return '';
  if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(compact)) return '';
  return text;
}

function addContact(items, wxid, nickname, remark, alias, tags = [], source = 'wechat-native-db-helper') {
  if (isSystemContactId(wxid)) return;
  const cleanWxid = compactText(wxid);
  const cleanNickname = normalizeContactText(nickname);
  const cleanRemark = normalizeContactText(remark);
  const cleanAlias = normalizeContactText(alias);
  if (!cleanWxid && !cleanNickname && !cleanRemark && !cleanAlias) return;
  const key = [cleanWxid, cleanNickname, cleanRemark, cleanAlias]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
  if (!key || items.some((item) => item._key === key)) return;
  items.push({
    _key: key,
    wxid: cleanWxid || cleanAlias || cleanNickname || cleanRemark,
    nickname: cleanNickname || cleanRemark || cleanAlias || cleanWxid,
    remark: cleanRemark,
    alias: cleanAlias,
    tags: Array.isArray(tags) ? tags.map(compactText).filter(Boolean).slice(0, 30) : [],
    source,
  });
}

function stripPrivateKeys(items) {
  return items.map(({ _key, ...item }) => item);
}

function prepareReadTarget(dbPath, diagnostics) {
  const ext = path.extname(dbPath) || '.db';
  const snapshotPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-db-helper-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
  const copy = copyFileWithRetries(dbPath, snapshotPath, { attempts: 10, baseDelayMs: 150 });
  if (copy.ok) {
    diagnostics.dbSnapshotPaths.push(snapshotPath);
    return { queryPath: snapshotPath, snapshotPath, copied: true, copyAttempts: copy.attempts };
  }
  const sharedCopy = copyFileWithSharedRead(dbPath, snapshotPath);
  if (sharedCopy.ok) {
    diagnostics.dbSnapshotPaths.push(snapshotPath);
    diagnostics.dbSharedReadSnapshotPaths = [
      ...new Set([...(diagnostics.dbSharedReadSnapshotPaths || []), snapshotPath]),
    ].slice(0, 20);
    return {
      queryPath: snapshotPath,
      snapshotPath,
      copied: true,
      copyAttempts: copy.attempts,
      sharedRead: true,
    };
  }
  diagnostics.dbCopyErrors.push({
    path: dbPath,
    attempts: copy.attempts,
    error: copy.error,
    sharedReadError: sharedCopy.error || sharedCopy.reason || '',
  });
  return { queryPath: dbPath, snapshotPath: '', copied: false, copyAttempts: copy.attempts };
}

function cleanupReadTarget(target) {
  if (!target || !target.snapshotPath) return;
  try {
    fs.rmSync(target.snapshotPath, { force: true });
  } catch {
    // Best effort temp cleanup.
  }
}

function classifySqliteFailure(text) {
  const message = compactText(text);
  if (/database is locked|locked/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'encrypted-or-locked',
      dbKeyStatus: 'encrypted-or-locked',
      reason: 'database-locked',
    };
  }
  if (/file is not a database|encrypted|malformed|not an error|unsupported file format|cipher|hmac|bad decrypt/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'encrypted-or-locked',
      dbKeyStatus: 'encrypted-or-locked',
      reason: 'encrypted-or-key-missing',
    };
  }
  if (/permission denied|access is denied|eperm|eacces/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'locked-or-permission-denied',
      dbKeyStatus: 'unknown',
      reason: 'permission-denied',
    };
  }
  if (/no such table|no such column/i.test(message)) {
    return {
      status: 'schema-mismatch',
      dbStatus: 'plaintext-readable',
      dbKeyStatus: 'plaintext-readable',
      reason: 'contact-schema-not-found',
    };
  }
  return {
    status: 'failed',
    dbStatus: 'query-failed',
    dbKeyStatus: 'unknown',
    reason: 'sqlite-query-failed',
  };
}

function parseCountOutput(value) {
  const line = String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  const count = Number(line);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

const SYSTEM_CONTACT_SQL_IDS = [
  'fmessage',
  'qmessage',
  'tmessage',
  'weixin',
  'filehelper',
  'newsapp',
  'qqmail',
  'floatbottle',
  'lbsapp',
  'medianote',
  'qqsync',
  'weibo',
  'masssendapp',
  'feedsapp',
  'voip',
  'officialaccounts',
  'notification_messages',
  'notifymessage',
  'mphelper',
].map((item) => `'${item}'`).join(',');

function cleanSqlText(column) {
  return `replace(replace(replace(COALESCE(${column}, ''), char(13), ' '), char(10), ' '), char(9), ' ')`;
}

function selectBestDbResult(results, dbPaths) {
  const candidates = results.filter((item) => item.items.length);
  if (!candidates.length) return null;
  return candidates
    .map((item) => {
      const inputIndex = Math.max(0, dbPaths.indexOf(item.dbPath));
      const inputRankScore = (dbPaths.length - inputIndex) * 10000;
      const contactScore = Math.min(Number(item.totalCount) || item.items.length, 100000);
      const pathScore = Number(item.details && item.details.score) || 0;
      return {
        ...item,
        selectionScore: inputRankScore + pathScore * 100 + contactScore,
      };
    })
    .sort((left, right) => {
      if (left.selectionScore !== right.selectionScore) return right.selectionScore - left.selectionScore;
      if ((left.totalCount || 0) !== (right.totalCount || 0)) return (right.totalCount || 0) - (left.totalCount || 0);
      return dbPaths.indexOf(left.dbPath) - dbPaths.indexOf(right.dbPath);
    })[0];
}

function isDecryptedSource(source) {
  return String(source || '').startsWith('windows-wechat-db-decrypted');
}

function dbKeyStatusForSource(source) {
  if (String(source || '').includes('external')) return 'decrypted-with-external-key';
  if (isDecryptedSource(source)) return 'decrypted-with-memory-key';
  return 'plaintext-readable';
}

function queryContacts(sqlitePath, dbPaths, mode, limits, input = {}) {
  const limit = mode === 'all' ? limits.allLimit : limits.randomLimit;
  const order = mode === 'all' ? '' : ' ORDER BY RANDOM()';
  const queries = [
    `SELECT ${cleanSqlText('user_name')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0 AND COALESCE(LocalType, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM rcontact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
  ];
  const countQueries = [
    "SELECT COUNT(1) FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%';",
    `SELECT COUNT(1) FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1;`,
    `SELECT COUNT(1) FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1;`,
    `SELECT COUNT(1) FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0 AND COALESCE(LocalType, 1) = 1;`,
    `SELECT COUNT(1) FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0;`,
    `SELECT COUNT(1) FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0;`,
    `SELECT COUNT(1) FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0;`,
    "SELECT COUNT(1) FROM rcontact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%';",
  ];
  const diagnostics = {
    stage: 'contacts-query',
    sqlitePath,
    dbPaths,
    dbCandidateDetails: dbPaths.map(describeDbCandidate).slice(0, 40),
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    dbKeyStatus: 'unknown',
    dbQueryAttempts: 0,
    dbContactCount: 0,
    dbTotalContactCount: 0,
    selectedDbPath: '',
    selectedDbAccountFolder: '',
    selectedDbBaseWxid: '',
    dbCandidateResults: [],
    dbErrors: [],
    dbCopyErrors: [],
    dbSnapshotPaths: [],
    decryptedDbPaths: [],
    decryptAttempts: [],
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    resultSource: '',
    blockedReasons: [],
    warnings: [],
  };

  let sawPlaintext = false;
  let sawBlocked = false;
  const candidateResults = [];

  for (const dbPath of dbPaths) {
    let candidatePath = dbPath;
    let candidateSource = 'wechat-native-db-helper';
    const details = describeDbCandidate(dbPath);
    if (!isPlainSqliteDatabase(dbPath)) {
      sawBlocked = true;
      diagnostics.dbStatus = 'encrypted-or-locked';
      diagnostics.dbKeyStatus = 'encrypted-or-locked';
      diagnostics.blockedReasons.push('encrypted-or-key-missing');
      const encryptedTarget = prepareReadTarget(dbPath, diagnostics);
      let decryptedSucceeded = false;
      try {
        const decrypted = decryptWithMemoryKey(encryptedTarget.queryPath, input, diagnostics, dbPath);
        if (decrypted && decrypted.path) {
          candidatePath = decrypted.path;
          candidateSource = decrypted.source;
          sawPlaintext = true;
          decryptedSucceeded = true;
        }
      } finally {
        cleanupReadTarget(encryptedTarget);
      }
      const isFirstRankedContactDb = dbPaths.indexOf(dbPath) === 0 && details.isXWechat && details.isContactDb;
      if (!decryptedSucceeded && isFirstRankedContactDb) {
        diagnostics.currentAccountDbBlocked = true;
        diagnostics.selectedDbPath = dbPath;
        diagnostics.selectedDbAccountFolder = details.accountFolder;
        diagnostics.selectedDbBaseWxid = details.baseWxid;
        diagnostics.selectedDbActiveMtime = details.activeMtime;
        diagnostics.blockedReasons.push('current-account-db-key-missing');
        diagnostics.dbErrors.push({
          path: dbPath,
          status: 'blocked',
          reason: 'current-account-db-key-missing',
          error: 'current account contact.db could not be decrypted; refused stale-account fallback',
        });
        break;
      }
    }
    const target = prepareReadTarget(candidatePath, diagnostics);
    try {
      let candidateTotalCount = 0;
      for (const countQuery of countQueries) {
        diagnostics.dbQueryAttempts++;
        const countResult = run(sqlitePath, ['-batch', '-noheader', '-separator', '\t', target.queryPath, countQuery], {
          timeout: 15000,
        });
        if (countResult.status !== 0) continue;
        candidateTotalCount = Math.max(candidateTotalCount, parseCountOutput(countResult.stdout));
        if (candidateTotalCount > 0) break;
      }

      for (const query of queries) {
        diagnostics.dbQueryAttempts++;
        const result = run(sqlitePath, ['-batch', '-noheader', '-separator', '\t', target.queryPath, query], {
          timeout: mode === 'all' ? 90000 : 30000,
        });
        if (result.status !== 0) {
          const errorText = compactText((result.error && result.error.message) || result.stderr || result.stdout || `sqlite exit ${result.status}`);
          const classification = classifySqliteFailure(errorText);
          if (classification.status === 'blocked') sawBlocked = true;
          if (classification.dbKeyStatus === 'plaintext-readable') sawPlaintext = true;
          diagnostics.dbStatus = classification.dbStatus;
          diagnostics.dbKeyStatus = classification.dbKeyStatus;
          diagnostics.dbErrors.push({
            path: dbPath,
            status: classification.status,
            reason: classification.reason,
            error: errorText,
          });
          if (classification.status === 'blocked') {
            diagnostics.blockedReasons.push(classification.reason);
            break;
          }
          continue;
        }

        sawPlaintext = true;
        diagnostics.resultSource = candidateSource;
        diagnostics.dbStatus = isDecryptedSource(candidateSource) ? 'decrypted-readable' : 'plaintext-readable';
        diagnostics.dbKeyStatus = dbKeyStatusForSource(candidateSource);
        const candidateItems = [];
        for (const line of String(result.stdout || '').split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          addContact(candidateItems, parts[0], parts[1], parts[2], parts[3], [], candidateSource);
        }
        if (candidateItems.length) {
          candidateResults.push({
            dbPath,
            queryPath: candidatePath,
            source: candidateSource,
            items: stripPrivateKeys(candidateItems),
            count: candidateItems.length,
            totalCount: candidateTotalCount || candidateItems.length,
            details,
            dbKeyStatus: dbKeyStatusForSource(candidateSource),
          });
          break;
        }
      }
    } finally {
      cleanupReadTarget(target);
    }
  }

  diagnostics.dbCandidateResults = candidateResults
    .map((item) => ({
      dbPath: item.dbPath,
      source: item.source,
      count: item.count,
      totalCount: item.totalCount,
      accountFolder: item.details.accountFolder,
      baseWxid: item.details.baseWxid,
      activeMtime: item.details.activeMtime,
      score: item.details.score,
    }))
    .slice(0, 40);
  const best = selectBestDbResult(candidateResults, dbPaths);
  if (best) {
    diagnostics.resultSource = best.source;
    diagnostics.dbContactCount = best.items.length;
    diagnostics.dbTotalContactCount = best.totalCount || best.items.length;
    diagnostics.dbStatus = 'completed';
    diagnostics.dbKeyStatus = best.dbKeyStatus || dbKeyStatusForSource(best.source);
    diagnostics.selectedDbPath = best.dbPath;
    diagnostics.selectedDbAccountFolder = best.details.accountFolder;
    diagnostics.selectedDbBaseWxid = best.details.baseWxid;
    diagnostics.selectedDbActiveMtime = best.details.activeMtime;
    diagnostics.selectedDbScore = best.selectionScore;
    return { items: best.items, diagnostics };
  }

  diagnostics.dbContactCount = 0;
    if (sawPlaintext && (diagnostics.dbKeyStatus === 'decrypted-with-memory-key' || diagnostics.dbKeyStatus === 'decrypted-with-external-key')) {
    diagnostics.dbStatus = 'completed-empty';
    diagnostics.resultSource = diagnostics.resultSource || 'windows-wechat-db-decrypted';
  } else if (sawPlaintext) {
    diagnostics.dbStatus = 'completed-empty';
    diagnostics.dbKeyStatus = 'plaintext-readable';
    diagnostics.resultSource = diagnostics.resultSource || 'wechat-native-db-helper';
  } else if (sawBlocked) {
    diagnostics.dbStatus = 'encrypted-or-locked';
    diagnostics.dbKeyStatus = 'encrypted-or-locked';
  }
  diagnostics.blockedReasons = Array.from(new Set(diagnostics.blockedReasons));
  return { items: [], diagnostics };
}

function displayContacts(items) {
  return items
    .map((item) => item.remark || item.nickname || item.alias || item.wxid)
    .map(compactText)
    .filter(Boolean);
}

function contractPayload() {
  return {
    ok: true,
    source: HELPER_NAME,
    status: 'ready',
    capabilities: [
      'json-stdin-stdout',
      'plaintext-sqlite-contact-db',
      'encrypted-db-block-detection',
      'locked-db-block-detection',
      'process-memory-key-scan',
      'external-db-key-toolchain',
      'dbkeyhookcmd-compatible',
      'wechat-dump-rs-pid-decrypt-compatible',
      'wechat-dump-rs-raw-key-compatible',
      'sqlcipher-page-decryption',
      'windows-wechat-db-decrypted',
      'key-fingerprint-only-diagnostics',
    ],
    unsupported: [
      'native-wechat-api',
      'key-logging',
    ],
    commands: {
      contract: 'node wechat-db-helper.js contract',
      diagnose: `node wechat-db-helper.js diagnose --contract ${CONTRACT_VERSION}`,
      contacts: `node wechat-db-helper.js contacts --contract ${CONTRACT_VERSION} --mode random|all`,
    },
    stdin: {
      contacts: {
        contractVersion: CONTRACT_VERSION,
        mode: 'random|all',
        dbPaths: 'string[] plaintext SQLite contact DB candidates',
        roots: 'optional string[] roots to scan for contact DB candidates',
        limits: '{ randomLimit, allLimit }',
      },
    },
    stdout: {
      success: {
        ok: true,
        status: 'completed|completed-empty',
        source: 'wechat-native-db-helper',
        contacts: 'string[] display names',
        items: 'Array<{ wxid, nickname, remark, alias, tags, source }>',
        diagnostics: '{ dbStatus, dbKeyStatus, sqlitePath, warnings }',
      },
      blocked: {
        ok: false,
        status: 'blocked',
        blocked: true,
        error: 'helper could not decrypt encrypted/locked/key-missing DB',
        diagnostics: '{ dbStatus, dbKeyStatus, blockedReasons }',
      },
    },
  };
}

function validateContractArg(command) {
  const supplied = argValue('--contract', process.env.AI_CONTENT_WECHAT_HELPER_CONTRACT || '');
  if (!supplied && command === 'diagnose') return '';
  if (supplied === CONTRACT_VERSION) return '';
  return supplied ? `unsupported contract ${supplied}` : `missing --contract ${CONTRACT_VERSION}`;
}

function runContract() {
  emit(contractPayload());
}

function runDiagnose() {
  const inputState = readJsonStdin();
  const contractError = validateContractArg('diagnose');
  const sqlite = resolveSqlite(inputState.value);
  const dbPaths = dbPathCandidates(inputState.value);
  const wechatFilesRoots = inputWechatFilesRoots(inputState.value);
  const diagnostics = {
    stage: 'diagnose',
    platform: process.platform,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    helperPath: __filename,
    stdinStatus: inputState.error ? 'invalid-json' : inputState.hasInput ? 'parsed' : 'empty',
    stdinError: inputState.error || '',
    sqlitePath: sqlite.path,
    sqliteStatus: sqlite.path ? 'ready' : 'missing',
    sqliteCandidates: sqlite.attempts,
    dbPaths,
    wechatFilesRoots,
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    dbKeyStatus: 'unknown',
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    decryptorAvailable: Boolean(resolveDecryptorSourceBase64(inputState.value, {})),
    warnings: process.platform === 'win32' ? [] : ['SQLCipher memory-key decrypt is only available on Windows'],
  };
  if (process.platform === 'win32') {
    diagnostics.wechatProcessArchitectures = describeWechatProcesses(inputState.value).slice(0, 30);
  }
  resolveExternalKeyTools(inputState.value, diagnostics);
  if (contractError) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      error: contractError,
      diagnostics,
    }, 64);
  }
  emit({
    ok: true,
    status: sqlite.path ? 'ready' : 'blocked',
    source: HELPER_NAME,
    capabilities: contractPayload().capabilities,
    unsupported: contractPayload().unsupported,
    diagnostics,
  }, sqlite.path ? 0 : 2);
}

function runContacts() {
  const inputState = readJsonStdin();
  if (inputState.error) {
    emit({
      ok: false,
      status: 'failed',
      error: inputState.error,
      diagnostics: {
        stage: 'stdin-parse',
      },
    }, 65);
  }

  const contractError = validateContractArg('contacts');
  const requestedMode = argValue('--mode', inputState.value.mode || process.env.AI_CONTENT_WECHAT_CONTACT_SYNC_MODE || 'random');
  const mode = requestedMode === 'all' ? 'all' : requestedMode === 'random' ? 'random' : '';
  const inputLimits = inputState.value && typeof inputState.value.limits === 'object' ? inputState.value.limits : {};
  const limits = {
    randomLimit: Math.max(1, Math.min(Number(inputLimits.randomLimit) || DEFAULT_RANDOM_LIMIT, DEFAULT_ALL_LIMIT)),
    allLimit: Math.max(1, Math.min(Number(inputLimits.allLimit) || DEFAULT_ALL_LIMIT, DEFAULT_ALL_LIMIT)),
  };
  const sqlite = resolveSqlite(inputState.value);
  const dbPaths = dbPathCandidates(inputState.value);
  const wechatFilesRoots = inputWechatFilesRoots(inputState.value);
  const baseDiagnostics = {
    stage: 'contacts-start',
    platform: process.platform,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    helperPath: __filename,
    stdinStatus: inputState.hasInput ? 'parsed' : 'empty',
    sqlitePath: sqlite.path,
    sqliteStatus: sqlite.path ? 'ready' : 'missing',
    sqliteCandidates: sqlite.attempts,
    dbPaths,
    wechatFilesRoots,
    limits,
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    warnings: process.platform === 'win32' ? [] : ['SQLCipher memory-key decrypt is only available on Windows'],
  };

  if (contractError) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode: requestedMode || '',
      error: contractError,
      diagnostics: baseDiagnostics,
    }, 64);
  }
  if (!mode) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode: requestedMode || '',
      error: 'mode must be random or all',
      diagnostics: baseDiagnostics,
    }, 64);
  }
  if (!sqlite.path) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode,
      error: 'sqlite3 executable not found',
      diagnostics: {
        ...baseDiagnostics,
        stage: 'contacts-sqlite-missing',
        dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
        dbKeyStatus: 'unknown',
      },
    }, 2);
  }
  if (!dbPaths.length) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode,
      error: 'wechat contact database not found',
      diagnostics: {
        ...baseDiagnostics,
        stage: 'contacts-db-missing',
        dbStatus: 'not-found',
        dbKeyStatus: 'unknown',
      },
    }, 2);
  }

  const result = queryContacts(sqlite.path, dbPaths, mode, limits, inputState.value);
  const diagnostics = {
    ...baseDiagnostics,
    ...result.diagnostics,
    warnings: Array.from(new Set([...(baseDiagnostics.warnings || []), ...((result.diagnostics && result.diagnostics.warnings) || [])])),
  };
  const readableDbStatuses = new Set(['plaintext-readable', 'decrypted-with-memory-key', 'decrypted-with-external-key']);
  if (result.items.length || readableDbStatuses.has(diagnostics.dbKeyStatus)) {
    const status = result.items.length ? 'completed' : 'completed-empty';
    const source = diagnostics.resultSource || (diagnostics.dbKeyStatus === 'decrypted-with-memory-key' || diagnostics.dbKeyStatus === 'decrypted-with-external-key'
      ? 'windows-wechat-db-decrypted'
      : 'wechat-native-db-helper');
    const currentWechatId = diagnostics.selectedDbAccountFolder || diagnostics.selectedDbBaseWxid || '';
    emit({
      ok: true,
      status,
      source,
      mode,
      contacts: displayContacts(result.items),
      items: result.items,
      count: result.items.length,
      currentWechatId,
      syncedAt: new Date().toISOString(),
      diagnostics: {
        ...diagnostics,
        stage: status,
        dbStatus: status,
        dbContactCount: result.items.length,
      },
    });
  }

  emit({
    ok: false,
    status: 'blocked',
    blocked: true,
    source: 'wechat-native-db-helper',
    mode,
    error: 'wechat contact database is encrypted, locked, or missing a readable key; helper could not decrypt it',
    diagnostics: {
      ...diagnostics,
      stage: 'contacts-blocked',
      dbStatus: diagnostics.dbStatus || 'encrypted-or-locked',
      dbKeyStatus: diagnostics.dbKeyStatus || 'encrypted-or-locked',
      blockedReasons: diagnostics.blockedReasons && diagnostics.blockedReasons.length
        ? diagnostics.blockedReasons
        : ['encrypted-or-locked-or-key-missing'],
    },
  }, 3);
}

const command = process.argv[2] || 'contract';
if (command === 'contract' || command === 'helper-contract') {
  runContract();
} else if (command === 'diagnose') {
  runDiagnose();
} else if (command === 'contacts') {
  runContacts();
} else {
  emit({
    ok: false,
    status: 'failed',
    error: `unknown command: ${compactText(command)}`,
    diagnostics: {
      stage: 'argv',
      supportedCommands: ['contract', 'diagnose', 'contacts'],
    },
  }, 64);
}
