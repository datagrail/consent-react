import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_SCHEMA_VERSION } from '../src/version';

/**
 * Pins CONFIG_SCHEMA_VERSION to the `package` of the dgapp consent_schema config.proto vendored at
 * consent_schema/ (provenance in consent_schema/SOURCE). The proto is read straight off disk.
 *
 * Exactly one vendored version is expected: it is the one this SDK reports. Once the SDK supports
 * more than one, this guard must name the reported version explicitly instead.
 */
const SCHEMA_ROOT = path.join(__dirname, '../consent_schema/proto/datagrail/consent');
const BUMP_HINT = 'bump the vendored proto and the constant together';

function schemaVersionProblems(): string[] {
  const versions = fs
    .readdirSync(SCHEMA_ROOT)
    .filter((dir) => fs.existsSync(path.join(SCHEMA_ROOT, dir, 'config.proto')));
  if (versions.length !== 1) {
    return [`Expected exactly one ${SCHEMA_ROOT}/*/config.proto, found [${versions.join(', ')}]`];
  }

  const protoPath = path.join(SCHEMA_ROOT, versions[0], 'config.proto');
  const match = /^package datagrail\.consent\.(v[1-9][0-9]*);/m.exec(
    fs.readFileSync(protoPath, 'utf8'),
  );
  if (!match) {
    return [`No \`package datagrail.consent.vN;\` in ${protoPath}`];
  }

  const problems: string[] = [];
  if (match[1] !== versions[0]) {
    problems.push(`${protoPath} declares ${match[1]} but lives under ${versions[0]}`);
  }
  if (CONFIG_SCHEMA_VERSION !== match[1]) {
    problems.push(
      `CONFIG_SCHEMA_VERSION is ${CONFIG_SCHEMA_VERSION} but ${protoPath} declares ${match[1]}`,
    );
  }
  return problems;
}

describe('CONFIG_SCHEMA_VERSION', () => {
  it('matches the package of the vendored consent_schema proto', () => {
    expect(schemaVersionProblems().map((problem) => `${problem}; ${BUMP_HINT}`)).toEqual([]);
  });
});
