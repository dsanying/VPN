import { useState, useEffect } from 'react';
import { EyeOff, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';

export function PrivacyOverlay() {
  const config = useAppStore((state) => state.config);
  const isPrivacyMode = useAppStore((state) => state.isPrivacyMode);
  const setPrivacyMode = useAppStore((state) => state.setPrivacyMode);
  const [passwordInput, setPasswordInput] = useState('');
  const [errorShake, setErrorShake] = useState(false);

  // Auto focus logic can be handled natively by React
  useEffect(() => {
    if (isPrivacyMode) {
      setPasswordInput('');
      setErrorShake(false);
    }
  }, [isPrivacyMode]);

  if (!isPrivacyMode) {
    return null;
  }

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Check if the user has a password set. If not, just unlock immediately.
    const savedPassword = config?.privacyPassword || '';

    if (savedPassword === '' || passwordInput === savedPassword) {
      setPrivacyMode(false);
      toast.success('已解除隐私保护模式'); // Keeping Chinese for native consistency or we can translate
    } else {
      setErrorShake(true);
      toast.error('解锁密码错误');
      setTimeout(() => setErrorShake(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col justify-center items-center backdrop-blur-[100px] bg-background/95 transition-all duration-500">
      <EyeOff className="w-24 h-24 text-muted-foreground mb-6 animate-pulse" />
      <h2 className="text-3xl font-bold mb-3 tracking-tight">已开启隐私保护模式</h2>
      <p className="text-muted-foreground mb-8">聊天内容不会泄露，消息提醒不再弹出</p>

      <form onSubmit={handleUnlock} className="flex flex-col gap-3 items-center w-full max-w-sm">
        {config?.privacyPassword ? (
          <div className={`flex w-full space-x-2 ${errorShake ? 'animate-shake' : ''}`}>
            <div className="relative flex-1">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="请输入解锁密码"
                className="pl-9 w-full"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" variant="default">
              退出隐私保护模式
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => handleUnlock()}
            variant="default"
            size="lg"
            className="w-full"
          >
            退出隐私保护模式
          </Button>
        )}
      </form>
    </div>
  );
}
