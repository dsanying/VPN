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
import { Loader2 } from 'lucide-react';
import type { ServerConfig } from '@/bridge/types';
import { useTranslation } from 'react-i18next';

// Use a function to get schema with translations
const getAnyTlsFormSchema = (t: any) =>
  z.object({
    address: z.string().min(1, t('servers.errorAddressEmpty', '服务器地址不能为空')),
    port: z
      .number()
      .min(1, t('servers.errorPortMin', '端口必须大于 0'))
      .max(65535, t('servers.errorPortMax', '端口必须小于 65536')),
    password: z.string().min(1, t('servers.errorPassword', '密码不能为空')),
    security: z.enum(['tls', 'reality']),
    tlsServerName: z.string().optional(),
    tlsFingerprint: z.string().optional(),
    tlsAllowInsecure: z.boolean(),
    realityPublicKey: z.string().optional(),
    realityShortId: z.string().optional(),
  });

type AnyTlsFormValues = z.infer<ReturnType<typeof getAnyTlsFormSchema>>;

interface AnyTlsFormProps {
  serverConfig?: ServerConfig;
  onSubmit: (config: any) => Promise<void>;
}

export function AnyTlsForm({ serverConfig, onSubmit }: AnyTlsFormProps) {
  const { t } = useTranslation();
  const anyTlsFormSchema = getAnyTlsFormSchema(t);

  const getDefaultValues = (): AnyTlsFormValues => {
    if (serverConfig && serverConfig.protocol?.toLowerCase() === 'anytls') {
      return {
        address: serverConfig.address || '',
        port: serverConfig.port || 443,
        password: serverConfig.password || '',
        security: (serverConfig.security === 'reality' ? 'reality' : 'tls') as 'tls' | 'reality',
        tlsServerName: serverConfig.tlsSettings?.serverName || '',
        tlsFingerprint: serverConfig.tlsSettings?.fingerprint || 'chrome',
        tlsAllowInsecure: serverConfig.tlsSettings?.allowInsecure || false,
        realityPublicKey: serverConfig.realitySettings?.publicKey || '',
        realityShortId: serverConfig.realitySettings?.shortId || '',
      };
    }
    return {
      address: '',
      port: 443,
      password: '',
      security: 'tls',
      tlsServerName: '',
      tlsFingerprint: 'chrome',
      tlsAllowInsecure: false,
      realityPublicKey: '',
      realityShortId: '',
    };
  };

  const form = useForm<AnyTlsFormValues>({
    resolver: zodResolver(anyTlsFormSchema),
    defaultValues: getDefaultValues(),
  });

  useEffect(() => {
    if (serverConfig && serverConfig.protocol?.toLowerCase() === 'anytls') {
      form.reset(getDefaultValues());
    }
  }, [serverConfig]);

  const handleSubmit = async (values: AnyTlsFormValues) => {
    const config: any = {
      protocol: 'anytls' as const,
      address: values.address,
      port: values.port,
      password: values.password,
      security: values.security,
      tlsSettings: {
        serverName: values.tlsServerName?.trim() || undefined,
        fingerprint: values.tlsFingerprint || 'chrome',
        allowInsecure: values.security === 'tls' ? values.tlsAllowInsecure : false,
      },
    };

    if (values.security === 'reality') {
      config.realitySettings = {
        publicKey: values.realityPublicKey?.trim() || '',
        shortId: values.realityShortId?.trim() || undefined,
      };
    }

    await onSubmit(config);
  };

  const isTls = form.watch('security') === 'tls';
  const isReality = form.watch('security') === 'reality';

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
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
                  placeholder="443"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              </FormControl>
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
                  placeholder={t('servers.inputAnyTlsPassword', '输入 AnyTLS 密码')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="security"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('servers.securityType', '安全类型')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t('servers.selectSecurity', '选择安全类型')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="tls">TLS</SelectItem>
                  <SelectItem value="reality">Reality</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {t('servers.anyTlsSecurityTip', 'AnyTLS 必须使用 TLS，可选 Reality 增强伪装')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* TLS 配置 */}
        {isTls && (
          <>
            <FormField
              control={form.control}
              name="tlsServerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('servers.sniOptional', 'SNI（可选）')}</FormLabel>
                  <FormControl>
                    <Input placeholder="example.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('servers.tlsSniTipLong', 'TLS Server Name Indication，留空则使用服务器地址')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tlsFingerprint"
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

            <FormField
              control={form.control}
              name="tlsAllowInsecure"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>{t('servers.allowInsecure', '允许不安全的连接')}</FormLabel>
                    <FormDescription>
                      {t('servers.allowInsecureTestTip', '跳过证书验证（仅用于测试）')}
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </>
        )}

        {/* Reality 配置 */}
        {isReality && (
          <>
            <FormField
              control={form.control}
              name="tlsServerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('servers.targetWebsite', '目标网站（SNI）')}</FormLabel>
                  <FormControl>
                    <Input placeholder="www.microsoft.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('servers.realityTargetTip', 'Reality 伪装的目标网站域名')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="realityPublicKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('servers.publicKey', 'Public Key')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('servers.inputPubKey', '服务端生成的公钥')} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('servers.realityPubKeyTip', 'Reality 公钥，由服务端生成')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="realityShortId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('servers.shortId', 'Short ID（可选）')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('servers.inputShortId', '留空或填写服务端配置的值')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tlsFingerprint"
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
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

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
