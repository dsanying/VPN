import { parseAuthFields } from '../OpenConnectForms';
import { EnterpriseDiscovery } from '../EnterpriseDiscovery';
import { EnterpriseProfileStore } from '../EnterpriseProfileStore';
import { LocalSecretCodec } from '../LocalSecretCodec';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const fields = [
  {
    name: 'group_list',
    label: 'Login group',
    secret: false,
    choices: [
      { value: 'employees', label: 'Employees' },
      { value: 'guests', label: 'Guests' },
    ],
  },
];
const detected = {
  gateway: 'https://example.com/',
  protocol: 'anyconnect' as const,
  authentication: 'interactive' as const,
  fields,
};
test('structured discovery shares the runtime schema and refuses malformed fields', async () => {
  const forms = jest.fn(async () => parseAuthFields(fields));
  const discovery = new EnterpriseDiscovery(
    async () => ({ body: 'Cisco AnyConnect', headers: {} }),
    forms
  );
  expect(await discovery.detect(detected.gateway)).toMatchObject({ fields });
  await discovery.detect(detected.gateway);
  expect(forms).toHaveBeenCalledTimes(1);
  for (const invalid of [
    [...fields, ...fields],
    [{ ...fields[0], name: '__proto__' }],
    [{ ...fields[0], choices: [{ value: 'x\ncommand', label: 'unsafe' }] }],
    Array(33).fill(fields[0]),
  ])
    expect(() => parseAuthFields(invalid)).toThrow();
});

test('aTrust discovers authentication choices through the same cached form mechanism', async () => {
  const forms = jest.fn(async () => [{ ...fields[0], name: 'authentication' }]);
  const discovery = new EnterpriseDiscovery(async () => ({ body: 'aTrust', headers: {} }), forms);
  const result = await discovery.detect(detected.gateway);
  expect(result).toMatchObject({ protocol: 'atrust', fields: [{ name: 'authentication' }] });
  await discovery.detect(detected.gateway);
  expect(forms).toHaveBeenCalledTimes(1);
});

test('a sole advertised choice is saved automatically without inventing a realm', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-auto-choice-'));
  const store = new EnterpriseProfileStore(
    join(dir, 'profiles.sqlite'),
    new LocalSecretCodec(join(dir, 'key'))
  );
  try {
    const saved = store.save(
      { gateway: detected.gateway },
      { ...detected, fields: [{ ...fields[0], choices: [fields[0].choices[0]] }] }
    );
    expect(saved.selections).toEqual({ group_list: 'employees' });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('only advertised selections persist; changed gateway choices cannot be silently reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-forms-'));
  const store = new EnterpriseProfileStore(
    join(dir, 'profiles.sqlite'),
    new LocalSecretCodec(join(dir, 'key'))
  );
  try {
    const profile = store.save(
      {
        gateway: detected.gateway,
        username: 'fictional',
        password: 'fictional',
        selections: { group_list: 'employees' },
      },
      detected
    );
    expect(store.get(profile.id).selections).toEqual({ group_list: 'employees' });
    expect(
      store.save({ id: profile.id, gateway: detected.gateway, username: 'fictional' }, detected)
        .selections
    ).toEqual({ group_list: 'employees' });
    expect(() =>
      store.save(
        { id: profile.id, gateway: detected.gateway, username: 'fictional' },
        { ...detected, fields: [{ ...fields[0], choices: [{ value: 'new', label: 'New' }] }] }
      )
    ).toThrow('已变更');
    expect(() =>
      store.save({ gateway: detected.gateway, selections: { group_list: 'bogus' } }, detected)
    ).toThrow();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
