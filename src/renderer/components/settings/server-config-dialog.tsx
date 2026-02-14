import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VlessForm } from './vless-form';
import { TrojanForm } from './trojan-form';
import { Hysteria2Form } from './hysteria2-form';
import { SsForm } from './ss-form';
import type { ServerConfig, ProtocolType } from '@/bridge/types';

type ServerConfigWithId = ServerConfig;

interface ServerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: ServerConfigWithId;
  servers?: ServerConfigWithId[];
  onSave: (
    serverConfig: Omit<ServerConfigWithId, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
}

export function ServerConfigDialog({
  open,
  onOpenChange,
  server,
  servers = [],
  onSave,
}: ServerConfigDialogProps) {
  const [serverName, setServerName] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolType>('vless');
  const [currentServerConfig, setCurrentServerConfig] = useState<any>(null);
  const [detour, setDetour] = useState<string | undefined>(undefined);

  const isEditing = !!server;

  useEffect(() => {
    if (open) {
      if (server) {
        setServerName(server.name);
        const normalizedProtocol = server.protocol.toLowerCase() as ProtocolType;
        setSelectedProtocol(normalizedProtocol);
        setCurrentServerConfig(server);
        setDetour(server.detour);
      } else {
        setServerName('');
        setSelectedProtocol('vless');
        setCurrentServerConfig(null);
        setDetour(undefined);
      }
    }
  }, [server, open]);

  const handleSave = async (protocolConfig: any) => {
    if (!serverName.trim()) {
      throw new Error('服务器名称不能为空');
    }

    const serverConfig = {
      name: serverName.trim(),
      detour: detour || undefined,
      ...protocolConfig,
    };

    await onSave(serverConfig);
    onOpenChange(false);
  };

  const handleProtocolChange = (protocol: ProtocolType) => {
    setSelectedProtocol(protocol);
    if (protocol !== currentServerConfig?.protocol) {
      setCurrentServerConfig(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑服务器配置' : '添加服务器配置'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? '修改服务器配置信息。保存后不会自动重启代理服务。'
              : '添加新的代理服务器配置。支持 VLESS、Trojan 和 Shadowsocks 协议。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="serverName">服务器名称</Label>
            <Input
              id="serverName"
              placeholder="例如：香港节点1"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">为此服务器配置设置一个便于识别的名称</p>
          </div>

          <div className="space-y-2">
            <Label>协议类型</Label>
            <Select value={selectedProtocol} onValueChange={handleProtocolChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vless">VLESS</SelectItem>
                <SelectItem value="trojan">Trojan</SelectItem>
                <SelectItem value="hysteria2">Hysteria2</SelectItem>
                <SelectItem value="shadowsocks">Shadowsocks</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">选择您的代理服务器协议类型</p>
          </div>

          <div className="space-y-2">
            <Label>前置代理 (Proxy Chain)</Label>
            <Select value={detour || 'direct'} onValueChange={(v) => setDetour(v === 'direct' ? undefined : v)}>
              <SelectTrigger>
                <SelectValue placeholder="直连 (Direct)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">直连 (Direct)</SelectItem>
                {servers
                  .filter((s) => s.id !== server?.id) // Prevent self-selection
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">选择通过另一个代理服务器连接此节点（链式代理）</p>
          </div>

          <div className="border-t pt-6">
            {selectedProtocol === 'vless' && (
              <VlessForm
                key={currentServerConfig?.id || 'new'}
                serverConfig={
                  currentServerConfig?.protocol?.toLowerCase() === 'vless'
                    ? currentServerConfig
                    : undefined
                }
                onSubmit={handleSave}
              />
            )}
            {selectedProtocol === 'trojan' && (
              <TrojanForm
                key={currentServerConfig?.id || 'new'}
                serverConfig={
                  currentServerConfig?.protocol?.toLowerCase() === 'trojan'
                    ? currentServerConfig
                    : undefined
                }
                onSubmit={handleSave}
              />
            )}
            {selectedProtocol === 'hysteria2' && (
              <Hysteria2Form
                key={currentServerConfig?.id || 'new'}
                serverConfig={
                  currentServerConfig?.protocol?.toLowerCase() === 'hysteria2'
                    ? currentServerConfig
                    : undefined
                }
                onSubmit={handleSave}
              />
            )}
            {selectedProtocol === 'shadowsocks' && (
              <SsForm
                key={currentServerConfig?.id || 'new'}
                serverConfig={
                  currentServerConfig?.protocol?.toLowerCase() === 'shadowsocks'
                    ? currentServerConfig
                    : undefined
                }
                onSubmit={handleSave}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
