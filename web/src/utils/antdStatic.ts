import type { NotificationInstance } from 'antd/es/notification/interface';
let bound: NotificationInstance | undefined;
export function setStaticInstances(instances: { notification: NotificationInstance }): void {
  bound = instances.notification;
}
/** Every notification uses the mounted Ant Design App context and current theme. */
export const notification = new Proxy({} as NotificationInstance, {
  get(_object, key) {
    const instance = bound;
    if (!instance)
      return () => {
        console.warn('Notification context has not mounted');
      };
    const member = Reflect.get(instance, key);
    return typeof member === 'function' ? member.bind(instance) : member;
  },
});
