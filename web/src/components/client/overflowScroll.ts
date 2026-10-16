export function installOverflowScroll(root: HTMLElement) {
  let frame = 0;
  const regions = new Set<HTMLElement>();
  const observed = new Set<Element>();
  const dirty = new Set<HTMLElement>();
  const measure = () => {
    frame = 0;
    for (const element of observed) {
      if (!element.isConnected) { sizes.unobserve(element); observed.delete(element); }
    }
    for(const region of regions)if(!region.isConnected){sizes.unobserve(region);regions.delete(region);dirty.delete(region);}
    const pending=[...dirty];dirty.clear();
    for (const region of pending) {
      if (!region.isConnected) continue;
      const horizontal = region.dataset.clientOverflow === 'x';
      if (horizontal) {
        const overflowing=region.scrollWidth > region.clientWidth+1;
        region.style.overflowX=overflowing?'auto':'hidden';
        if(overflowing && !region.closest('button,a,input,select,textarea') && !region.querySelector('button,a,input,select,textarea,[tabindex]')) {region.tabIndex=0;region.dataset.clientFocusable='true';}
        else if(region.dataset.clientFocusable==='true'){region.removeAttribute('tabindex');delete region.dataset.clientFocusable;}
      }
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const sizes = new ResizeObserver(entries=>{
    for(const entry of entries){const region=entry.target.closest<HTMLElement>('[data-client-overflow]');if(region&&regions.has(region))dirty.add(region);}
    if(dirty.size)schedule();
  });
  const observe = (element: Element) => {
    if (!observed.has(element)) { observed.add(element); sizes.observe(element); }
  };
  const discover = (subtree: Element) => {
    const candidates = [...subtree.querySelectorAll<HTMLElement>('[data-client-overflow]')];
    if (subtree instanceof HTMLElement && subtree.matches('[data-client-overflow]')) candidates.push(subtree);
    for (const region of candidates) {
      regions.add(region); dirty.add(region); observe(region);
      for (const child of region.children) observe(child);
    }
    if (candidates.length) schedule();
  };
  const changes = new MutationObserver(records => {
    for (const record of records) {
      const parent = record.target instanceof Element ? record.target : record.target.parentElement;
      const region = parent?.closest<HTMLElement>('[data-client-overflow]');
      if (region) { dirty.add(region);for (const child of region.children) observe(child); schedule(); }
      for (const node of record.addedNodes) if (node instanceof Element) discover(node);
      if (record.removedNodes.length && [...observed].some(element => !element.isConnected)) schedule();
    }
  });
  changes.observe(root, { childList: true, subtree: true, characterData: true });
  discover(root);
  const wheel = (event: WheelEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element) || (!event.shiftKey && Math.abs(event.deltaX)<=Math.abs(event.deltaY))) return;
    const region = event.target.closest<HTMLElement>('[data-client-overflow]');
    if (!region || region.scrollWidth <= region.clientWidth) return;
    const before = region.scrollLeft;
    region.scrollLeft += event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    if (before !== region.scrollLeft) {event.preventDefault();event.stopPropagation();}
  };
  root.addEventListener('wheel', wheel, { passive: false, capture:true });
  return () => { root.removeEventListener('wheel', wheel, {capture:true}); changes.disconnect(); sizes.disconnect(); cancelAnimationFrame(frame); };
}
