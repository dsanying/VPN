import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus, Edit, Trash2, Server, ChevronDown, Link, Copy, Activity,
  LayoutGrid, List, Search, ArrowUpDown, CheckSquare, Square,
} from 'lucide-react';
import { ImportUrlDialog } from './import-url-dialog';
import { generateShareUrl } from '@/bridge/api-wrapper';
import { api } from '@/ipc/api-client';
import type { ServerConfig } from '@/bridge/types';

type ServerConfigWithId = ServerConfig;
type ViewMode = 'card' | 'list';
type SortKey = 'name' | 'protocol' | 'latency' | 'address';
type SortOrder = 'asc' | 'desc';

const ALL_PROTOCOLS = ['vless', 'trojan', 'hysteria2', 'shadowsocks', 'anytls'] as const;

interface ServerListProps {
  servers: ServerConfigWithId[];
  subscriptions?: import('@/bridge/types').SubscriptionConfig[];
  selectedServerId?: string;
  showAddButton?: boolean;
  onAddServer: () => void;
  onEditServer: (server: ServerConfigWithId) => void;
  onDeleteServer: (serverId: string) => void;
  onDeleteServers?: (serverIds: string[]) => void;
  onSelectServer: (serverId: string) => void;
  onImportSuccess?: () => void;
}

