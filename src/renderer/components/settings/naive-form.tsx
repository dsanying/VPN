import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import type { ServerConfig } from '@/bridge/types';

const createNaiveSchema = (t: any) =>
  z.object({
    address: z.string().min(1, t('servers.serverAddressRequired', 'Address is required')),
    port: z.number().min(1).max(65535),
    username: z.string().min(1, t('servers.usernameRequired', 'Username is required')),
    password: z.string().min(1, t('servers.passwordRequired')),
    tlsServerName: z.string().optional(),
  });

type NaiveFormValues = z.infer<ReturnType<typeof createNaiveSchema>>;

interface NaiveFormProps {
  serverConfig?: ServerConfig;
  onSubmit: (config: Partial<ServerConfig>) => Promise<void>;
}

export function NaiveForm({ serverConfig, onSubmit }: NaiveFormProps) {
  const { t } = useTranslation();
  const naiveFormSchema = createNaiveSchema(t);

  const getDefaultValues = (): NaiveFormValues => {
    if (serverConfig && serverConfig.protocol?.toLowerCase() === 'naive') {
      return {
        address: serverConfig.address || '',
        port: serverConfig.port || 443,
        username: serverConfig.username || '',
        password: serverConfig.password || '',
        tlsServerName: serverConfig.tlsSettings?.serverName || '',
      };
    }
    return {
      address: '',
      port: 443,
      username: '',
      password: '',
      tlsServerName: '',
    };
  };

  const form = useForm<NaiveFormValues>({
    resolver: zodResolver(naiveFormSchema),
    defaultValues: getDefaultValues(),
  });

  const handleSubmit = async (values: NaiveFormValues) => {
    const config: Partial<ServerConfig> = {
      protocol: 'naive',
      address: values.address,
      port: values.port,
      username: values.username,
      password: values.password,
      network: 'tcp',
      security: 'tls',
      tlsSettings: {
        serverName: values.tlsServerName?.trim() || undefined,
        allowInsecure: false,
      },
    };
    await onSubmit(config);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">{t('servers.serverAddress')}</FormLabel>
                    <FormControl>
                      <Input placeholder="example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">{t('servers.port')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="443"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">
                    {t('servers.username', 'Username')}
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Enter username" {...field} />
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
                  <FormLabel className="text-foreground">
                    {t('servers.password', 'Password')}
                  </FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tlsServerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">{t('servers.sni')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('servers.sniPlaceholder')} {...field} />
                  </FormControl>
                  <FormDescription>{t('servers.sniDesc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={form.formState.isSubmitting}
          >
            {t('common.reset')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
