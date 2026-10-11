// SPDX-License-Identifier: MIT
// Audits the installed public dependency graph and the bytes used by the client.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const verifiedPackages = {
  util: { version: "1.13.0", files: {
    "es/Dom/focus.js": "63c438f791345214668fc7ef7721ec4ea6fdb2eb29c807783ccc1de13714db32",
    "lib/Dom/focus.js": "4a064b0d1d4711425691ede255f1342fa0786ebba9903c866d57077b64517e0d"
  } },
  drawer: { version: "1.4.2", files: {
    "es/Drawer.js": "e2bebce8a7a90519ad163260ba1c64392133fd117e982c3a91f12ef6689e3211",
    "lib/Drawer.js": "c394471ab1c64fbdfa236cc023e6486cf21971192efa09333e85d58f1770c12b"
  } },
  picker: { version: "1.12.2", files: {
    "es/PickerTrigger/index.js": "285ff306858c3aec50081898d2504a14c88acb172d9726e2b1a3dc7bacdba664",
    "lib/PickerTrigger/index.js": "cacdc0548edfaa73ce9cd4e08be3997c5aaca7541ef8731f305d27e31cb450e8"
  } }
};

function validateFiles(manifest, contract, label) {
  const issues=[];
  const installed=JSON.parse(readFileSync(manifest,'utf8'));
  if(installed.version!==contract.version) issues.push(`实际解析 ${label} ${installed.version}; expected ${contract.version}`);
  for(const [relative,digest] of Object.entries(contract.files)) {
    const bytes=readFileSync(join(dirname(manifest),relative));
    if(createHash('sha256').update(bytes).digest('hex')!==digest) issues.push(`${label} runtime mismatch: ${relative}`);
  }
  return issues;
}

export function auditAntRuntime(directory, contracts=verifiedPackages) {
  try {
    const fromProject=createRequire(join(directory,'package.json'));
    const fromAnt=createRequire(fromProject.resolve('antd/package.json'));
    const drawer=fromAnt.resolve('@rc-component/drawer/package.json');
    const dependencies={
      drawer,
      util:createRequire(drawer).resolve('@rc-component/util/package.json'),
      picker:resolve(dirname(fromAnt.resolve('@rc-component/picker')),'../package.json'),
    };
    return Object.entries(contracts).flatMap(([name,contract])=>validateFiles(dependencies[name],contract,name));
  } catch(error) {
    return [`依赖不完整: ${error.message}`];
  }
}

export function auditLogRuntime(directory) {
  const contract={version:'6.6.0',files:{
    'dist/esm/index.js':'bfc9fa5a2c1fd9e906c1234455a1bee573e8dd7196bdf935972f0b0357fb0121',
    'dist/cjs/index.js':'e5db5c547e7f9c5e1372a26d6a1bcc9dd209c9030ca88e0c4676c4e31f4e6eb2',
  }};
  try {
    const manifest=createRequire(join(directory,'package.json')).resolve('@melloware/react-logviewer/package.json');
    return validateFiles(manifest,contract,'LogViewer');
  } catch(error) { return [`LogViewer unavailable: ${error.message}`]; }
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const directory=fileURLToPath(new URL('../',import.meta.url));
  const issues=[...auditAntRuntime(directory),...auditLogRuntime(directory)];
  if(issues.length) { process.stderr.write(issues.join('\n')+'\n');process.exitCode=1; }
  else process.stdout.write('Installed UI runtime versions and patch digests verified\n');
}
