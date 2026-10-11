import { HelperManager } from '../HelperManager';
import { WindowsServiceHelper } from '../WindowsServiceHelper';
import { LinuxServiceHelper } from '../LinuxServiceHelper';

it.each([HelperManager, WindowsServiceHelper, LinuxServiceHelper])(
  '%p rejects installation and removal before touching the persistent service in acceptance mode',
  async (Implementation) => {
    const previous = process.argv;
    process.argv = [...previous, '--validation-profile=/tmp/isolated-helper-fixture'];
    try {
      const helper = new Implementation();
      await expect(helper.install()).rejects.toThrow('隔离验收模式');
      await expect(helper.uninstall()).rejects.toThrow('隔离验收模式');
    } finally {
      process.argv = previous;
    }
  }
);
