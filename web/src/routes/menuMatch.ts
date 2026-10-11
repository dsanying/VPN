import { matchRoutes, type RouteObject } from 'react-router';
export interface MenuNode<Node extends MenuNode<Node>> {
  path: string;
  children?: Node[];
}

/** Use the router's public matcher to keep static, dynamic and wildcard ranking identical. */
export function matchMenuChain<Node extends MenuNode<Node>>(
  entries: Node[],
  pathname: string
): Node[] {
  const destinations: RouteObject[] = [];
  const pending = entries.map((node) => ({ node, chain: [node] }));
  while (pending.length) {
    const current = pending.shift()!;
    destinations.push({ path: current.node.path, handle: current.chain });
    for (const child of current.node.children ?? [])
      pending.push({ node: child, chain: current.chain.concat(child) });
  }
  const matches = matchRoutes(destinations, pathname);
  return (matches?.[matches.length - 1].route.handle as Node[] | undefined) ?? [];
}
export function selectedMenuKey<Node extends MenuNode<Node> & { hideInMenu?: boolean }>(
  chain: Node[]
): string | undefined {
  for (let index = chain.length - 1; index >= 0; index--)
    if (!chain[index].hideInMenu) return chain[index].path;
  return undefined;
}
/** Attach hidden destinations to their nearest path parent without mutating input order or objects. */
export function nestHiddenRoutes<Node extends MenuNode<Node> & { hideInMenu?: boolean }>(
  entries: Node[]
): Node[] {
  const parentOf = new Map<Node, Node>();
  for (const destination of entries) {
    if (!destination.hideInMenu) continue;
    let parent: Node | undefined;
    for (const candidate of entries) {
      if (
        candidate === destination ||
        !destination.path.startsWith(candidate.path.replace(/\/$/, '') + '/')
      )
        continue;
      if (!parent || candidate.path.length > parent.path.length) parent = candidate;
    }
    if (parent) parentOf.set(destination, parent);
  }
  const build = (node: Node): Node => {
    const children = nestHiddenRoutes(node.children ?? []).concat(
      entries.filter((child) => parentOf.get(child) === node).map(build)
    );
    return children.length ? { ...node, children } : node;
  };
  return entries.filter((node) => !parentOf.has(node)).map(build);
}
export function hasVisibleChildren(node: { children?: { hideInMenu?: boolean }[] }): boolean {
  return node.children?.some((child) => child.hideInMenu !== true) ?? false;
}
