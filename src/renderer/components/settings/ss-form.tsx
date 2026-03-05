import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Shield } from 'lucide-react';
import type { ServerConfig } from '@/bridge/types';
import { useTranslation } from 'react-i18next';

// Use a function to get schema with translations
const getSsFormSchema = (t: any) =>
  z.object({
    address: z.string().min(1, t('servers.errorAddressEmpty', '服务器地址不能为空')),
    port: z
      .number()
      .min(1, t('servers.errorPortMin', '端口必须大于 0'))
      .max(65535, t('servers.errorPortMax', '端口必须小于 65536')),
    method: z.string().min(1, t('servers.errorEncryptionMethod', '加密方式不能为空')),
    password: z.string().min(1, t('servers.errorPassword', '密码不能为空')),
    plugin: z.string().optional(),
    pluginOptions: z.string().optional(),
    remarks: z.string().optional(),
    // Shadow-TLS v3
    enableShadowTls: z.boolean(),
    shadowTlsPassword: z.string().optional(),
    shadowTlsSni: z.string().optional(),
    shadowTlsFingerprint: z.string().optional(),
    shadowTlsPort: z.number().optional(),
  });

type SsFormValues = z.infer<ReturnType<typeof getSsFormSchema>>;

interface SsFormProps {
  serverConfig?: ServerConfig;
  onSubmit: (config: any) => Promise<void>;
}

const COMMON_METHODS = [
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-cfb',
  'aes-192-cfb',
  'aes-256-cfb',
  'aes-128-ctr',
  'aes-192-ctr',
  'aes-256-ctr',
  'rc4-md5',
  'chacha20-ietf',
  'xchacha20-ietf-poly1305',
];

