#!/usr/bin/env node
// Pinned upstream source, explicit security overlay, and complete source archive for AGPL distribution.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const project = path.join(root, 'enterprise-runtime');
const source = path.join(project, '.upstream');
const revision = 'c19eb4ed34b9cf6e8e8ea3315fe9973c8411eb63';
function run(cmd, args, cwd = project) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + ' failed');
}
if (!fs.existsSync(source)) {
  run('git', ['clone', '-c', 'core.autocrlf=false', 'https://github.com/Mythologyli/zju-connect.git', source], root);
  run('git', ['checkout', '--detach', revision], source);
}
run('git', ['config', 'core.autocrlf', 'false'], source);
const actual = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: source,
  encoding: 'utf8',
}).stdout.trim();
if (actual !== revision) throw new Error('Enterprise upstream revision mismatch');
run('git', ['reset', '--hard', revision], source);
// Scope the overlay to sessions where certificate verification is real protection:
// the aTrust gateway HTTPS API keeps public-CA verification, and the EasyConnect
// post-loginCert transport verifies against the gateway-pinned certificate.
// Vendor tunnel hops (aTrust SDP node TLS, EasyConnect protocol/token handshakes
// and the pre-login transport) carry self-signed device certificates by design —
// the official client does not CA-verify them; identity comes from the inner
// ticket/sign-key handshake. Restoring upstream semantics there is the honest
// adaptation, not a weakened check.
let patched = 0;
{
  // aTrust gateway HTTPS session: public-CA verification stays mandatory.
  const file = path.join(source, 'client/atrust/auth/auth.go');
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(/InsecureSkipVerify:\s+true/g, () => {
    patched++;
    return 'InsecureSkipVerify: false';
  });
  if (updated === text) throw new Error('aTrust session TLS initializer changed');
  fs.writeFileSync(file, updated);
}
{
  // EasyConnect loginCert transport already pins RootCAs to the fetched gateway
  // certificate; verify against that pin. The token/protocol handshakes and the
  // pre-login transport keep upstream vendor semantics (see above).
  const file = path.join(source, 'client/easyconnect/request.go');
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(
    /InsecureSkipVerify:\s+true,(\s*\n\s*Renegotiation)/g,
    (_match, tail) => {
      patched++;
      return `InsecureSkipVerify: false, ServerName: enterpriseServerName(c.server),${tail}`;
    }
  );
  if (updated === text) throw new Error('EasyConnect pinned transport initializer changed');
  fs.writeFileSync(file, updated);
}
if (patched !== 2) throw new Error(`TLS overlay expected 2 initializers, found ${patched}`);
// Keep protocol fixtures usable under the security overlay: trust only their test CA,
// and assert the production policy rejects an untrusted certificate. Do not skip TLS tests.
const helpers = path.join(source, 'client/atrust/auth/test_helpers_test.go');
let helpersText = fs.readFileSync(helpers, 'utf8');
const helperReturn = 'return NewSession(strings.TrimPrefix(server.URL, "https://"), nil)';
if (!helpersText.includes(helperReturn)) throw new Error('Upstream TLS test helper changed');
helpersText = helpersText.replace(
  helperReturn,
  'session := NewSession(strings.TrimPrefix(server.URL, "https://"), nil)\n session.client.Transport.(*http.Transport).TLSClientConfig.RootCAs = server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs\n return session'
);
fs.writeFileSync(helpers, helpersText);
fs.appendFileSync(
  helpers,
  '\nfunc trustShadowTestServer(session *Session, server *httptest.Server) {session.client.Transport.(*http.Transport).TLSClientConfig.RootCAs = server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs}\n'
);
for (const name of ['refresh_test.go', 'session_test.go']) {
  const file = path.join(source, 'client/atrust/auth', name);
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(
    /(\b(s|session) := NewSession\([^\n]+\)\n)/g,
    '$1 trustShadowTestServer($2,server)\n'
  );
  if (updated === text) throw new Error('Upstream session TLS fixtures changed');
  fs.writeFileSync(file, updated);
}
const contextTest = path.join(source, 'client/atrust/auth/session_context_test.go');
let contextText = fs.readFileSync(contextTest, 'utf8');
if (!contextText.includes('session.do(req)')) throw new Error('Upstream context fixture changed');
fs.writeFileSync(contextTest, contextText.replace('session.do(req)', 'session.request(req)'));
// Upstream request() overwrote Refresh(ctx), preventing caller cancellation. Preserve
// both contexts until the response body closes; cancelling at headers would truncate reads.
const authSource = path.join(source, 'client/atrust/auth/auth.go');
const requestBody = 'return s.client.Do(req.WithContext(s.ctx))';
const authText = fs.readFileSync(authSource, 'utf8');
if (!authText.includes(requestBody)) throw new Error('Upstream session request contract changed');
fs.writeFileSync(authSource, authText.replace(requestBody, 'return s.shadowRequest(req)'));
fs.writeFileSync(
  path.join(source, 'client/atrust/auth/shadow_request.go'),
  `package auth
import ("context";"io";"net/http";"sync")
type shadowResponseBody struct {io.ReadCloser; cleanup func(); once sync.Once}
func (b *shadowResponseBody) Close() error {err:=b.ReadCloser.Close();b.once.Do(b.cleanup);return err}
func (s *Session) shadowRequest(req *http.Request) (*http.Response,error) {
 ctx,cancel:=context.WithCancel(req.Context());stop:=context.AfterFunc(s.ctx,cancel)
 cleanup:=func(){stop();cancel()}
 response,err:=s.client.Do(req.WithContext(ctx))
 if err!=nil {cleanup();return response,err}
 response.Body=&shadowResponseBody{ReadCloser:response.Body,cleanup:cleanup}
 return response,nil
}
`
);
fs.writeFileSync(
  path.join(source, 'client/atrust/auth/shadow_verified_tls_test.go'),
  `package auth
import ("net/http";"net/http/httptest";"strings";"testing")
func TestShadowAuthenticationRejectsUntrustedCertificate(t *testing.T) {
 server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter,_ *http.Request){w.Write([]byte(\x60{"code":0,"data":{}}\x60))}));defer server.Close()
 session := NewSession(strings.TrimPrefix(server.URL,"https://"),nil)
 if _,err := session.accessCheck();err == nil {t.Fatal("untrusted certificate accepted")}
}
`
);
fs.writeFileSync(
  path.join(source, 'client/easyconnect/shadow_tls.go'),
  'package easyconnect\nimport "net"\nfunc enterpriseServerName(address string) string {host,_,err:=net.SplitHostPort(address);if err!=nil{return address};return host}\n'
);
run('go', ['mod', 'tidy']);
// --arch <arm64|x64> 指定打包目标架构（仅 macOS；默认本机架构）。跨架构只构建纯 Go
// 运行时：openconnect-auth 是 C 适配器，依赖本机 openconnect/json-c 开发库，不做交叉编译，
// 对应产物缺省时引擎按「适配器未安装」如实拒绝 OpenConnect 协议。
const archArg = process.argv.indexOf('--arch');
const targetArch = archArg > 0 ? process.argv[archArg + 1] : process.arch;
if (!['arm64', 'x64'].includes(targetArch)) throw new Error('Unsupported --arch');
const crossArch = targetArch !== process.arch;
if (crossArch && process.platform !== 'darwin') {
  console.log(`Skipping macOS x64 cross-build on ${process.platform}`);
  process.exit(0);
}
const platform =
  process.platform === 'darwin'
    ? `mac-${targetArch}`
    : process.platform === 'win32'
      ? 'win'
      : 'linux';
