import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

/** OS notifications only. No address polling, probe clock or elevated process. */
export class NetworkChangeMonitor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private closed = false;
  private pending = '';
  constructor(
    private readonly changed: () => void,
    private readonly failed: (error: Error) => void,
    private readonly macExecutable: string,
    private readonly platform = process.platform,
    private readonly launch = spawn
  ) {}
  start(): void {
    if (this.closed || this.child) return;
    let command: string;
    let args: string[];
    if (this.platform === 'darwin') {
      command = this.macExecutable;
      args = [];
    } else if (this.platform === 'win32') {
      command = 'powershell.exe';
      // The .NET callback writes one fixed marker; PowerShell blocks on stdin.
      // No user text, execution-policy override or polling WMI query is involved.
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
Add-Type -TypeDefinition @'
using System;
using System.Net.NetworkInformation;
public static class ShadowNetworkEvents {
  public static void Start() {
    NetworkChange.NetworkAddressChanged += Changed;
    NetworkChange.NetworkAvailabilityChanged += Available;
  }
  static void Changed(object sender, EventArgs args) { Console.WriteLine("NETWORK_CHANGED"); }
  static void Available(object sender, NetworkAvailabilityEventArgs args) { Console.WriteLine("NETWORK_CHANGED"); }
}
'@
[ShadowNetworkEvents]::Start()
[Console]::ReadLine() | Out-Null
`,
      ];
    } else if (this.platform === 'linux') {
      command = 'ip';
      args = ['monitor', 'link', 'address', 'route'];
    } else {
      this.failed(new Error('Network change notifications are unavailable on this platform'));
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.launch(command, args, { stdio: 'pipe', windowsHide: true });
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.child = child;
    this.pending = '';
    let reported = false;
    const failure = (error: Error) => {
      if (this.child !== child) return;
      this.child = null;
      child.kill();
      if (!this.closed && !reported) {
        reported = true;
        this.failed(error);
      }
    };
    child.on('error', failure);
    child.stdin.on('error', failure);
    child.on('exit', () => failure(new Error('Network change monitor stopped')));
    // Consume stderr without persisting OS addresses or process details.
    child.stderr.on('data', () => undefined);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.closed || this.child !== child) return;
      this.pending += chunk;
      if (this.pending.length > 65536) {
        failure(new Error('Invalid network notification stream'));
        return;
      }
      let newline: number;
      while ((newline = this.pending.indexOf('\n')) >= 0) {
        const line = this.pending.slice(0, newline).trim();
        this.pending = this.pending.slice(newline + 1);
        const relevant = this.platform === 'linux' ? !!line : line === 'NETWORK_CHANGED';
        if (relevant) this.changed();
      }
    });
  }
  dispose(): void {
    this.closed = true;
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