export function ServerList({
  servers,
  selectedServerId,
  showAddButton = true,
  onAddServer,
  onEditServer,
  onDeleteServer,
  onDeleteServers,
  onSelectServer,
  onImportSuccess,
}: ServerListProps) {
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [latencyMap, setLatencyMap] = useState<Record<string, number>>({});
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);

  // 记住用户的视图偏好
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('flowz_server_view_mode');
    return (saved === 'card' || saved === 'list') ? saved : 'card';
  });

  useEffect(() => {
    localStorage.setItem('flowz_server_view_mode', viewMode);
  }, [viewMode]);

  // 搜索 / 过滤 / 排序
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProtocol, setFilterProtocol] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSpeedTest = async () => {
    setIsTestingSpeed(true);
    setLatencyMap({});
    try {
      toast.info('开始测速...');
      const results = await api.server.speedTest();
      setLatencyMap(results);
      toast.success('测速完成');
    } catch (error) {
      toast.error('测速失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTestingSpeed(false);
    }
  };

  const getLatencyColor = (latency: number | undefined) => {
    if (latency === undefined) return 'text-muted-foreground';
    if (latency === -1) return 'text-destructive';
    if (latency < 100) return 'text-green-500';
    if (latency < 300) return 'text-yellow-500';
    return 'text-destructive';
  };

  const getLatencyBg = (latency: number | undefined) => {
    if (latency === undefined) return '';
    if (latency === -1) return 'bg-destructive/10';
    if (latency < 100) return 'bg-green-500/10';
    if (latency < 300) return 'bg-yellow-500/10';
    return 'bg-destructive/10';
  };

  const handleDelete = (serverId: string) => {
    onDeleteServer(serverId);
    setSelectedIds((prev) => { const s = new Set(prev); s.delete(serverId); return s; });
  };

  const handleBatchDelete = () => {
    if (onDeleteServers) {
      onDeleteServers(Array.from(selectedIds));
    } else {
      selectedIds.forEach((id) => onDeleteServer(id));
    }
    setSelectedIds(new Set());
    setIsSelecting(false);
  };

  const handleCopyShareUrl = async (server: ServerConfigWithId, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await generateShareUrl(server);
      if (response.success && response.data) {
        await navigator.clipboard.writeText(response.data);
        toast.success('分享链接已复制到剪贴板');
      } else {
        toast.error(response.error || '生成分享链接失败');
      }
    } catch (_error) {
      toast.error('复制失败');
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredServers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredServers.map((s) => s.id)));
    }
  };

  // 过滤 + 排序
  const filteredServers = useMemo(() => {
    let list = servers;

    // 搜索
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          s.protocol.toLowerCase().includes(q),
      );
    }

    // 协议过滤
    if (filterProtocol !== 'all') {
      list = list.filter((s) => s.protocol.toLowerCase() === filterProtocol);
    }

    // 排序
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === 'protocol') {
        cmp = a.protocol.localeCompare(b.protocol);
      } else if (sortKey === 'address') {
        cmp = a.address.localeCompare(b.address);
      } else if (sortKey === 'latency') {
        const la = latencyMap[a.id] ?? Infinity;
        const lb = latencyMap[b.id] ?? Infinity;
        cmp = la - lb;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [servers, searchQuery, filterProtocol, sortKey, sortOrder, latencyMap]);

  const getProtocolBadgeVariant = (protocol: string) => {
    const colors: Record<string, string> = {
      vless: 'bg-blue-500/15 text-blue-600 border-blue-300/30',
      trojan: 'bg-purple-500/15 text-purple-600 border-purple-300/30',
      hysteria2: 'bg-orange-500/15 text-orange-600 border-orange-300/30',
      shadowsocks: 'bg-green-500/15 text-green-600 border-green-300/30',
      anytls: 'bg-teal-500/15 text-teal-600 border-teal-300/30',
    };
    return colors[protocol.toLowerCase()] || 'bg-muted text-muted-foreground';
  };

  // 操作按钮（卡片和列表模式共用）
  const renderActions = (server: ServerConfigWithId, stopPropagation = true) => (
    <div className="flex items-center gap-1 flex-shrink-0">
      {latencyMap[server.id] !== undefined && (
        <span className={`text-xs font-medium mr-1 px-1.5 py-0.5 rounded ${getLatencyColor(latencyMap[server.id])} ${getLatencyBg(latencyMap[server.id])}`}>
          {latencyMap[server.id] === -1 ? '超时' : `${latencyMap[server.id]} ms`}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        title="复制分享链接"
        className="h-7 w-7 p-0"
        onClick={(e) => handleCopyShareUrl(server, e)}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="编辑"
        className="h-7 w-7 p-0"
        disabled={!!server.subscriptionId}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          onEditServer(server);
        }}
      >
        <Edit className="h-3.5 w-3.5" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!!server.subscriptionId}
            onClick={(e) => { if (stopPropagation) e.stopPropagation(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除服务器配置</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除服务器 &quot;{server.name}&quot; 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.stopPropagation(); handleDelete(server.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const deletableSelected = Array.from(selectedIds).filter(
    (id) => !servers.find((s) => s.id === id)?.subscriptionId,
  );

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">服务器列表</h3>
          <p className="text-sm text-muted-foreground">管理您的代理服务器配置</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* 视图切换 */}
          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={viewMode === 'card' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0 rounded-none border-0"
              title="卡片视图"
              onClick={() => setViewMode('card')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0 rounded-none border-0 border-l"
              title="列表视图"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            className="flex items-center gap-2"
            onClick={handleSpeedTest}
            disabled={isTestingSpeed}
          >
            <Activity className={`h-4 w-4 ${isTestingSpeed ? 'animate-pulse' : ''}`} />
            {isTestingSpeed ? '测速中...' : '测速'}
          </Button>

          {/* 批量选择按钮 */}
          {showAddButton && (
            <Button
              variant={isSelecting ? 'secondary' : 'outline'}
              size="sm"
              className="flex items-center gap-1"
              onClick={() => {
                setIsSelecting(!isSelecting);
                setSelectedIds(new Set());
              }}
            >
              <CheckSquare className="h-4 w-4" />
              {isSelecting ? '取消' : '多选'}
            </Button>
          )}

          {showAddButton && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  添加服务器
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onAddServer}>
                  <Plus className="h-4 w-4 mr-2" />
                  手动添加
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsImportDialogOpen(true)}>
                  <Link className="h-4 w-4 mr-2" />
                  从URL导入
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 搜索 + 过滤 + 排序栏 */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-9"
            placeholder="搜索节点名称、地址..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={filterProtocol} onValueChange={setFilterProtocol}>
          <SelectTrigger className="w-[130px] h-9">
            <SelectValue placeholder="协议" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部协议</SelectItem>
            {ALL_PROTOCOLS.map((p) => (
              <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 flex items-center gap-1">
              <ArrowUpDown className="h-3.5 w-3.5" />
              排序
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {([['name', '名称'], ['protocol', '协议'], ['latency', '延迟'], ['address', '地址']] as [SortKey, string][]).map(([key, label]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => {
                  if (sortKey === key) {
                    setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                  } else {
                    setSortKey(key);
                    setSortOrder('asc');
                  }
                }}
              >
                {label} {sortKey === key ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setSortKey('name'); setSortOrder('asc'); }}>
              重置排序
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 批量操作栏 */}
      {isSelecting && (
        <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/60 border">
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              onClick={toggleSelectAll}
            >
              {selectedIds.size === filteredServers.length && filteredServers.length > 0
                ? <CheckSquare className="h-4 w-4" />
                : <Square className="h-4 w-4" />}
              全选
            </button>
            <span className="text-sm text-muted-foreground">
              已选 {selectedIds.size} / {filteredServers.length} 个
            </span>
          </div>
          {selectedIds.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex items-center gap-1"
                  disabled={deletableSelected.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除 {deletableSelected.length} 个
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>批量删除</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定删除已选中的 {deletableSelected.length} 个手动添加的节点吗？订阅节点不会被删除。此操作无法撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleBatchDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {/* 节点列表 */}
      {filteredServers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {servers.length === 0
                ? showAddButton ? '暂无服务器配置' : '暂无节点'
                : '没有匹配的节点'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 text-center">
              {servers.length === 0
                ? showAddButton
                  ? '您还没有添加任何服务器配置。点击上方按钮添加您的第一个服务器。'
                  : '该订阅暂无节点，请点击上方"更新节点"按钮拉取最新数据。'
                : '尝试修改搜索关键词或过滤条件。'}
            </p>
            {servers.length === 0 && showAddButton && (
              <div className="flex gap-2">
                <Button onClick={onAddServer} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  手动添加
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsImportDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Link className="h-4 w-4" />
                  从URL导入
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : viewMode === 'card' ? (
        /* ========= 卡片视图 ========= */
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredServers.map((server) => (
            <Card
              key={server.id}
              className={`cursor-pointer transition-colors relative ${
                selectedServerId === server.id
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              } ${isSelecting && selectedIds.has(server.id) ? 'ring-2 ring-blue-400 bg-blue-50/10' : ''}`}
              onClick={() => isSelecting ? toggleSelect(server.id, { stopPropagation: () => {} } as any) : onSelectServer(server.id)}
            >
              {/* 批量选择 checkbox */}
              {isSelecting && (
                <div className="absolute top-2 left-2 z-10">
                  <Checkbox
                    checked={selectedIds.has(server.id)}
                    onCheckedChange={() => {
                      setSelectedIds((prev) => {
                        const s = new Set(prev);
                        s.has(server.id) ? s.delete(server.id) : s.add(server.id);
                        return s;
                      });
                    }}
                  />
                </div>
              )}
              <CardHeader className={`pb-2 ${isSelecting ? 'pl-8' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm truncate">{server.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {server.address}:{server.port}
                    </CardDescription>
                  </div>
                  {!isSelecting && renderActions(server)}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge className={`text-xs h-4 px-1 border ${getProtocolBadgeVariant(server.protocol)}`}>
                    {server.protocol.toUpperCase()}
                  </Badge>
                  {selectedServerId === server.id && (
                    <Badge variant="outline" className="text-xs h-4 px-1">当前选中</Badge>
                  )}
                  {server.shadowTlsSettings && (
                    <Badge variant="outline" className="text-xs h-4 px-1 text-teal-600 border-teal-300/50">+ST</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {server.protocol?.toLowerCase() === 'shadowsocks' ? (
                    <span>加密: {server.shadowsocksSettings?.method || 'N/A'}</span>
                  ) : (
                    <>
                      <span>传输: {server.network || 'tcp'}</span>
                      <span>加密: {server.security || 'none'}</span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* ========= 列表视图 ========= */
        <div className="rounded-md border divide-y">
          {filteredServers.map((server) => (
            <div
              key={server.id}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                selectedServerId === server.id ? 'bg-primary/5' : 'hover:bg-muted/50'
              } ${isSelecting && selectedIds.has(server.id) ? 'bg-blue-50/10' : ''}`}
              onClick={() => isSelecting
                ? setSelectedIds((prev) => { const s = new Set(prev); s.has(server.id) ? s.delete(server.id) : s.add(server.id); return s; })
                : onSelectServer(server.id)
              }
            >
              {/* 批量选择 */}
              {isSelecting && (
                <Checkbox
                  checked={selectedIds.has(server.id)}
                  onCheckedChange={() => {
                    setSelectedIds((prev) => { const s = new Set(prev); s.has(server.id) ? s.delete(server.id) : s.add(server.id); return s; });
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}

              {/* 选中指示器 */}
              {!isSelecting && (
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  selectedServerId === server.id ? 'bg-primary' : 'bg-transparent'
                }`} />
              )}

              {/* 名称 + 地址 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{server.name}</span>
                  <Badge className={`text-[10px] h-4 px-1 flex-shrink-0 border ${getProtocolBadgeVariant(server.protocol)}`}>
                    {server.protocol.toUpperCase()}
                  </Badge>
                  {server.shadowTlsSettings && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 flex-shrink-0 text-teal-600 border-teal-300/50">+ST</Badge>
                  )}
                  {selectedServerId === server.id && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 flex-shrink-0">当前</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {server.address}:{server.port}
                  {server.network && server.network !== 'tcp' && <span className="ml-2">{server.network}</span>}
                </p>
              </div>

              {/* 延迟 + 操作 */}
              {!isSelecting && renderActions(server)}
            </div>
          ))}
        </div>
      )}

      <ImportUrlDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImportSuccess={onImportSuccess}
      />
    </div>
  );
}
