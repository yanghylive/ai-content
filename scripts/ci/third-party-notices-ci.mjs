import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const files = {
  notices: 'THIRD_PARTY_NOTICES.md',
  license: 'licenses/MultiPost-Extension-Apache-2.0.txt',
  rootLicense: 'LICENSE',
};

const expectedApacheLicenseSha256 =
  'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const expectedRootLicenseSha256 =
  '1b514878b0d2f15f39f66995183be6d2742c8c26bd73e97360788396f469506c';

async function readRequiredFile(path) {
  try {
    return await readFile(resolve(repositoryRoot, path), 'utf8');
  } catch (error) {
    console.error(`Missing required compliance file: ${path}`);
    throw error;
  }
}

const [notices, apacheLicense, rootLicense] = await Promise.all(
  Object.values(files).map(readRequiredFile),
);

const requiredNoticeValues = [
  'MultiPost-Extension',
  'v1.4.4',
  'https://github.com/leaperone/MultiPost-Extension',
  'Apache-2.0',
  'licenses/MultiPost-Extension-Apache-2.0.txt',
];

const errors = [];
for (const value of requiredNoticeValues) {
  if (!notices.includes(value)) {
    errors.push(`${files.notices} must contain: ${value}`);
  }
}

const apacheLicenseSha256 = createHash('sha256').update(apacheLicense).digest('hex');
if (apacheLicenseSha256 !== expectedApacheLicenseSha256) {
  errors.push(`${files.license} does not match the approved Apache-2.0 license text`);
}

const rootLicenseSha256 = createHash('sha256').update(rootLicense).digest('hex');
if (rootLicenseSha256 !== expectedRootLicenseSha256) {
  errors.push(`${files.rootLicense} changed; third-party compliance must not modify the root license`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Third-party notices compliance check passed.');
}
