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
import { Loader2 } from 'lucide-react';
import type { ServerConfig } from '@/bridge/types';

const ssFormSchema = z.object({
  address: z.string().min(1, '服务器地址不能为空'),
  port: z.number().min(1, '端口必须大于 0').max(65535, '端口必须小于 65536'),
  method: z.string().min(1, '加密方式不能为空'),
  password: z.string().min(1, '密码不能为空'),
  plugin: z.string().optional(),
  pluginOptions: z.string().optional(),
  remarks: z.string().optional(),
});

type SsFormValues = z.infer<typeof ssFormSchema>;

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
    },
  });

  useEffect(() => {
    if (serverConfig && serverConfig.protocol?.toLowerCase() === 'shadowsocks') {
      const formData = {
        address: serverConfig.address || '',
        port: serverConfig.port || 8388,
        method: serverConfig.shadowsocksSettings?.method || 'aes-256-gcm',
        password: serverConfig.shadowsocksSettings?.password || '',
        plugin: serverConfig.shadowsocksSettings?.plugin || '',
        pluginOptions: serverConfig.shadowsocksSettings?.pluginOptions || '',
        remarks: serverConfig.name || '',
      };
      form.reset(formData);
    }
  }, [serverConfig, form]);

  const handleSubmit = async (values: SsFormValues) => {
    const serverConfig = {
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

    await onSubmit(serverConfig);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注 (可选)</FormLabel>
              <FormControl>
                <Input placeholder="香港节点 1" {...field} />
              </FormControl>
              <FormDescription>服务器的别名</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>服务器地址</FormLabel>
              <FormControl>
                <Input placeholder="example.com" {...field} />
              </FormControl>
              <FormDescription>服务器的域名或 IP 地址</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="port"
          render={({ field }) => (
            <FormItem>
              <FormLabel>端口</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="8388"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              </FormControl>
              <FormDescription>服务器端口号（1-65535）</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>加密方式</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择加密方式" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {COMMON_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Shadowsocks 加密算法</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <FormControl>
                <Input type="password" placeholder="输入密码" {...field} />
              </FormControl>
              <FormDescription>Shadowsocks 密码</FormDescription>
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
                <FormLabel>插件 (可选)</FormLabel>
                <FormControl>
                  <Input placeholder="obfs-local" {...field} />
                </FormControl>
                <FormDescription>SIP003 插件名称</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="pluginOptions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>插件参数 (可选)</FormLabel>
                <FormControl>
                  <Input placeholder="obfs=http;obfs-host=..." {...field} />
                </FormControl>
                <FormDescription>插件命令行参数</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存配置
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={form.formState.isSubmitting}
          >
            重置
          </Button>
        </div>
      </form>
    </Form>
  );
}