export function SsForm({ serverConfig, onSubmit }: SsFormProps) {
  const { t } = useTranslation();
  const ssFormSchema = getSsFormSchema(t);

  const form = useForm<SsFormValues>({
    resolver: zodResolver(ssFormSchema),
    defaultValues: {
      address: '',
      port: 8388,
      method: 'aes-256-gcm',
      password: '',
      plugin: '',
      pluginOptions: '',
      remarks: '',
      enableShadowTls: false,
      shadowTlsPassword: '',
      shadowTlsSni: '',
      shadowTlsFingerprint: 'chrome',
      shadowTlsPort: undefined,
    },
  });

  useEffect(() => {
    if (serverConfig && serverConfig.protocol?.toLowerCase() === 'shadowsocks') {
      const hasShadowTls = !!serverConfig.shadowTlsSettings;

      let method = serverConfig.shadowsocksSettings?.method?.toLowerCase() || 'aes-256-gcm';
      // Normalize common alias
      if (method === 'chacha20-poly1305') {
        method = 'chacha20-ietf-poly1305';
      }

      // Attempt to find exact match in COMMON_METHODS to prevent blank selection
      const matchedMethod =
        COMMON_METHODS.find((m) => m.toLowerCase() === method.trim()) || method.trim();

      console.log('--- SS FORM DBG ---', {
        original: serverConfig.shadowsocksSettings?.method,
        lowered: method,
        matchedMethod,
        length: matchedMethod.length,
      });

      form.reset({
        address: serverConfig.address || '',
        port: serverConfig.port || 8388,
        method: matchedMethod,
        password: serverConfig.shadowsocksSettings?.password || '',
        plugin: serverConfig.shadowsocksSettings?.plugin || '',
        pluginOptions: serverConfig.shadowsocksSettings?.pluginOptions || '',
        remarks: serverConfig.name || '',
        enableShadowTls: hasShadowTls,
        shadowTlsPassword: serverConfig.shadowTlsSettings?.password || '',
        shadowTlsSni: serverConfig.shadowTlsSettings?.sni || '',
        shadowTlsFingerprint: serverConfig.shadowTlsSettings?.fingerprint || 'chrome',
        shadowTlsPort: serverConfig.shadowTlsSettings?.port || undefined,
      });
    }
  }, [serverConfig, form]);

  const enableShadowTls = form.watch('enableShadowTls');

  const handleSubmit = async (values: SsFormValues) => {
    const config: any = {
      protocol: 'shadowsocks' as const,
      address: values.address,
      port: values.port,
      name: values.remarks || `${values.address}:${values.port}`,
      shadowsocksSettings: {
        method: values.method,
        password: values.password,
        plugin: values.plugin || undefined,
        pluginOptions: values.pluginOptions || undefined,
      },
    };

    if (values.enableShadowTls && values.shadowTlsPassword && values.shadowTlsSni) {
      config.shadowTlsSettings = {
        password: values.shadowTlsPassword,
        sni: values.shadowTlsSni,
        fingerprint: values.shadowTlsFingerprint || 'chrome',
        port: values.shadowTlsPort || undefined,
      };
    }

    await onSubmit(config);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.remarks', '备注 (可选)')}</FormLabel>
              <FormControl>
                <Input placeholder={t('servers.remarksPlaceholder', '香港节点 1')} {...field} />
              </FormControl>
              <FormDescription>{t('servers.remarksTip', '服务器的别名')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.serverAddress', '服务器地址')}</FormLabel>
              <FormControl>
                <Input placeholder="example.com" {...field} />
              </FormControl>
              <FormDescription>
                {t('servers.serverAddressTip', '服务器的域名或 IP 地址')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="port"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.port', '端口')}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="8388"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              </FormControl>
              <FormDescription>{t('servers.portTip', '服务器端口号（1-65535）')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.encryptionMethod', '加密方式')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t('servers.selectEncryption', '选择加密方式')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(() => {
                    const sortedMethods = [...COMMON_METHODS];
                    if (field.value && !COMMON_METHODS.includes(field.value)) {
                      sortedMethods.unshift(field.value);
                    }
                    return sortedMethods.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
              <FormDescription>
                {t('servers.ssEncryptionTip', 'Shadowsocks 加密算法')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.password', '密码')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t('servers.inputPassword', '输入密码')}
                  {...field}
                />
              </FormControl>
              <FormDescription>{t('servers.ssPasswordTip', 'Shadowsocks 密码')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="plugin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('servers.plugin', '插件 (可选)')}</FormLabel>
                <FormControl>
                  <Input placeholder="obfs-local" {...field} />
                </FormControl>
                <FormDescription>{t('servers.pluginTip', 'SIP003 插件名称')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="pluginOptions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('servers.pluginOptions', '插件参数 (可选)')}</FormLabel>
                <FormControl>
                  <Input placeholder="obfs=http;obfs-host=..." {...field} />
                </FormControl>
                <FormDescription>{t('servers.pluginOptionsTip', '插件命令行参数')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Shadow-TLS v3 */}
        <div className="border rounded-lg p-4 space-y-4">
          <FormField
            control={form.control}
            name="enableShadowTls"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="flex items-center gap-1.5 cursor-pointer">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    {t('servers.enableShadowTls', '启用 Shadow-TLS v3')}
                  </FormLabel>
                  <FormDescription>
                    {t('servers.enableShadowTlsTip', '在 Shadowsocks 外层套上 TLS 伪装隧道')}
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          {enableShadowTls && (
            <div className="space-y-4 pt-2 border-t">
              <FormField
                control={form.control}
                name="shadowTlsPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('servers.shadowTlsPassword', 'Shadow-TLS 密码')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={t(
                          'servers.shadowTlsPasswordTip',
                          'Shadow-TLS v3 密码（与 SS 密码不同）'
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="shadowTlsSni"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('servers.shadowTlsSni', '伪装域名 (SNI)')}</FormLabel>
                      <FormControl>
                        <Input placeholder="www.microsoft.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('servers.shadowTlsSniTip', 'Shadow-TLS 伪装目标域名')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shadowTlsPort"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('servers.realPort', '真实端口 (可选)')}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder={t(
                            'servers.realPortPlaceholder',
                            '例如: 8443 (留空默认使用原端口)'
                          )}
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            field.onChange(val ? parseInt(val) : undefined);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('servers.realPortTip', 'Shadow-TLS 实际监听的端口')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="shadowTlsFingerprint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('servers.tlsFingerprint', 'TLS 指纹')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t('servers.selectFingerprint', '选择 TLS 指纹')}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="chrome">Chrome</SelectItem>
                        <SelectItem value="firefox">Firefox</SelectItem>
                        <SelectItem value="safari">Safari</SelectItem>
                        <SelectItem value="edge">Edge</SelectItem>
                        <SelectItem value="ios">iOS</SelectItem>
                        <SelectItem value="android">Android</SelectItem>
                        <SelectItem value="random">{t('servers.random', '随机')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {t('servers.tlsFingerprintTip', 'uTLS 客户端指纹伪装')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('servers.saveConfig', '保存配置')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={form.formState.isSubmitting}
          >
            {t('servers.reset', '重置')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
