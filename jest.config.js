/** SWC 编译测试；TypeScript 7 类型检查由 test:types 单独执行。 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  // `sing-box check` 门需要**随包内核**（resources/<平台>/sing-box，66–74MB、已 gitignore），默认 `npm test` 与 CI
  // 测试 job 都没有它。故把该门移出默认测试集，改由 `npm run test:core-gate` 单独跑——该 script 已接进
  // package:* / dist:* 链（这些链先跑 fetch:core，核在那里恒存在），有真实执行位置而非只写在文档里。
  // 门本身「核缺失即硬 fail、绝不静默 skip」的语义不变：它只在核确定存在的链路上被调用，故不需要（也没有）
  // 任何环境变量豁免开关——豁免只会变成关门的后门。
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main/services/__tests__/singbox-check-gate\\.test\\.ts$',
  ],
  moduleNameMapper: { '^plist$': '<rootDir>/node_modules/plist/dist/index.js' },
  transformIgnorePatterns: ['/node_modules/(?!plist/)'],
  transform: {
    '^.+\\.[jt]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
          experimental: { plugins: [['@swc-contrib/mut-cjs-exports', {}]] },
        },
        module: { type: 'commonjs', lazy: true },
      },
    ],
  },
};