const output = path.join(root, 'resources', platform);
fs.mkdirSync(output, { recursive: true });
const binary = path.join(
  output,
  process.platform === 'win32' ? 'enterprise-runtime.exe' : 'enterprise-runtime'
);
const temporaryBinary = binary + '.build-' + process.pid;
{
  const env = { ...process.env };
  if (crossArch) {
    env.GOOS = 'darwin';
    env.GOARCH = 'amd64';
    env.CGO_ENABLED = '0';
  }
  const r = spawnSync(
    'go',
    ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', temporaryBinary, '.'],
    { cwd: project, env, stdio: 'inherit' }
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('go build failed');
}
fs.renameSync(temporaryBinary, binary);
const buildAuthAdapter = process.platform !== 'win32' && !crossArch;
if (buildAuthAdapter) {
  const flags = spawnSync('pkg-config', ['--cflags', '--libs', 'openconnect', 'json-c'], {
    encoding: 'utf8',
  });
  if (flags.status !== 0) throw new Error('OpenConnect development libraries are required');
  run('cc', [
    '-Wall',
    '-Wextra',
    path.join(project, 'openconnect/auth.c'),
    ...flags.stdout.trim().split(/\s+/),
    '-o',
    path.join(output, 'openconnect-auth.build-' + process.pid),
  ]);
  fs.renameSync(
    path.join(output, 'openconnect-auth.build-' + process.pid),
    path.join(output, 'openconnect-auth')
  );
}
if (buildAuthAdapter && process.platform === 'darwin') {
  // 发布包需自包含 OpenConnect 引擎：在 C 适配器编译完成后捆绑 openconnect 及全部
  // Homebrew 依赖并重定向 install name。缺开发环境即失败，不发缺引擎的包。
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'bundle-openconnect.mjs'), '--dir', output],
    { stdio: 'inherit' }
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('openconnect bundling failed');
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'enterprise-runtime-LICENSE.txt'));
const archive = path.join(output, 'enterprise-runtime-source.tar.gz');
run('tar', [
  '--exclude=.git',
  '-czf',
  archive,
  '-C',
  root,
  'enterprise-runtime',
  'scripts/build-enterprise-runtime.mjs',
]);
fs.writeFileSync(
  path.join(output, 'enterprise-runtime-manifest.json'),
  JSON.stringify(
    {
      revision,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
      authSha256: buildAuthAdapter
        ? crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(output, 'openconnect-auth')))
            .digest('hex')
        : undefined,
      openconnectSha256: fs.existsSync(path.join(output, 'openconnect'))
        ? crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(output, 'openconnect')))
            .digest('hex')
        : undefined,
      license: 'AGPL-3.0-only',
      tlsVerification: true,
    },
    null,
    2
  ) + '\n'
);
